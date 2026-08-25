use crate::state::AppState;
use error_stack::ResultExt;
use kafkaoxide_core::{
    partition_importable, select_for_export, AppError, Connection, ConnectionExportFile, ConnectionStatus,
    NewConnection,
};
use kafkaoxide_kafka::BrokerSslConfig;
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(serde::Serialize)]
pub struct CommandError {
    pub message: String,
}

impl From<error_stack::Report<kafkaoxide_core::AppError>> for CommandError {
    fn from(report: error_stack::Report<kafkaoxide_core::AppError>) -> Self {
        CommandError {
            message: format_report(&report),
        }
    }
}

/// Renders a report as a single readable line for the frontend to show
/// as-is: the top-level `AppError`'s message, followed by each
/// `.attach_printable(...)` reason in the chain. Plain `{report:?}` isn't
/// fit for end users — it includes box-drawing characters and `at
/// file:line` source locations meant for developers reading logs.
fn format_report(report: &error_stack::Report<kafkaoxide_core::AppError>) -> String {
    use error_stack::{AttachmentKind, FrameKind};

    let mut parts = vec![report.current_context().to_string()];
    for frame in report.frames() {
        if let FrameKind::Attachment(AttachmentKind::Printable(printable)) = frame.kind() {
            parts.push(printable.to_string());
        }
    }
    parts.join(": ")
}

#[tauri::command]
pub async fn connection_list(state: State<'_, AppState>) -> Result<Vec<Connection>, CommandError> {
    Ok(kafkaoxide_db::connections::list(&state.pool).await?)
}

#[tauri::command]
pub async fn connection_create(
    app: AppHandle,
    state: State<'_, AppState>,
    new_connection: NewConnection,
) -> Result<Connection, CommandError> {
    let connection = kafkaoxide_db::connections::create(&state.pool, &new_connection).await?;
    crate::logging::emit_log(&app, "info", format!("Created connection \"{}\"", connection.name));
    Ok(connection)
}

#[tauri::command]
pub async fn connection_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    new_connection: NewConnection,
) -> Result<Connection, CommandError> {
    let connection = kafkaoxide_db::connections::update(&state.pool, &id, &new_connection).await?;
    crate::logging::emit_log(&app, "info", format!("Updated connection \"{}\"", connection.name));
    Ok(connection)
}

#[tauri::command]
pub async fn connection_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CommandError> {
    kafkaoxide_db::connections::delete(&state.pool, &id).await?;
    kafkaoxide_db::topic_schemas::delete_all_for_connection(&state.pool, &id).await?;
    state.connections.mark_disconnected(&id);
    crate::logging::emit_log(&app, "info", format!("Deleted connection {id}"));
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
}

/// Backs the sidebar's per-connection "Export Connection" context-menu item
/// (`ids: Some([id])`) and its "Export All" button (`ids: None`). `path` is
/// resolved by the frontend beforehand via the native save dialog — this
/// command only builds the file contents and writes them. Never includes
/// credentials, even though `Connection` itself now carries them:
/// `select_for_export` only ever produces `PortableConnection`s, whose field
/// list deliberately excludes every secret (see its doc comment).
#[tauri::command]
pub async fn connections_export(
    state: State<'_, AppState>,
    ids: Option<Vec<String>>,
    path: String,
) -> Result<(), CommandError> {
    let all = kafkaoxide_db::connections::list(&state.pool).await?;
    let portable = select_for_export(&all, ids.as_deref());
    let file = ConnectionExportFile::new(portable);
    let json = file
        .to_json_pretty()
        .change_context(AppError::Validation)
        .attach_printable("failed to serialize the connections export file")?;
    std::fs::write(&path, json)
        .change_context(AppError::Validation)
        .attach_printable("failed to write the connections export file")?;
    Ok(())
}

/// Backs the sidebar's "Import" button. `path` is resolved by the frontend
/// via the native open dialog. Connections whose name matches an existing
/// one are left untouched (see `partition_importable`'s doc comment) rather
/// than overwritten or duplicated; imported connections always land with
/// empty credential fields, same as any other freshly created connection.
#[tauri::command]
pub async fn connections_import(state: State<'_, AppState>, path: String) -> Result<ImportSummary, CommandError> {
    let text = std::fs::read_to_string(&path)
        .change_context(AppError::Validation)
        .attach_printable("failed to read the connections export file")?;
    let file = ConnectionExportFile::parse(&text)?;

    let existing = kafkaoxide_db::connections::list(&state.pool).await?;
    let existing_names: HashSet<String> = existing.into_iter().map(|connection| connection.name).collect();
    let (importable, skipped) = partition_importable(&file.connections, &existing_names);
    let imported = importable.len();

    for portable in importable {
        let new_connection: NewConnection = portable.clone().into();
        kafkaoxide_db::connections::create(&state.pool, &new_connection).await?;
    }

    Ok(ImportSummary { imported, skipped })
}

