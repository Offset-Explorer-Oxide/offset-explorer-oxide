use crate::commands::connections::CommandError;
use crate::state::AppState;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Report, ResultExt};
use kafkaoxide_core::AppError;
use kafkaoxide_schema_registry::{SchemaRegistryAuth, SchemaRegistryClient};
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

/// Backs the payload viewer's "Avro" mode. Decode precedence: if the
/// payload is itself an Avro Object Container File (schema embedded in the
/// message), decode it directly — a manual or registry schema would never
/// match its framing anyway, so this check wins outright. Otherwise a
/// manual per-topic schema wins when set (decoding the whole payload — no
/// wire-format header to strip); otherwise, if the payload carries the
/// Confluent wire-format header and this connection has a Schema Registry
/// configured, fetch the schema by the embedded id and decode the bytes
/// after the 5-byte header.
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

    if kafkaoxide_avro::detect_container_file(&bytes) {
        return Ok(kafkaoxide_avro::decode_container(&bytes)?);
    }

    if let Some(manual_schema) = kafkaoxide_db::topic_schemas::get(&state.pool, &id, &topic, "avro").await? {
        return Ok(kafkaoxide_avro::decode(&bytes, &manual_schema)?);
    }

    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;

    let schema_id = kafkaoxide_avro::detect_wire_format(&bytes).ok_or_else(|| {
        CommandError::from(Report::new(AppError::Decode).attach_printable(
            "payload has no Confluent Avro wire-format header and no manual schema is set for this topic",
        ))
    })?;

    let endpoint = connection.schema_registry_endpoint.as_deref().ok_or_else(|| {
        CommandError::from(Report::new(AppError::Decode).attach_printable(
            "no manual schema is set for this topic and this connection has no Schema Registry configured",
        ))
    })?;

    let auth = SchemaRegistryAuth {
        basic_auth_credentials: connection.schema_registry_basic_auth_credentials.as_deref(),
        trust_store_location: connection.schema_registry_trust_store_location.as_deref(),
        keystore_location: connection.schema_registry_keystore_location.as_deref(),
        keystore_password: connection.schema_registry_keystore_password.as_deref(),
    };
    let client = SchemaRegistryClient::new(endpoint, auth)?;
    let schema_text = client.fetch_schema_by_id(schema_id).await?;

    Ok(kafkaoxide_avro::decode(&bytes[5..], &schema_text)?)
}
