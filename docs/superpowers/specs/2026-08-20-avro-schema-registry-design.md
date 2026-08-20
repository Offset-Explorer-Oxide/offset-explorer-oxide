# Avro Decoding (Schema Registry + Manual Schema) — Design

**Goal:** Decode Avro-encoded Kafka message payloads into the existing JSON tree viewer, using either the connection's configured Schema Registry or a manually-supplied per-topic schema.

**Context:** `payloadDecoding.ts`'s `detectConfluentAvro` already recognizes the Confluent wire format (magic byte `0x00` + 4-byte big-endian schema id) and `MessagePayloadViewer` shows a static banner ("schema registry decoding not implemented"). The `Connection`/`NewConnection` types already carry a full set of schema-registry fields (`schemaRegistryEndpoint`, basic auth credentials, trust store, keystore + passwords) collected by the connection modal, but nothing reads them — this spec wires them up. This is the first of three formats being added in priority order: **Avro (this spec) → Protobuf → XML**. XML needs no schema/registry work at all; Protobuf will reuse the schema-registry crate this spec introduces.

---

## Backend approach

### New crates

- **`backend/schema-registry`** (`kafkaoxide-schema-registry`): an HTTP client for the Confluent Schema Registry API, built from a connection's registry config. Its only job is "given a schema id, return the schema text" — format-agnostic, so the same crate serves Protobuf later.
  ```rust
  pub struct SchemaRegistryClient { /* reqwest::Client + base_url + in-memory cache */ }

  pub struct SchemaRegistryAuth<'a> {
      pub basic_auth_credentials: Option<&'a str>,   // "username:password"
      pub trust_store_location: Option<&'a str>,      // PEM CA cert
      pub keystore_location: Option<&'a str>,         // PKCS12 client cert
      pub keystore_password: Option<&'a str>,
  }

  impl SchemaRegistryClient {
      pub fn new(endpoint: &str, auth: SchemaRegistryAuth<'_>) -> Result<Self, AppError>;
      pub async fn fetch_schema_by_id(&self, id: u32) -> Result<String, AppError>;
  }
  ```
  - `GET {endpoint}/schemas/ids/{id}`, parses the `{"schema": "..."}` response body.
  - Basic auth via `reqwest::RequestBuilder::basic_auth`, splitting `"username:password"` on the first `:`.
  - mTLS via `reqwest::Identity::from_pkcs12_der` (keystore bytes + `keystore_password`) and `reqwest::Certificate::from_pem` (trust store), mirroring the existing broker-SSL scope boundary: `keystore_key_password` is accepted/stored by the connection form but not applied here either, matching `ssl_keystore_key_password`'s current treatment in `kafkaoxide-kafka`'s `client_config`.
  - In-memory cache: `Mutex<HashMap<u32, String>>` on the client instance. Schema ids are immutable once registered, so this never needs invalidation — only a fresh `SchemaRegistryClient` (one built per command call) starts cold, which is an acceptable simplification for v1 (see "Not doing").

- **`backend/avro`** (`kafkaoxide-avro`): pure decode logic, no I/O, no knowledge of where the schema came from.
  ```rust
  pub fn decode(bytes: &[u8], schema_json: &str) -> Result<serde_json::Value, AppError>;
  ```
  Uses the `apache-avro` crate: parse the schema, read `bytes` as a single Avro value (no container-file framing — these are individual Kafka message bodies), convert `apache_avro::types::Value` to `serde_json::Value` by hand (union variants unwrap to their inner value; `Value::Bytes`/`Value::Fixed` become base64 strings so the JSON tree can render them; everything else maps directly).

### Data model (`kafkaoxide-db`)

One new table, shaped to hold Protobuf's manual schemas too once that lands, rather than adding a second near-identical table next spec:

```sql
CREATE TABLE topic_schemas (
    connection_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('avro', 'protobuf')),
    schema_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, topic, format)
);
```