#[tauri::command]
pub async fn connection_check_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectionStatus, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state.kafka.check_status(&connection).await?)
}

/// Backs the ping button next to "Bootstrap servers" in the New Connection
/// modal's General section — a plain TCP reachability check of whatever the
/// user has typed so far, independent of the Security tab.
#[tauri::command]
pub async fn connection_ping_bootstrap(
    state: State<'_, AppState>,
    bootstrap_servers: String,
) -> Result<ConnectionStatus, CommandError> {
    Ok(state.kafka.ping_bootstrap(&bootstrap_servers).await?)
}

/// Backs the ping button next to "Host" in the New Connection modal's
/// Zookeeper section. `timeout_ms` is the user's General settings >
/// Zookeeper > Timeout value.
#[tauri::command]
pub async fn connection_ping_zookeeper(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    timeout_ms: u64,
) -> Result<ConnectionStatus, CommandError> {
    Ok(state.zookeeper.ping(&host, port, timeout_ms).await)
}

/// Backs the New Connection modal's bottom "Test" button — tests
/// connectivity using every value currently entered in the modal, without
/// requiring the connection to be saved first.
#[tauri::command]
pub async fn connection_test(
    state: State<'_, AppState>,
    new_connection: NewConnection,
) -> Result<ConnectionStatus, CommandError> {
    Ok(state
        .kafka
        .test_connection(
            &new_connection.bootstrap_servers,
            new_connection.security_protocol,
            new_connection.sasl_mechanism,
            new_connection.sasl_username.as_deref(),
            new_connection.sasl_password.as_deref(),
            BrokerSslConfig {
                truststore_location: new_connection.ssl_truststore_location.as_deref(),
                keystore_location: new_connection.ssl_keystore_location.as_deref(),
                keystore_password: new_connection.ssl_keystore_password.as_deref(),
                keystore_key_password: new_connection.ssl_keystore_key_password.as_deref(),
            },
        )
        .await?)
}

/// Backs the cluster detail panel's "Reconnect" button. Pings the saved
/// connection and, only on success, marks it connected in
/// `AppState::connections` — this is what gates the tree's Brokers/Topics/
/// Consumers expansion and the panel's field-disabling.
#[tauri::command]
pub async fn connection_connect(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectionStatus, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let status = state.kafka.check_status(&connection).await?;
    if status == ConnectionStatus::Reachable {
        state.connections.mark_connected(&id);
    }
    Ok(status)
}

/// Backs the cluster detail panel's "Disconnect" button.
#[tauri::command]
pub async fn connection_disconnect(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.connections.mark_disconnected(&id);
    Ok(())
}

#[tauri::command]
pub async fn connection_is_connected(state: State<'_, AppState>, id: String) -> Result<bool, CommandError> {
    Ok(state.connections.is_connected(&id))
}

/// Backs the tree's "Brokers" sub-list once a cluster is connected.
/// `read_timeout_ms` is the user's General settings > Brokers > Read Timeout
/// value.
#[tauri::command]
pub async fn connection_list_brokers(
    state: State<'_, AppState>,
    id: String,
    read_timeout_ms: u64,
) -> Result<Vec<kafkaoxide_core::BrokerSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state.kafka.list_brokers(&connection, Duration::from_millis(read_timeout_ms)).await?)
}

/// Backs the tree's "Topics" sub-list once a cluster is connected.
#[tauri::command]
pub async fn connection_list_topics(
    state: State<'_, AppState>,
    id: String,
    read_timeout_ms: u64,
) -> Result<Vec<kafkaoxide_core::TopicSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state.kafka.list_topics(&connection, Duration::from_millis(read_timeout_ms)).await?)
}

/// Backs the tree's "Consumers" sub-list once a cluster is connected.
#[tauri::command]
pub async fn connection_list_consumer_groups(
    state: State<'_, AppState>,
    id: String,
    read_timeout_ms: u64,
) -> Result<Vec<kafkaoxide_core::ConsumerGroupSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .list_consumer_groups(&connection, Duration::from_millis(read_timeout_ms))
        .await?)
}

/// Backs the topic detail panel's Properties > Messages "Refresh" button.
#[tauri::command]
pub async fn connection_count_topic_messages(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    read_timeout_ms: u64,
) -> Result<u64, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .count_topic_messages(&connection, &topic, Duration::from_millis(read_timeout_ms))
        .await?)
}

