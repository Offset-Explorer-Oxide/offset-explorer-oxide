use crate::commands::connections::CommandError;
use crate::state::AppState;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Report, ResultExt};
use kafkaoxide_core::AppError;
use kafkaoxide_schema_registry::SchemaRegistryAuth;
use tauri::State;

#[tauri::command]
pub async fn topic_schema_get(
    state: State<'_, AppState>,
    connection_id: String,
    topic: String,
    format: String,
) -> Result<Option<String>, CommandError> {
    Ok(kafkaoxide_db::topic_schemas::get(&state.pool, &connection_id, &topic, &format).await?)
}

#[tauri::command]
pub async fn topic_schema_set(
    state: State<'_, AppState>,
    connection_id: String,
    topic: String,
    format: String,
    schema_text: String,
) -> Result<(), CommandError> {
    if format == "avro" {
        kafkaoxide_avro::validate_schema(&schema_text)?;
    }
    Ok(kafkaoxide_db::topic_schemas::set(&state.pool, &connection_id, &topic, &format, &schema_text).await?)
}

#[tauri::command]
pub async fn topic_schema_delete(
    state: State<'_, AppState>,
    connection_id: String,
    topic: String,
    format: String,
) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::topic_schemas::delete(&state.pool, &connection_id, &topic, &format).await?)
}

/// Backs the payload viewer's "Avro" mode.
///
/// The decode *precedence* — container file, then a manual per-topic schema,
/// then the Confluent header — lives in
/// `kafkaoxide_avro::decide_decode_strategy`, where it is unit-tested. It used
/// to be spelled out inline here, and this crate needs a desktop toolchain to
/// build, so the rule most likely to surprise a user (a pasted schema silently
/// overriding their registry) had no test anywhere. This function now only
/// gathers the inputs and carries out the decision.
///
/// Both inputs are local SQLite reads, so they are fetched up front rather
/// than lazily per branch: it costs one extra cheap read on the container-file
/// path and buys a single, testable rule instead of an order of `if`s.
#[tauri::command]
pub async fn connection_decode_avro(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    payload_base64: String,
) -> Result<serde_json::Value, CommandError> {
    let bytes = BASE64
        .decode(&payload_base64)
        .change_context(AppError::Decode)
        .attach_printable("payload isn't valid base64")?;

    let manual_schema = kafkaoxide_db::topic_schemas::get(&state.pool, &id, &topic, "avro").await?;
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let endpoint = connection.schema_registry_endpoint.as_deref();

    let strategy = kafkaoxide_avro::decide_decode_strategy(&bytes, manual_schema.is_some(), endpoint.is_some())
        .map_err(|refusal| {
            CommandError::from(Report::new(AppError::Decode).attach_printable(refusal.message()))
        })?;

    let schema_id = match strategy {
        kafkaoxide_avro::AvroDecodeStrategy::ContainerFile => {
            return Ok(kafkaoxide_avro::decode_container(&bytes)?);
        }
        kafkaoxide_avro::AvroDecodeStrategy::ManualSchema => {
            let schema = manual_schema.expect("the strategy is only chosen when a manual schema exists");
            return Ok(kafkaoxide_avro::decode(&bytes, &schema)?);
        }
        kafkaoxide_avro::AvroDecodeStrategy::SchemaRegistry { schema_id } => schema_id,
    };
    let endpoint = endpoint.expect("the strategy is only chosen when an endpoint is configured");

    let auth = SchemaRegistryAuth {
        basic_auth_credentials: connection.schema_registry_basic_auth_credentials.as_deref(),
        trust_store_location: connection.schema_registry_trust_store_location.as_deref(),
        keystore_location: connection.schema_registry_keystore_location.as_deref(),
        keystore_password: connection.schema_registry_keystore_password.as_deref(),
    };
    // Pooled per connection rather than built here: this command runs once
    // per message the user opens in Avro mode, and a per-call client threw
    // away both its HTTPS connection and its schema cache every time — so
    // browsing one topic re-fetched the same schema id, over a fresh TLS
    // handshake, for every single message. See `SchemaRegistryClients`.
    let client = state.schema_registry.get_or_create(&id, endpoint, auth)?;
    let schema_text = client.fetch_schema_by_id(schema_id).await?;

    Ok(kafkaoxide_avro::decode(&bytes[5..], &schema_text)?)
}
