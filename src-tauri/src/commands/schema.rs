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
/// Both DB inputs are local SQLite reads, so they are fetched up front rather
/// than lazily per branch: it costs one extra cheap read on the container-file
/// path and buys a single, testable rule instead of an order of `if`s.
///
/// **Every CPU-bound step runs on the blocking pool.** Base64-decoding a
/// payload, parsing an Avro schema, decoding the record and building the
/// `serde_json::Value` for it are all O(payload) and none of them yield —
/// inline, a multi-megabyte message stalled one of the async runtime's worker
/// threads for the whole decode, and every other command scheduled on that
/// worker (a status poll, another cluster's topic listing) waited behind a
/// message the user happened to open. There are two blocking hops rather than
/// one because the registry path has to `await` an HTTP fetch in the middle,
/// which a blocking closure cannot do.
#[tauri::command]
pub async fn connection_decode_avro(
    state: State<'_, AppState>,
    id: String,
    topic: String,
    payload_base64: String,
) -> Result<serde_json::Value, CommandError> {
    // First, exactly as before: an unusable payload is reported as such
    // rather than as whatever the database lookups below happen to say.
    let bytes = tokio::task::spawn_blocking(move || {
        BASE64
            .decode(&payload_base64)
            .change_context(AppError::Decode)
            .attach_printable("payload isn't valid base64")
    })
    .await
    .change_context(AppError::Decode)
    .attach_printable("base64 decode task panicked")??;

    let manual_schema = kafkaoxide_db::topic_schemas::get(&state.pool, &id, &topic, "avro").await?;
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let has_registry_endpoint = connection.schema_registry_endpoint.is_some();

    /// What the first blocking hop produced: either the finished value, or
    /// the payload handed back with the schema id that still has to be
    /// resolved against the registry.
    enum DecodeOutcome {
        Decoded(serde_json::Value),
        NeedsRegistrySchema { bytes: Vec<u8>, schema_id: u32 },
    }

    let outcome = tokio::task::spawn_blocking(
        move || -> Result<DecodeOutcome, Report<AppError>> {
            let strategy =
                kafkaoxide_avro::decide_decode_strategy(&bytes, manual_schema.is_some(), has_registry_endpoint)
                    .map_err(|refusal| Report::new(AppError::Decode).attach_printable(refusal.message()))?;

            match strategy {
                kafkaoxide_avro::AvroDecodeStrategy::ContainerFile => {
                    Ok(DecodeOutcome::Decoded(kafkaoxide_avro::decode_container(&bytes)?))
                }
                kafkaoxide_avro::AvroDecodeStrategy::ManualSchema => {
                    let schema =
                        manual_schema.expect("the strategy is only chosen when a manual schema exists");
                    Ok(DecodeOutcome::Decoded(kafkaoxide_avro::decode(&bytes, &schema)?))
                }
                kafkaoxide_avro::AvroDecodeStrategy::SchemaRegistry { schema_id } => {
                    Ok(DecodeOutcome::NeedsRegistrySchema { bytes, schema_id })
                }
            }
        },
    )
    .await
    .change_context(AppError::Decode)
    .attach_printable("avro decode task panicked")??;

    let (bytes, schema_id) = match outcome {
        DecodeOutcome::Decoded(value) => return Ok(value),
        DecodeOutcome::NeedsRegistrySchema { bytes, schema_id } => (bytes, schema_id),
    };

    let endpoint = connection
        .schema_registry_endpoint
        .as_deref()
        .expect("the strategy is only chosen when an endpoint is configured");

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

    let value = tokio::task::spawn_blocking(move || -> Result<serde_json::Value, Report<AppError>> {
        // The 5-byte Confluent header (magic byte + schema id) is what
        // `decide_decode_strategy` matched on; the record itself starts after
        // it.
        Ok(kafkaoxide_avro::decode(&bytes[5..], &schema_text)?)
    })
    .await
    .change_context(AppError::Decode)
    .attach_printable("avro decode task panicked")??;

    Ok(value)
}