`kafkaoxide-db::topic_schemas`: `get`, `set` (upsert), `delete`, and `delete_all_for_connection` (called from `connection_delete` — no `ON DELETE CASCADE`, since this app never enables SQLite's `foreign_keys` pragma, so a declared FK here would silently never fire) — same shape as the existing `connections`/`tabs` modules' CRUD functions.

### Decode decision order

For a given `(connection_id, topic, payload_bytes)`:

1. **Manual schema wins if set.** Look up `topic_schemas(connection_id, topic, 'avro')`. If present, decode the *entire* payload directly against it — no wire-format header to strip (per the "no registry, so no wire format either" assumption this design confirmed with the user).
2. **Else, try the registry.** If the payload starts with the Confluent wire-format header (`detect_wire_format`, a small backend-side port of the frontend's `detectConfluentAvro`) *and* the connection has `schema_registry_endpoint` set, fetch the schema by the embedded id (building a `SchemaRegistryClient` from the connection's registry fields + secrets looked up via `SecretStore`) and decode the bytes *after* the 5-byte header.
3. **Else, no schema available.** Return a descriptive `AppError` ("no manual schema set for this topic and no Schema Registry configured on this connection" / "payload has no Confluent Avro header").

### Tauri commands

```rust
#[tauri::command]
pub async fn topic_schema_get(state: State<'_, AppState>, connection_id: String, topic: String, format: String) -> Result<Option<String>, CommandError>;

#[tauri::command]
pub async fn topic_schema_set(state: State<'_, AppState>, connection_id: String, topic: String, format: String, schema_text: String) -> Result<(), CommandError>;

#[tauri::command]
pub async fn topic_schema_delete(state: State<'_, AppState>, connection_id: String, topic: String, format: String) -> Result<(), CommandError>;

#[tauri::command]
pub async fn connection_decode_avro(state: State<'_, AppState>, id: String, topic: String, payload_base64: String) -> Result<serde_json::Value, CommandError>;
```

`connection_decode_avro` runs the decision order above; `payload_base64` decoded the same way the frontend already decodes it for text/JSON display (`base64ToBytes`'s backend equivalent).

---

## Frontend

- `api.decodeAvro(connectionId, topic, payloadBase64) -> Promise<unknown>`, `api.getTopicSchema/setTopicSchema/deleteTopicSchema(connectionId, topic, format)`.
- **`MessagePayloadViewer`**: a third mode button, "Avro", next to Text/JSON. Clicking it calls `decodeAvro` and renders the result through the existing `JsonTreeView` (decoded Avro is already JSON-shaped — no new viewer component). A failed decode shows `role="alert"` with the backend's descriptive error text (reusing the existing error-banner convention) instead of the current static "not implemented" banner, which is removed.
- **Topic detail panel**: new "Schema" tab — a textarea for the Avro schema JSON (`.avsc` text), Save/Clear buttons calling `setTopicSchema`/`deleteTopicSchema`, pre-filled via `getTopicSchema` on open. Scaffolded generically enough (a `format` prop) that Protobuf's manual schema reuses the same component next spec.

---

## Error handling & edge cases

- **Registry unreachable / non-200 response:** surfaced as the command's error text verbatim-ish ("Schema Registry request failed: …"), shown in the payload viewer's alert banner — same pattern as every other backend failure in this app.
- **Schema id not found in registry (404):** distinct message ("Schema id 42 not found in registry") rather than a generic network-error string.
- **Payload isn't valid Avro for the resolved schema:** `apache_avro`'s decode error surfaces as "Payload isn't valid Avro for this schema."
- **Manual schema text is invalid Avro schema JSON:** rejected at `topic_schema_set` time (parse-validate before saving), so a broken schema can't silently get persisted — the Save button shows the parse error instead of writing.
- **No registry and no manual schema, payload has no wire-format header either:** same "not decodable" messaging as today's banner, just phrased as an error rather than an inert notice.

---

## Testing

- **`kafkaoxide-avro`:** `decode` unit-tested with hand-built schema+payload fixtures covering primitives, records, nested records, unions (including null-union, the common "optional field" case), arrays, maps, and bytes/fixed → base64. Malformed-payload-for-schema is a dedicated error-path test.
- **`kafkaoxide-schema-registry`:** `fetch_schema_by_id` tested against a local mock HTTP server (`wiremock` or a hand-rolled `tiny_http` stub — whichever is already idiomatic for this workspace's test style; if neither, a minimal one-off listener) covering: success, 404, basic-auth header sent correctly, and the in-memory cache actually skipping a second request for the same id.
- **`kafkaoxide-db::topic_schemas`:** round-trip get/set/delete tests against the existing sqlite test-db harness, same style as `connections.rs`'s tests.
- **Backend commands:** thin wiring, reviewed by hand (as with every other command — `src-tauri` still can't build in this sandbox).
- **Frontend:** `MessagePayloadViewer` gains tests for the Avro mode button — successful decode renders via `JsonTreeView`, a failed decode shows the alert banner with the backend's message. A new `TopicSchemaTab`-equivalent test file covers load/save/clear round-tripping through mocked `invoke`.

---

## Not doing (this spec)

- **Schema registry client caching across calls.** Each `connection_decode_avro` invocation builds a fresh `SchemaRegistryClient`, so the in-memory schema cache only helps within a single command call's lifetime (moot for Avro, which fetches at most one schema per call) — this matters more once Protobuf's multi-schema-reference resolution lands, at which point a connection-scoped client cache (keyed by connection id, held in `AppState`) is worth adding. Flagging now so it isn't a surprise later, not building it speculatively yet.
- **`schema_registry_keystore_key_password`.** Accepted/stored by the connection form; not applied to the mTLS identity, matching the existing unimplemented state of the equivalent broker-SSL field.
- **Avro Object Container File format** (the file-level framing with an embedded schema + sync markers). Kafka messages are individual records, not OCF files, so this isn't needed.
