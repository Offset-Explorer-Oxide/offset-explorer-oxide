use crate::state::AppState;
use error_stack::ResultExt;
use kafkaoxide_core::{
    partition_importable, select_for_export, AppError, Connection, ConnectionExportFile, ConnectionStatus,
    NewConnection,
};
use kafkaoxide_kafka::BrokerSslConfig;
use std::collections::HashSet;
use tauri::{AppHandle, State};

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

/// The New Connection modal's SASL, Schema Registry, and broker-SSL secret
/// fields, each stored under its own keyed slot in the OS keychain (see
/// `kafkaoxide_secrets::SecretStore`) rather than in the database.
const SECRET_KEYS: [&str; 8] = [
    "sasl_password",
    "schema_registry_basic_auth_credentials",
    "schema_registry_trust_store_password",
    "schema_registry_keystore_password",
    "schema_registry_keystore_key_password",
    "ssl_truststore_password",
    "ssl_keystore_password",
    "ssl_keystore_key_password",
];

fn secret_values(new_connection: &NewConnection) -> [Option<&str>; 8] {
    [
        new_connection.sasl_password.as_deref(),
        new_connection.schema_registry_basic_auth_credentials.as_deref(),
        new_connection.schema_registry_trust_store_password.as_deref(),
        new_connection.schema_registry_keystore_password.as_deref(),
        new_connection.schema_registry_keystore_key_password.as_deref(),
        new_connection.ssl_truststore_password.as_deref(),
        new_connection.ssl_keystore_password.as_deref(),
        new_connection.ssl_keystore_key_password.as_deref(),
    ]
}

fn store_secrets(state: &AppState, connection_id: &str, new_connection: &NewConnection) -> Result<(), CommandError> {
    for (key, value) in SECRET_KEYS.iter().zip(secret_values(new_connection)) {
        match value {
            Some(value) => state.secrets.set_secret(connection_id, key, value)?,
            None => state.secrets.delete_secret(connection_id, key)?,
        }
    }
    Ok(())
}

/// Looks up a saved connection's SASL password from the OS keychain — `None`
/// for connections with no SASL mechanism, or whose password was left blank.
fn sasl_password(state: &AppState, connection_id: &str) -> Result<Option<String>, CommandError> {
    Ok(state.secrets.get_password(connection_id)?)
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
    store_secrets(&state, &connection.id, &new_connection)?;
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
    store_secrets(&state, &connection.id, &new_connection)?;
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
    for key in SECRET_KEYS {
        state.secrets.delete_secret(&id, key)?;
    }
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
/// credentials: `select_for_export` only ever produces `PortableConnection`s,
/// which have no secret fields to begin with.
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
    let password = sasl_password(&state, &id)?;
    Ok(state.kafka.check_status(&connection, password.as_deref()).await?)
}

/// Backs the ping button next to "Bootstrap servers" in the New Connection
/// modal's General section — a plaintext reachability probe of whatever the
/// user has typed so far, independent of the Security tab.
#[tauri::command]
pub async fn connection_ping_bootstrap(
    state: State<'_, AppState>,
    bootstrap_servers: String,
) -> Result<ConnectionStatus, CommandError> {
    Ok(state.kafka.ping_bootstrap(&bootstrap_servers).await?)
}

/// Backs the ping button next to "Host" in the New Connection modal's
/// Zookeeper section.
#[tauri::command]
pub async fn connection_ping_zookeeper(
    state: State<'_, AppState>,
    host: String,
    port: u16,
) -> Result<ConnectionStatus, CommandError> {
    Ok(state.zookeeper.ping(&host, port).await)
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
    let password = sasl_password(&state, &id)?;
    let status = state.kafka.check_status(&connection, password.as_deref()).await?;
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
#[tauri::command]
pub async fn connection_list_brokers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<kafkaoxide_core::BrokerSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state.kafka.list_brokers(&connection, password.as_deref()).await?)
}

/// Backs the tree's "Topics" sub-list once a cluster is connected.
#[tauri::command]
pub async fn connection_list_topics(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<kafkaoxide_core::TopicSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state.kafka.list_topics(&connection, password.as_deref()).await?)
}

/// Backs the tree's "Consumers" sub-list once a cluster is connected.
#[tauri::command]
pub async fn connection_list_consumer_groups(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<kafkaoxide_core::ConsumerGroupSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state.kafka.list_consumer_groups(&connection, password.as_deref()).await?)
}

/// Backs the topic detail panel's Properties > Messages "Refresh" button.
#[tauri::command]
pub async fn connection_count_topic_messages(
    state: State<'_, AppState>,
    id: String,
    topic: String,
) -> Result<u64, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state
        .kafka
        .count_topic_messages(&connection, &topic, password.as_deref())
        .await?)
}

/// Backs the topic Data tab's Fetch button.
#[tauri::command]
pub async fn connection_fetch_messages(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    filter: kafkaoxide_core::MessageFilter,
) -> Result<Vec<kafkaoxide_core::TopicMessage>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state
        .kafka
        .fetch_messages(&connection, &topic, &filter, password.as_deref())
        .await?)
}

/// Backs the topic detail panel's Partitions tab.
#[tauri::command]
pub async fn connection_list_partitions(
    state: State<'_, AppState>,
    id: String,
    topic: String,
) -> Result<Vec<kafkaoxide_core::PartitionSummary>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state
        .kafka
        .list_partitions(&connection, &topic, password.as_deref())
        .await?)
}

/// Backs the topic detail panel's Config tab.
#[tauri::command]
pub async fn connection_describe_topic_config(
    state: State<'_, AppState>,
    id: String,
    topic: String,
) -> Result<Vec<kafkaoxide_core::ConfigEntry>, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state
        .kafka
        .describe_topic_config(&connection, &topic, password.as_deref())
        .await?)
}

/// Backs the consumer group detail panel's "Refresh" button.
#[tauri::command]
pub async fn connection_fetch_consumer_group_lag(
    state: State<'_, AppState>,
    id: String,
    group_id: String,
) -> Result<kafkaoxide_core::ConsumerGroupLag, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = sasl_password(&state, &id)?;
    Ok(state
        .kafka
        .fetch_consumer_group_lag(&connection, &group_id, password.as_deref())
        .await?)
}