/// One incrementally-fetched message, emitted on the `"messages-batch"`
/// event as soon as it's polled from the broker. Tagged with the
/// frontend-generated `request_id` passed into `connection_fetch_messages`
/// so a Data tab that started a second fetch (or was stopped) can filter
/// out late-arriving events from a superseded request instead of having
/// them corrupt its current rows.
#[derive(Clone, serde::Serialize)]
struct MessagesBatchEvent {
    request_id: String,
    message: kafkaoxide_core::TopicMessage,
}

/// How often (in messages received) to log fetch progress to the Logs
/// panel — frequent enough to reassure the user a large fetch is still
/// moving, without flooding the panel on a fast, high-volume topic.
const PROGRESS_LOG_INTERVAL: usize = 25;

/// Backs the topic Data tab's Fetch button. Streams each message to the
/// frontend via the `"messages-batch"` event as soon as it's polled (see
/// `MessagesBatchEvent`), in addition to returning the full, authoritative
/// `MessageFetchResult` once the fetch completes — the frontend uses the
/// stream to paint rows incrementally and then reconciles with the final
/// result on success. `MessageFetchResult::total_matching` lets the Data tab
/// show "42 loaded of 150 matching" so the user can tell whether more
/// messages remain beyond what this fetch actually pulled.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connection_fetch_messages(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    topic: String,
    filter: kafkaoxide_core::MessageFilter,
    request_id: String,
    read_timeout_ms: u64,
    max_message_size_bytes: u32,
) -> Result<kafkaoxide_core::MessageFetchResult, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    crate::logging::emit_log(&app, "info", format!("Fetching messages for topic \"{topic}\"..."));

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<kafkaoxide_core::TopicMessage>();
    let forward_task = {
        let app = app.clone();
        let topic = topic.clone();
        let request_id = request_id.clone();
        tokio::spawn(async move {
            let mut count = 0usize;
            while let Some(message) = rx.recv().await {
                count += 1;
                let _ = app.emit(
                    "messages-batch",
                    MessagesBatchEvent {
                        request_id: request_id.clone(),
                        message,
                    },
                );
                if count % PROGRESS_LOG_INTERVAL == 0 {
                    crate::logging::emit_log(
                        &app,
                        "info",
                        format!("Fetched {count} messages for topic \"{topic}\" so far..."),
                    );
                }
            }
        })
    };

    let result = state
        .kafka
        .fetch_messages(
            &connection,
            &topic,
            &filter,
            Some(tx),
            Duration::from_millis(read_timeout_ms),
            max_message_size_bytes,
        )
        .await;
    let _ = forward_task.await;

    match result {
        Ok(fetch_result) => {
            crate::logging::emit_log(
                &app,
                "info",
                format!(
                    "Fetched {} of {} matching messages for topic \"{topic}\"",
                    fetch_result.messages.len(),
                    fetch_result.total_matching
                ),
            );
            if let Some(poll_error) = &fetch_result.poll_error {
                crate::logging::emit_log(
                    &app,
                    "error",
                    format!(
                        "Fetch for topic \"{topic}\" hit a poll error before finishing: {poll_error}"
                    ),
                );
            }
            Ok(fetch_result)
        }
        Err(err) => {
            let command_err: CommandError = err.into();
            crate::logging::emit_log(
                &app,
                "error",
                format!("Failed to fetch messages for topic \"{topic}\": {}", command_err.message),
            );
            Err(command_err)
        }
    }
}

/// Backs the topic detail panel's Partitions tab.
#[tauri::command]
pub async fn connection_list_partitions(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    read_timeout_ms: u64,
) -> Result<Vec<kafkaoxide_core::PartitionSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .list_partitions(&connection, &topic, Duration::from_millis(read_timeout_ms))
        .await?)
}

/// Backs the topic detail panel's Config tab.
#[tauri::command]
pub async fn connection_describe_topic_config(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    read_timeout_ms: u64,
) -> Result<Vec<kafkaoxide_core::ConfigEntry>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .describe_topic_config(&connection, &topic, Duration::from_millis(read_timeout_ms))
        .await?)
}

/// Backs the consumer group detail panel's "Refresh" button.
#[tauri::command]
pub async fn connection_fetch_consumer_group_lag(
    state: State<'_, AppState>,
    id: String,
    group_id: String,
    read_timeout_ms: u64,
) -> Result<kafkaoxide_core::ConsumerGroupLag, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    Ok(state
        .kafka
        .fetch_consumer_group_lag(&connection, &group_id, Duration::from_millis(read_timeout_ms))
        .await?)
}
