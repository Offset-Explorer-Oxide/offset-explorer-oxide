# Avro Decoding (Schema Registry + Manual Schema) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode Avro-encoded Kafka message payloads into the existing JSON tree viewer, using a connection's Schema Registry or a manually-supplied per-topic schema, per `docs/superpowers/specs/2026-08-20-avro-schema-registry-design.md`.

**Architecture:** Two new pure/IO-isolated backend crates — `kafkaoxide-avro` (schema parse + decode + Confluent wire-format detection, no I/O) and `kafkaoxide-schema-registry` (HTTP client, cached schema-by-id lookups, TLS/basic-auth) — plus a new `topic_schemas` DB table for manual overrides, four thin Tauri commands, and a frontend "Avro" mode next to the payload viewer's existing Text/JSON toggle, backed by a new "Schema" tab on the topic detail panel.

**Tech Stack:** Rust (`apache-avro`, `reqwest` with `native-tls-vendored`, `sqlx`), React/TypeScript (`@tanstack/react-query`), existing `useClusterResources`/`useMessageViewerStore` patterns.

**Sandbox note:** every crate below except `src-tauri` builds and tests in this sandbox (verified: `reqwest` needs the `native-tls-vendored` feature specifically — plain `native-tls`/`default-tls` fails here for lack of system `pkg-config`/OpenSSL dev headers, and `rustls-tls` can't load PKCS12 keystores, which this app's existing SSL fields assume). `src-tauri` still can't build here (no GTK/pkg-config) — its tasks are reviewed by hand, same as every other command in this codebase.

---

### Task 1: `AppError` — new `SchemaRegistry`/`Decode` variants

**Files:**
- Modify: `backend/core/src/error.rs`

- [ ] **Step 1: Add the variants and extend the existing Display test**

In `backend/core/src/error.rs`, change:
```rust
#[derive(Debug)]
pub enum AppError {
    Db,
    Kafka,
    Secrets,
    Validation,
    NotFound,
    Zookeeper,
}
```
to:
```rust
#[derive(Debug)]
pub enum AppError {
    Db,
    Kafka,
    Secrets,
    Validation,
    NotFound,
    Zookeeper,
    SchemaRegistry,
    Decode,
}
```

Change the `Display` impl's match from:
```rust
            AppError::Zookeeper => write!(f, "zookeeper error"),
```
to:
```rust
            AppError::Zookeeper => write!(f, "zookeeper error"),
            AppError::SchemaRegistry => write!(f, "schema registry error"),
            AppError::Decode => write!(f, "payload decode error"),
```

Extend the existing test:
```rust
    #[test]
    fn displays_a_human_readable_message_per_variant() {
        assert_eq!(AppError::Db.to_string(), "database error");
        assert_eq!(AppError::NotFound.to_string(), "not found");
        assert_eq!(AppError::Zookeeper.to_string(), "zookeeper error");
        assert_eq!(AppError::SchemaRegistry.to_string(), "schema registry error");
        assert_eq!(AppError::Decode.to_string(), "payload decode error");
    }
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p kafkaoxide-core`
Expected: `test result: ok. 24 passed; 0 failed;` (same count — this extends an existing test, no new `#[test]` fn).

- [ ] **Step 3: Commit**

```bash
git add backend/core/src/error.rs
git commit -m "feat(core): add SchemaRegistry and Decode AppError variants"
```

---

### Task 2: `kafkaoxide-avro` crate — decode, wire-format detection, schema validation

**Files:**
- Create: `backend/avro/Cargo.toml`
- Create: `backend/avro/src/lib.rs`
- Modify: `Cargo.toml` (workspace root)

- [ ] **Step 1: Register the crate in the workspace**

In the workspace root `Cargo.toml`, change:
```toml
members = [
  "backend/core",
  "backend/db",
  "backend/secrets",
  "backend/kafka",
  "src-tauri",
]
```
to:
```toml
members = [
  "backend/core",
  "backend/db",
  "backend/secrets",
  "backend/kafka",
  "backend/avro",
  "backend/schema-registry",
  "src-tauri",
]
```
(`backend/schema-registry` doesn't exist yet — it's created in Task 3 — but listing it now means Task 3 doesn't need another workspace-root edit.)

Add to `[workspace.dependencies]`, right after the existing `kafkaoxide-kafka` line:
```toml
kafkaoxide-avro = { path = "backend/avro" }
kafkaoxide-schema-registry = { path = "backend/schema-registry" }
```

- [ ] **Step 2: Create the crate manifest**

Create `backend/avro/Cargo.toml`:
```toml
[package]
name = "kafkaoxide-avro"
version = "0.1.0"
edition = "2021"

[dependencies]
kafkaoxide-core = { workspace = true }
error-stack = { workspace = true }
serde_json = { workspace = true }
apache-avro = "0.16"
base64 = "0.22"
```

- [ ] **Step 3: Write `detect_wire_format`, `validate_schema`, `decode`, with tests**

Create `backend/avro/src/lib.rs`:
```rust
use apache_avro::types::Value;
use apache_avro::Schema;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;

/// Confluent wire-format header: a leading magic byte (0x00) followed by a
/// 4-byte big-endian schema id. Mirrors the frontend's
/// `detectConfluentAvro` (`payloadDecoding.ts`) — used here to decide
/// whether a payload is eligible for a Schema Registry lookup.
pub fn detect_wire_format(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 5 || bytes[0] != 0x00 {
        return None;
    }
    Some(u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]))
}

/// Parses `schema_json` without decoding anything — used to reject an
/// invalid manually-entered schema at save time instead of only failing
/// later, the first time someone tries to view a message with it.
pub fn validate_schema(schema_json: &str) -> Result<(), AppError> {
    Schema::parse_str(schema_json)
        .change_context(AppError::Decode)
        .attach_printable("invalid Avro schema")?;
    Ok(())
}

/// Decodes `bytes` as a single Avro value against `schema_json`, returning
/// it as a `serde_json::Value` the existing JSON tree viewer can render
/// directly. No container-file framing — Kafka messages are individual
/// records, not Avro Object Container Files.
pub fn decode(bytes: &[u8], schema_json: &str) -> Result<serde_json::Value, AppError> {
    let schema = Schema::parse_str(schema_json)
        .change_context(AppError::Decode)
        .attach_printable("invalid Avro schema")?;
    let mut reader = bytes;
    let value = apache_avro::from_avro_datum(&schema, &mut reader, None)
        .change_context(AppError::Decode)
        .attach_printable("payload isn't valid Avro for this schema")?;
    Ok(to_json_value(value))
}

fn to_json_value(value: Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Boolean(b) => serde_json::Value::Bool(b),
        Value::Int(i) => serde_json::Value::from(i),
        Value::Long(i) => serde_json::Value::from(i),
        Value::Float(f) => serde_json::json!(f),
        Value::Double(f) => serde_json::json!(f),
        Value::Bytes(b) => serde_json::Value::String(BASE64.encode(b)),
        Value::String(s) => serde_json::Value::String(s),
        Value::Fixed(_, b) => serde_json::Value::String(BASE64.encode(b)),
        Value::Enum(_, s) => serde_json::Value::String(s),
        Value::Union(_, inner) => to_json_value(*inner),
        Value::Array(items) => serde_json::Value::Array(items.into_iter().map(to_json_value).collect()),
        Value::Map(map) => serde_json::Value::Object(map.into_iter().map(|(k, v)| (k, to_json_value(v))).collect()),
        Value::Record(fields) => {
            serde_json::Value::Object(fields.into_iter().map(|(k, v)| (k, to_json_value(v))).collect())
        }
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const USER_SCHEMA: &str = r#"
    {
      "type": "record",
      "name": "User",
      "fields": [
        {"name": "id", "type": "long"},
        {"name": "name", "type": "string"},
        {"name": "active", "type": "boolean"},
        {"name": "nickname", "type": ["null", "string"], "default": null}
      ]
    }
    "#;

    const EVENT_SCHEMA: &str = r#"
    {
      "type": "record",
      "name": "Event",
      "fields": [
        {"name": "id", "type": "long"},
        {"name": "tags", "type": {"type": "array", "items": "string"}},
        {"name": "counts", "type": {"type": "map", "values": "long"}},
        {"name": "raw", "type": "bytes"},
        {"name": "owner", "type": {
          "type": "record",
          "name": "Owner",
          "fields": [{"name": "email", "type": "string"}]
        }}
      ]
    }
    "#;

    /// Builds Avro bytes for a `Value` by hand (not via `apache_avro`'s
    /// `Record`/`put` builder, which needs schema-internal field lookups
    /// for nested records) — `to_avro_datum` accepts any `Value` shaped
    /// like the schema, builder or not.
    fn encode(schema_json: &str, value: Value) -> Vec<u8> {
        let schema = Schema::parse_str(schema_json).unwrap();
        apache_avro::to_avro_datum(&schema, value).unwrap()
    }

    #[test]
    fn detects_a_valid_wire_format_header() {
        let bytes = [0x00, 0x00, 0x00, 0x00, 0x2a, 0x01, 0x02];
        assert_eq!(detect_wire_format(&bytes), Some(42));
    }

    #[test]
    fn rejects_a_payload_shorter_than_the_header() {
        assert_eq!(detect_wire_format(&[0x00, 0x00, 0x00, 0x00]), None);
    }

    #[test]
    fn rejects_a_payload_with_the_wrong_magic_byte() {
        let bytes = [0x01, 0x00, 0x00, 0x00, 0x2a, 0x01, 0x02];
        assert_eq!(detect_wire_format(&bytes), None);
    }

    #[test]
    fn validate_schema_accepts_valid_avro_schema_json() {
        assert!(validate_schema(USER_SCHEMA).is_ok());
    }

    #[test]
    fn validate_schema_rejects_invalid_json() {
        assert!(validate_schema("{not valid avro schema").is_err());
    }

    #[test]
    fn decodes_primitive_and_string_fields() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(42)),
            ("name".to_string(), Value::String("Ada".into())),
            ("active".to_string(), Value::Boolean(true)),
            ("nickname".to_string(), Value::Union(0, Box::new(Value::Null))),
        ]);
        let bytes = encode(USER_SCHEMA, value);

        let decoded = decode(&bytes, USER_SCHEMA).unwrap();

        assert_eq!(decoded["id"], serde_json::json!(42));
        assert_eq!(decoded["name"], serde_json::json!("Ada"));
        assert_eq!(decoded["active"], serde_json::json!(true));
        assert_eq!(decoded["nickname"], serde_json::Value::Null);
    }

    #[test]
    fn unwraps_a_populated_union_to_its_inner_value() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(1)),
            ("name".to_string(), Value::String("Grace".into())),
            ("active".to_string(), Value::Boolean(false)),
            ("nickname".to_string(), Value::Union(1, Box::new(Value::String("G".into())))),
        ]);
        let bytes = encode(USER_SCHEMA, value);

        let decoded = decode(&bytes, USER_SCHEMA).unwrap();

        assert_eq!(decoded["nickname"], serde_json::json!("G"));
    }

    #[test]
    fn decodes_arrays_maps_bytes_and_nested_records() {
        let value = Value::Record(vec![
            ("id".to_string(), Value::Long(7)),
            ("tags".to_string(), Value::Array(vec![Value::String("a".into()), Value::String("b".into())])),
            ("counts".to_string(), Value::Map(HashMap::from([("x".to_string(), Value::Long(3))]))),
            ("raw".to_string(), Value::Bytes(vec![1, 2, 3])),
            (
                "owner".to_string(),
                Value::Record(vec![("email".to_string(), Value::String("ada@example.com".into()))]),
            ),
        ]);
        let bytes = encode(EVENT_SCHEMA, value);

        let decoded = decode(&bytes, EVENT_SCHEMA).unwrap();

        assert_eq!(decoded["id"], serde_json::json!(7));
        assert_eq!(decoded["tags"], serde_json::json!(["a", "b"]));
        assert_eq!(decoded["counts"]["x"], serde_json::json!(3));
        assert_eq!(decoded["raw"], serde_json::json!("AQID"));
        assert_eq!(decoded["owner"]["email"], serde_json::json!("ada@example.com"));
    }

    #[test]
    fn returns_an_error_for_a_payload_that_does_not_match_the_schema() {
        let bytes = vec![0xff, 0xff, 0xff];
        assert!(decode(&bytes, USER_SCHEMA).is_err());
    }

    #[test]
    fn returns_an_error_for_an_invalid_schema() {
        let bytes = vec![0x00];
        assert!(decode(&bytes, "{not valid avro schema").is_err());
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p kafkaoxide-avro`
Expected: `test result: ok. 10 passed; 0 failed;`

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml backend/avro
git commit -m "feat(avro): add kafkaoxide-avro crate — decode, wire-format detection, schema validation"
```

---

### Task 3: `kafkaoxide-schema-registry` crate — cached HTTP client

**Files:**
- Create: `backend/schema-registry/Cargo.toml`
- Create: `backend/schema-registry/src/lib.rs`

- [ ] **Step 1: Create the crate manifest**

Create `backend/schema-registry/Cargo.toml`:
```toml
[package]
name = "kafkaoxide-schema-registry"
version = "0.1.0"
edition = "2021"

[dependencies]
kafkaoxide-core = { workspace = true }
error-stack = { workspace = true }
serde = { workspace = true }
reqwest = { version = "0.12", default-features = false, features = ["json", "native-tls-vendored"] }

[dev-dependencies]
tokio = { workspace = true, features = ["io-util"] }
```

- [ ] **Step 2: Write `SchemaRegistryClient` with tests**

Create `backend/schema-registry/src/lib.rs`:
```rust
use error_stack::{Report, Result, ResultExt};
use kafkaoxide_core::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

/// Schema Registry TLS/auth material from a connection's Schema Registry
/// fields + secrets — mirrors `kafkaoxide_kafka::BrokerSslConfig`'s split
/// between locations (not secret) and passwords (from the OS keychain).
#[derive(Debug, Clone, Copy, Default)]
pub struct SchemaRegistryAuth<'a> {
    pub basic_auth_credentials: Option<&'a str>,
    pub trust_store_location: Option<&'a str>,
    pub keystore_location: Option<&'a str>,
    pub keystore_password: Option<&'a str>,
}

/// An HTTP client for the Confluent Schema Registry API, scoped to one
/// connection's endpoint/auth. `fetch_schema_by_id` caches results
/// in-memory for the client's lifetime — schema ids are immutable once
/// registered, so this never needs invalidating.
pub struct SchemaRegistryClient {
    http: reqwest::Client,
    base_url: String,
    basic_auth: Option<(String, String)>,
    cache: Mutex<HashMap<u32, String>>,
}

impl SchemaRegistryClient {
    pub fn new(endpoint: &str, auth: SchemaRegistryAuth<'_>) -> Result<Self, AppError> {
        let mut builder = reqwest::Client::builder();

        if let Some(location) = auth.trust_store_location {
            let pem = std::fs::read(location)
                .change_context(AppError::SchemaRegistry)
                .attach_printable_lazy(|| format!("failed to read trust store at {location}"))?;
            let cert = reqwest::Certificate::from_pem(&pem)
                .change_context(AppError::SchemaRegistry)
                .attach_printable("failed to parse trust store as PEM")?;
            builder = builder.add_root_certificate(cert);
        }

        if let (Some(location), Some(password)) = (auth.keystore_location, auth.keystore_password) {
            let der = std::fs::read(location)
                .change_context(AppError::SchemaRegistry)
                .attach_printable_lazy(|| format!("failed to read keystore at {location}"))?;
            let identity = reqwest::Identity::from_pkcs12_der(&der, password)
                .change_context(AppError::SchemaRegistry)
                .attach_printable("failed to parse keystore as PKCS12")?;
            builder = builder.identity(identity);
        }

        let http = builder
            .build()
            .change_context(AppError::SchemaRegistry)
            .attach_printable("failed to build Schema Registry HTTP client")?;

        let basic_auth = auth
            .basic_auth_credentials
            .and_then(|creds| creds.split_once(':'))
            .map(|(user, pass)| (user.to_string(), pass.to_string()));

        Ok(SchemaRegistryClient {
            http,
            base_url: endpoint.trim_end_matches('/').to_string(),
            basic_auth,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub async fn fetch_schema_by_id(&self, id: u32) -> Result<String, AppError> {
        if let Some(cached) = self.cache.lock().expect("schema cache lock poisoned").get(&id) {
            return Ok(cached.clone());
        }

        let url = format!("{}/schemas/ids/{}", self.base_url, id);
        let mut request = self.http.get(&url);
        if let Some((user, password)) = &self.basic_auth {
            request = request.basic_auth(user, Some(password));
        }

        let response = request
            .send()
            .await
            .change_context(AppError::SchemaRegistry)
            .attach_printable_lazy(|| format!("request to {url} failed"))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(Report::new(AppError::SchemaRegistry))
                .attach_printable_lazy(|| format!("schema id {id} not found in registry"));
        }

        let response = response
            .error_for_status()
            .change_context(AppError::SchemaRegistry)
            .attach_printable_lazy(|| format!("registry returned an error for schema id {id}"))?;

        #[derive(serde::Deserialize)]
        struct SchemaResponse {
            schema: String,
        }

        let body: SchemaResponse = response
            .json()
            .await
            .change_context(AppError::SchemaRegistry)
            .attach_printable("failed to parse registry response as JSON")?;

        self.cache
            .lock()
            .expect("schema cache lock poisoned")
            .insert(id, body.schema.clone());
        Ok(body.schema)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Starts a one-shot HTTP server that replies to the first request it
    /// receives, then shuts down. Returns the base URL to hit and a handle
    /// that resolves to the raw request bytes it saw (so tests can assert
    /// on headers like Authorization).
    async fn one_shot_server(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap();
            let request = buf[..n].to_vec();
            let response = format!(
                "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            let _ = socket.shutdown().await;
            request
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test]
    async fn fetches_a_schema_by_id() {
        let (base_url, _handle) = one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"{\"type\":\"string\"}"}"#).await;
        let client = SchemaRegistryClient::new(&base_url, SchemaRegistryAuth::default()).unwrap();

        let schema = client.fetch_schema_by_id(1).await.unwrap();

        assert_eq!(schema, r#"{"type":"string"}"#);
    }

    #[tokio::test]
    async fn returns_a_descriptive_error_for_a_404() {
        let (base_url, _handle) = one_shot_server("HTTP/1.1 404 Not Found", "{}").await;
        let client = SchemaRegistryClient::new(&base_url, SchemaRegistryAuth::default()).unwrap();

        let result = client.fetch_schema_by_id(99).await;

        assert!(result.is_err());
        assert!(format!("{:?}", result.unwrap_err()).contains("schema id 99 not found"));
    }

    #[tokio::test]
    async fn sends_a_basic_auth_header_when_credentials_are_configured() {
        let (base_url, handle) = one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"\"string\""}"#).await;
        let auth = SchemaRegistryAuth {
            basic_auth_credentials: Some("user:pass"),
            ..Default::default()
        };
        let client = SchemaRegistryClient::new(&base_url, auth).unwrap();

        client.fetch_schema_by_id(1).await.unwrap();

        let request = String::from_utf8_lossy(&handle.await.unwrap()).to_lowercase();
        assert!(request.contains("authorization: basic"));
    }

    #[tokio::test]
    async fn caches_a_schema_after_the_first_fetch() {
        let (base_url, handle) = one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"\"string\""}"#).await;
        let client = SchemaRegistryClient::new(&base_url, SchemaRegistryAuth::default()).unwrap();

        client.fetch_schema_by_id(1).await.unwrap();
        // The one-shot server only answers once — a second fetch that hit
        // the network again would fail (the server already handled and
        // closed its one connection), so this only passes if the cache
        // served the second call.
        let second = client.fetch_schema_by_id(1).await.unwrap();

        assert_eq!(second, "\"string\"");
        handle.await.unwrap();
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p kafkaoxide-schema-registry`
Expected: `test result: ok. 4 passed; 0 failed;` (first build compiles `native-tls-vendored`'s vendored OpenSSL from source — expect ~40s the first time, fast on rebuilds).

- [ ] **Step 4: Commit**

```bash
git add backend/schema-registry
git commit -m "feat(schema-registry): add kafkaoxide-schema-registry crate — cached schema-by-id HTTP client"
```

---

### Task 4: `topic_schemas` table + CRUD

**Files:**
- Create: `backend/db/migrations/0004_topic_schemas.sql`
- Create: `backend/db/src/topic_schemas.rs`
- Modify: `backend/db/src/lib.rs`

- [ ] **Step 1: Add the migration**

Create `backend/db/migrations/0004_topic_schemas.sql`:
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
No `REFERENCES connections(id)` — this app never enables SQLite's `foreign_keys` pragma (see `kafkaoxide_db::init_pool`), so a declared FK/`ON DELETE CASCADE` here would silently never fire. Cleanup on connection delete is explicit instead (Task 5, Step 3).

- [ ] **Step 2: Write `get`/`set`/`delete`/`delete_all_for_connection` with tests**

Create `backend/db/src/topic_schemas.rs`:
```rust
use chrono::Utc;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;
use sqlx::sqlite::SqlitePool;

pub async fn get(
    pool: &SqlitePool,
    connection_id: &str,
    topic: &str,
    format: &str,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT schema_text FROM topic_schemas WHERE connection_id = ?1 AND topic = ?2 AND format = ?3",
    )
    .bind(connection_id)
    .bind(topic)
    .bind(format)
    .fetch_optional(pool)
    .await
    .change_context(AppError::Db)
    .attach_printable_lazy(|| format!("failed to load schema for {connection_id}/{topic}/{format}"))
}

pub async fn set(
    pool: &SqlitePool,
    connection_id: &str,
    topic: &str,
    format: &str,
    schema_text: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO topic_schemas (connection_id, topic, format, schema_text, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (connection_id, topic, format)
         DO UPDATE SET schema_text = excluded.schema_text, updated_at = excluded.updated_at",
    )
    .bind(connection_id)
    .bind(topic)
    .bind(format)
    .bind(schema_text)
    .bind(&now)
    .execute(pool)
    .await
    .change_context(AppError::Db)
    .attach_printable_lazy(|| format!("failed to save schema for {connection_id}/{topic}/{format}"))?;

    Ok(())
}

/// Backs the Schema tab's Clear button — idempotent, no error when nothing
/// was set (same convention as `kafkaoxide_secrets::SecretStore::delete_secret`).
pub async fn delete(pool: &SqlitePool, connection_id: &str, topic: &str, format: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM topic_schemas WHERE connection_id = ?1 AND topic = ?2 AND format = ?3")
        .bind(connection_id)
        .bind(topic)
        .bind(format)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to delete schema for {connection_id}/{topic}/{format}"))?;

    Ok(())
}

/// Called when a connection is deleted (see `connection_delete`) — explicit
/// cleanup since `topic_schemas` has no enforced foreign key (see the
/// migration file's comment).
pub async fn delete_all_for_connection(pool: &SqlitePool, connection_id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM topic_schemas WHERE connection_id = ?1")
        .bind(connection_id)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to delete topic schemas for connection {connection_id}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new().connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn returns_none_when_no_schema_is_set() {
        let pool = test_pool().await;
        let result = get(&pool, "conn-1", "orders", "avro").await.unwrap();
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn round_trips_a_schema() {
        let pool = test_pool().await;
        set(&pool, "conn-1", "orders", "avro", "{\"type\":\"string\"}").await.unwrap();

        let result = get(&pool, "conn-1", "orders", "avro").await.unwrap();

        assert_eq!(result, Some("{\"type\":\"string\"}".to_string()));
    }

    #[tokio::test]
    async fn set_upserts_an_existing_schema() {
        let pool = test_pool().await;
        set(&pool, "conn-1", "orders", "avro", "first").await.unwrap();
        set(&pool, "conn-1", "orders", "avro", "second").await.unwrap();

        let result = get(&pool, "conn-1", "orders", "avro").await.unwrap();

        assert_eq!(result, Some("second".to_string()));
    }

    #[tokio::test]
    async fn keeps_schemas_independent_per_topic_and_format() {
        let pool = test_pool().await;
        set(&pool, "conn-1", "orders", "avro", "orders-schema").await.unwrap();
        set(&pool, "conn-1", "payments", "avro", "payments-schema").await.unwrap();
        set(&pool, "conn-1", "orders", "protobuf", "orders-proto-schema").await.unwrap();

        assert_eq!(get(&pool, "conn-1", "orders", "avro").await.unwrap(), Some("orders-schema".to_string()));
        assert_eq!(get(&pool, "conn-1", "payments", "avro").await.unwrap(), Some("payments-schema".to_string()));
        assert_eq!(
            get(&pool, "conn-1", "orders", "protobuf").await.unwrap(),
            Some("orders-proto-schema".to_string())
        );
    }

    #[tokio::test]
    async fn deletes_a_schema() {
        let pool = test_pool().await;
        set(&pool, "conn-1", "orders", "avro", "schema").await.unwrap();

        delete(&pool, "conn-1", "orders", "avro").await.unwrap();

        assert_eq!(get(&pool, "conn-1", "orders", "avro").await.unwrap(), None);
    }

    #[tokio::test]
    async fn delete_of_a_missing_schema_is_a_no_op() {
        let pool = test_pool().await;
        delete(&pool, "conn-1", "orders", "avro").await.unwrap();
    }

    #[tokio::test]
    async fn delete_all_for_connection_only_removes_that_connections_schemas() {
        let pool = test_pool().await;
        set(&pool, "conn-1", "orders", "avro", "schema-1").await.unwrap();
        set(&pool, "conn-2", "orders", "avro", "schema-2").await.unwrap();

        delete_all_for_connection(&pool, "conn-1").await.unwrap();

        assert_eq!(get(&pool, "conn-1", "orders", "avro").await.unwrap(), None);
        assert_eq!(get(&pool, "conn-2", "orders", "avro").await.unwrap(), Some("schema-2".to_string()));
    }
}
```

- [ ] **Step 3: Register the module**

In `backend/db/src/lib.rs`, change:
```rust
pub mod connections;
pub mod tabs;
```
to:
```rust
pub mod connections;
pub mod tabs;
pub mod topic_schemas;
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p kafkaoxide-db`
Expected: `test result: ok. 21 passed; 0 failed;` (14 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add backend/db
git commit -m "feat(db): add topic_schemas table and CRUD for manual per-topic schema overrides"
```

---

### Task 5: `src-tauri` commands — `topic_schema_*`, `connection_decode_avro`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/schema.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/connections.rs`
- Modify: `src-tauri/src/main.rs`

**Note:** `kafkaoxide-app` (`src-tauri`) cannot build in this sandbox (no GTK/pkg-config). Every step in this task is verified by careful re-reading, not `cargo build` — same as every other command added in this codebase's history. Read each diff back once against this plan before committing.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml`, change:
```toml
[dependencies]
kafkaoxide-core = { workspace = true }
kafkaoxide-db = { workspace = true }
kafkaoxide-secrets = { workspace = true }
kafkaoxide-kafka = { workspace = true }
tauri = { version = "2", features = [] }
tokio = { workspace = true }
serde = { workspace = true }
chrono = { workspace = true }
error-stack = { workspace = true }
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio"] }
```
to:
```toml
[dependencies]
kafkaoxide-core = { workspace = true }
kafkaoxide-db = { workspace = true }
kafkaoxide-secrets = { workspace = true }
kafkaoxide-kafka = { workspace = true }
kafkaoxide-avro = { workspace = true }
kafkaoxide-schema-registry = { workspace = true }
tauri = { version = "2", features = [] }
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
chrono = { workspace = true }
error-stack = { workspace = true }
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio"] }
base64 = "0.22"
```

- [ ] **Step 2: Write the new commands**

Create `src-tauri/src/commands/schema.rs`:
```rust
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

/// Backs the payload viewer's "Avro" mode. Decode precedence: a manual
/// per-topic schema always wins when set (decoding the whole payload — no
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

    let basic_auth_credentials = state.secrets.get_secret(&id, "schema_registry_basic_auth_credentials")?;
    let keystore_password = state.secrets.get_secret(&id, "schema_registry_keystore_password")?;
    let auth = SchemaRegistryAuth {
        basic_auth_credentials: basic_auth_credentials.as_deref(),
        trust_store_location: connection.schema_registry_trust_store_location.as_deref(),
        keystore_location: connection.schema_registry_keystore_location.as_deref(),
        keystore_password: keystore_password.as_deref(),
    };
    let client = SchemaRegistryClient::new(endpoint, auth)?;
    let schema_text = client.fetch_schema_by_id(schema_id).await?;

    Ok(kafkaoxide_avro::decode(&bytes[5..], &schema_text)?)
}
```

- [ ] **Step 3: Clean up a deleted connection's topic schemas**

In `src-tauri/src/commands/connections.rs`, change `connection_delete`:
```rust
#[tauri::command]
pub async fn connection_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), CommandError> {
    kafkaoxide_db::connections::delete(&state.pool, &id).await?;
    for key in SECRET_KEYS {
        state.secrets.delete_secret(&id, key)?;
    }
    state.connections.mark_disconnected(&id);
    crate::logging::emit_log(&app, "info", format!("Deleted connection {id}"));
    Ok(())
}
```
to:
```rust
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
```

- [ ] **Step 4: Register the module and the commands**

In `src-tauri/src/commands/mod.rs`, change:
```rust
pub mod connections;
pub mod tabs;
```
to:
```rust
pub mod connections;
pub mod schema;
pub mod tabs;
```

In `src-tauri/src/main.rs`, change:
```rust
            commands::connections::connection_fetch_consumer_group_lag,
            commands::tabs::tab_list,
```
to:
```rust
            commands::connections::connection_fetch_consumer_group_lag,
            commands::schema::topic_schema_get,
            commands::schema::topic_schema_set,
            commands::schema::topic_schema_delete,
            commands::schema::connection_decode_avro,
            commands::tabs::tab_list,
```

- [ ] **Step 5: Review, then commit**

Re-read `schema.rs` end to end against this plan's code block — check every field name matches `kafkaoxide_core::Connection`'s actual field names (`schema_registry_endpoint`, `schema_registry_trust_store_location`, `schema_registry_keystore_location`) and that both secret keys (`schema_registry_basic_auth_credentials`, `schema_registry_keystore_password`) match the `SECRET_KEYS` list already in `connections.rs`.

```bash
git add src-tauri
git commit -m "feat(app): add topic_schema_* and connection_decode_avro commands"
```

---

### Task 6: Frontend API bindings

**Files:**
- Modify: `frontend/src/lib/tauri.ts`

- [ ] **Step 1: Add the `SchemaFormat` type and four `api` methods**

In `frontend/src/lib/tauri.ts`, add near the top (after the `KAFKA_VERSIONS` export, before `Connection`):
```ts
export type SchemaFormat = "avro" | "protobuf";
```

In the `api` object, add after `fetchConsumerGroupLag`:
```ts
  getTopicSchema: (connectionId: string, topic: string, format: SchemaFormat) =>
    invoke<string | null>("topic_schema_get", { connectionId, topic, format }),
  setTopicSchema: (connectionId: string, topic: string, format: SchemaFormat, schemaText: string) =>
    invoke<void>("topic_schema_set", { connectionId, topic, format, schemaText }),
  deleteTopicSchema: (connectionId: string, topic: string, format: SchemaFormat) =>
    invoke<void>("topic_schema_delete", { connectionId, topic, format }),
  decodeAvro: (connectionId: string, topic: string, payloadBase64: string) =>
    invoke<unknown>("connection_decode_avro", { id: connectionId, topic, payloadBase64 }),
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/tauri.ts
git commit -m "feat(frontend): add topic schema and Avro decode API bindings"
```

---

### Task 7: Frontend hooks — `useTopicSchema`, `useSetTopicSchema`, `useDeleteTopicSchema`, `useDecodeAvro`

**Files:**
- Modify: `frontend/src/features/connections/useClusterResources.ts`

- [ ] **Step 1: Add the hooks**

In `frontend/src/features/connections/useClusterResources.ts`, change the import line:
```ts
import { api, ConsumerGroupLag, MessageFilter, TopicMessage } from "../../lib/tauri";
```
to:
```ts
import { api, ConsumerGroupLag, MessageFilter, SchemaFormat, TopicMessage } from "../../lib/tauri";
```

Add at the end of the file:
```ts

/** Backs the topic detail panel's Schema tab. */
export function useTopicSchema(connectionId: string, topic: string, format: SchemaFormat) {
  return useQuery({
    queryKey: ["topic-schema", connectionId, topic, format],
    queryFn: () => api.getTopicSchema(connectionId, topic, format),
  });
}

/** Backs the Schema tab's Save button. */
export function useSetTopicSchema() {
  return useMutation<void, Error, { connectionId: string; topic: string; format: SchemaFormat; schemaText: string }>({
    mutationFn: ({ connectionId, topic, format, schemaText }) =>
      api.setTopicSchema(connectionId, topic, format, schemaText),
  });
}

/** Backs the Schema tab's Clear button. */
export function useDeleteTopicSchema() {
  return useMutation<void, Error, { connectionId: string; topic: string; format: SchemaFormat }>({
    mutationFn: ({ connectionId, topic, format }) => api.deleteTopicSchema(connectionId, topic, format),
  });
}

/** Backs the payload viewer's "Avro" mode button. */
export function useDecodeAvro() {
  return useMutation<unknown, Error, { connectionId: string; topic: string; payloadBase64: string }>({
    mutationFn: ({ connectionId, topic, payloadBase64 }) => api.decodeAvro(connectionId, topic, payloadBase64),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/connections/useClusterResources.ts
git commit -m "feat(frontend): add topic schema and Avro decode hooks"
```

---

### Task 8: `useMessageViewerStore` — track the source connection/topic

The payload viewer needs to know which connection and topic a viewed message came from in order to decode it. `TopicMessage` itself doesn't carry that (it's the raw backend DTO), so the store tracks it alongside the message, the same way it already tracks `activeTabId`.

**Files:**
- Modify: `frontend/src/features/workspace/useMessageViewerStore.ts`
- Modify: `frontend/src/features/workspace/useMessageViewerStore.test.ts`
- Modify: `frontend/src/features/connections/DataTab.tsx`
- Modify: `frontend/src/features/connections/DataTab.test.tsx`
- Modify: `frontend/src/features/bottom-panel/BottomPanel.test.tsx`

- [ ] **Step 1: Rewrite the store**

Replace the full contents of `frontend/src/features/workspace/useMessageViewerStore.ts`:
```ts
import { create } from "zustand";
import { TopicMessage } from "../../lib/tauri";

interface ViewedMessage {
  message: TopicMessage;
  connectionId: string;
  topic: string;
}

interface MessageViewerState {
  /** The active tab's viewed message — kept in sync with `byTab[activeTabId]` by `setActiveTab`. */
  message: TopicMessage | null;
  /** The connection/topic the viewed message came from — needed to decode it (e.g. Avro) on demand. */
  connectionId: string | null;
  topic: string | null;
  activeTabId: string | null;
  /** Per-tab cache, so each tab's right pane stays independent. */
  byTab: Record<string, ViewedMessage | null>;
  /** Called whenever the active tab changes, so writes below land in the right tab's slot. */
  setActiveTab: (tabId: string | null) => void;
  viewMessage: (message: TopicMessage, connectionId: string, topic: string) => void;
  clear: () => void;
  /** Resets a tab's cached message back to blank — the Bottom panel's "Clear memory" button. Defaults to the active tab. */
  clearTabMemory: (tabId?: string) => void;
}

/** Drives the right pane's payload viewer — set when a row is clicked in the topic Data tab's grid. */
export const useMessageViewerStore = create<MessageViewerState>((set, get) => {
  function write(viewed: ViewedMessage | null) {
    const tabId = get().activeTabId;
    set((state) => ({
      message: viewed?.message ?? null,
      connectionId: viewed?.connectionId ?? null,
      topic: viewed?.topic ?? null,
      byTab: tabId ? { ...state.byTab, [tabId]: viewed } : state.byTab,
    }));
  }

  return {
    message: null,
    connectionId: null,
    topic: null,
    activeTabId: null,
    byTab: {},
    setActiveTab: (tabId) => {
      const viewed = (tabId ? get().byTab[tabId] : null) ?? null;
      set({
        activeTabId: tabId,
        message: viewed?.message ?? null,
        connectionId: viewed?.connectionId ?? null,
        topic: viewed?.topic ?? null,
      });
    },
    viewMessage: (message, connectionId, topic) => write({ message, connectionId, topic }),
    clear: () => write(null),
    clearTabMemory: (tabId) => {
      const target = tabId ?? get().activeTabId;
      if (!target) return;
      set((state) => ({
        byTab: { ...state.byTab, [target]: null },
        message: state.activeTabId === target ? null : state.message,
        connectionId: state.activeTabId === target ? null : state.connectionId,
        topic: state.activeTabId === target ? null : state.topic,
      }));
    },
  };
});
```

- [ ] **Step 2: Update the store's tests**

Replace the full contents of `frontend/src/features/workspace/useMessageViewerStore.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useMessageViewerStore } from "./useMessageViewerStore";

const sample = { partition: 0, offset: 1, timestampMs: 123, key: "k", payloadBase64: "eA==", headers: [] };

beforeEach(() => {
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null, activeTabId: null, byTab: {} });
});

describe("useMessageViewerStore", () => {
  it("starts with no message selected", () => {
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();
    expect(useMessageViewerStore.getState().topic).toBeNull();
  });

  it("shows the selected message alongside the connection and topic it came from", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders");

    expect(useMessageViewerStore.getState().message).toEqual(sample);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-1");
    expect(useMessageViewerStore.getState().topic).toBe("orders");
  });

  it("clears the selection", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders");
    useMessageViewerStore.getState().clear();

    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();
    expect(useMessageViewerStore.getState().topic).toBeNull();
  });
});

describe("useMessageViewerStore per-tab isolation", () => {
  const other = { partition: 1, offset: 9, timestampMs: null, key: null, payloadBase64: null, headers: [] };

  it("keeps each tab's viewed message independent", () => {
    const store = useMessageViewerStore.getState();
    store.setActiveTab("tab-1");
    store.viewMessage(sample, "conn-1", "orders");

    store.setActiveTab("tab-2");
    expect(useMessageViewerStore.getState().message).toBeNull();
    store.viewMessage(other, "conn-2", "payments");

    store.setActiveTab("tab-1");
    expect(useMessageViewerStore.getState().message).toEqual(sample);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-1");

    store.setActiveTab("tab-2");
    expect(useMessageViewerStore.getState().message).toEqual(other);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-2");
  });

  it("clearTabMemory resets the active tab's message without touching other tabs", () => {
    const store = useMessageViewerStore.getState();
    store.setActiveTab("tab-1");
    store.viewMessage(sample, "conn-1", "orders");
    store.setActiveTab("tab-2");
    store.viewMessage(other, "conn-2", "payments");

    store.clearTabMemory();
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();

    store.setActiveTab("tab-1");
    expect(useMessageViewerStore.getState().message).toEqual(sample);
  });
});
```

- [ ] **Step 3: Pass connection/topic from `DataTab`'s row click**

In `frontend/src/features/connections/DataTab.tsx`, change:
```tsx
            if (event.data) viewMessage(event.data);
```
to:
```tsx
            if (event.data) viewMessage(event.data, connectionId, topicName);
```

- [ ] **Step 4: Update `DataTab.test.tsx`'s row-click test and `beforeEach`**

In `frontend/src/features/connections/DataTab.test.tsx`, change:
```ts
  useMessageViewerStore.setState({ message: null });
```
to:
```ts
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null });
```

Change:
```tsx
  it("selects a message into the viewer store when a grid row is clicked", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    const message = { partition: 0, offset: 5, timestampMs: null, key: null, payloadBase64: "eA==" };

    lastGridProps?.onRowClicked({ data: message });

    expect(useMessageViewerStore.getState().message).toEqual(message);
  });
```
to:
```tsx
  it("selects a message into the viewer store when a grid row is clicked", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    const message = { partition: 0, offset: 5, timestampMs: null, key: null, payloadBase64: "eA==" };

    lastGridProps?.onRowClicked({ data: message });

    expect(useMessageViewerStore.getState().message).toEqual(message);
    expect(useMessageViewerStore.getState().connectionId).toBe("1");
    expect(useMessageViewerStore.getState().topic).toBe("orders");
  });
```

- [ ] **Step 5: Fix `BottomPanel.test.tsx`'s `byTab` fixture shape**

In `frontend/src/features/bottom-panel/BottomPanel.test.tsx`, change:
```tsx
    useMessageViewerStore.setState({
      activeTabId: "tab-1",
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
      byTab: { "tab-1": { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] } },
    });
```
to:
```tsx
    useMessageViewerStore.setState({
      activeTabId: "tab-1",
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
      byTab: {
        "tab-1": {
          message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
          connectionId: "1",
          topic: "orders",
        },
      },
    });
```

- [ ] **Step 6: Run the frontend test suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` produces no output; vitest reports all test files passing (357 baseline + 2 new assertions-only changes to existing tests, no new `it(...)` blocks in this task — count unchanged at the file level, all green).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/workspace/useMessageViewerStore.ts frontend/src/features/workspace/useMessageViewerStore.test.ts frontend/src/features/connections/DataTab.tsx frontend/src/features/connections/DataTab.test.tsx frontend/src/features/bottom-panel/BottomPanel.test.tsx
git commit -m "feat(frontend): track the source connection/topic of a viewed message"
```

---

### Task 9: `MessagePayloadViewer` — Avro mode

**Files:**
- Modify: `frontend/src/features/connections/MessagePayloadViewer.tsx`
- Modify: `frontend/src/features/connections/MessagePayloadViewer.test.tsx`

- [ ] **Step 1: Add the Avro mode**

Replace the full contents of `frontend/src/features/connections/MessagePayloadViewer.tsx`:
```tsx
import { useEffect, useState } from "react";
import { JsonTreeView } from "../../components/JsonTreeView";
import { useDecodeAvro } from "./useClusterResources";
import { useJsonViewerTabsStore } from "../tabs/useJsonViewerTabsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { base64ToBytes, bytesToText, tryParseJson } from "./payloadDecoding";

type PanelTabId = "headers" | "value";
type ValueMode = "text" | "json" | "avro";

const PANEL_TABS: { id: PanelTabId; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "value", label: "Value" },
];

export function MessagePayloadViewer() {
  const message = useMessageViewerStore((s) => s.message);
  const connectionId = useMessageViewerStore((s) => s.connectionId);
  const topic = useMessageViewerStore((s) => s.topic);
  const openJsonTab = useJsonViewerTabsStore((s) => s.openTab);
  const selectTab = useTabsStore((s) => s.selectTab);
  const [activeTab, setActiveTab] = useState<PanelTabId>("value");
  const [mode, setMode] = useState<ValueMode>("text");
  const decodeAvro = useDecodeAvro();
  const { mutate: runDecodeAvro } = decodeAvro;
  const payloadBase64 = message?.payloadBase64 ?? null;

  // Re-decodes whenever a different message is viewed while Avro mode is
  // already active (e.g. clicking through grid rows without switching
  // modes each time) — not just on the button click that first selects it.
  useEffect(() => {
    if (mode === "avro" && payloadBase64 && connectionId && topic) {
      runDecodeAvro({ connectionId, topic, payloadBase64 });
    }
  }, [mode, payloadBase64, connectionId, topic, runDecodeAvro]);

  if (!message) {
    return <p className="resizable-pane-placeholder">Select a message to view its payload.</p>;
  }

  const bytes = message.payloadBase64 !== null ? base64ToBytes(message.payloadBase64) : null;
  const text = bytes !== null ? bytesToText(bytes) : null;
  const json = mode === "json" && text !== null ? tryParseJson(text) : undefined;

  return (
    <div className="message-payload-viewer">
      <p className="message-payload-meta">
        Partition {message.partition} · Offset {message.offset}
        {message.key !== null && <> · Key: {message.key}</>}
      </p>

      <div className="connection-modal-tabs" role="tablist">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`connection-modal-tab${activeTab === tab.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "headers" && (
        <div role="tabpanel" aria-label="Headers">
          {message.headers.length === 0 ? (
            <p className="resizable-pane-placeholder">No headers.</p>
          ) : (
            <table className="topic-detail-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {message.headers.map((header, index) => (
                  <tr key={index}>
                    <td>{header.key}</td>
                    <td>{header.value ?? <em>null</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "value" && (
        <div role="tabpanel" aria-label="Value">
          {text === null ? (
            <p className="resizable-pane-placeholder">
              Payload wasn't loaded for this fetch — check "Load message payload" below Play, then Play again.
            </p>
          ) : (
            <>
              <div className="message-payload-toggle" role="group" aria-label="Payload view mode">
                <button
                  type="button"
                  className={mode === "text" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("text")}
                >
                  Text
                </button>
                <button
                  type="button"
                  className={mode === "json" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("json")}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className={mode === "avro" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("avro")}
                >
                  Avro
                </button>
              </div>
              {mode === "text" && <pre className="message-payload-body">{text}</pre>}
              {mode === "json" &&
                (json !== undefined ? (
                  <JsonTreeView
                    value={json}
                    onOpenInNewTab={() => {
                      const title = `Partition ${message.partition} · Offset ${message.offset}`;
                      selectTab(openJsonTab(title, json));
                    }}
                  />
                ) : (
                  <p role="alert">Payload is not valid JSON.</p>
                ))}
              {mode === "avro" && (
                <>
                  {decodeAvro.isPending && <p>Decoding…</p>}
                  {decodeAvro.isError && <p role="alert">{decodeAvro.error?.message}</p>}
                  {decodeAvro.isSuccess && (
                    <JsonTreeView
                      value={decodeAvro.data}
                      onOpenInNewTab={() => {
                        const title = `Partition ${message.partition} · Offset ${message.offset}`;
                        selectTab(openJsonTab(title, decodeAvro.data));
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wrap the tests in a `QueryClientProvider` and add Avro tests**

Replace the full contents of `frontend/src/features/connections/MessagePayloadViewer.test.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useJsonViewerTabsStore } from "../tabs/useJsonViewerTabsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useTabOrderStore } from "../tabs/useTabOrderStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { MessagePayloadViewer } from "./MessagePayloadViewer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null });
  useJsonViewerTabsStore.setState({ tabs: [] });
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
  useTabOrderStore.setState({ anchors: {} });
});

describe("MessagePayloadViewer", () => {
  it("shows a placeholder when no message is selected", () => {
    renderWithClient(<MessagePayloadViewer />);
    expect(screen.getByText(/select a message/i)).toBeInTheDocument();
  });

  it("shows the payload as text by default", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: btoa("hello world"), headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("pretty-prints the payload as JSON when the JSON toggle is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        key: null,
        payloadBase64: btoa('{"id":1,"name":"orders"}'),
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByText("id:")).toBeInTheDocument();
    expect(screen.getByText('"orders"')).toBeInTheDocument();
  });

  it("opens the JSON value as its own app tab and switches to it when 'Open in new tab' is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 2,
        offset: 7,
        timestampMs: null,
        key: null,
        payloadBase64: btoa('{"id":1}'),
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));

    const tabs = useJsonViewerTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: "Partition 2 · Offset 7", value: { id: 1 } });
    expect(useTabsStore.getState().activeTabId).toBe(tabs[0].id);
  });

  it("shows an error message when JSON is requested but the payload isn't valid JSON", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: btoa("not json"), headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it("decodes and renders the payload as a JSON tree when Avro is clicked", async () => {
    setInvokeHandlers({ connection_decode_avro: () => ({ id: 1, name: "orders" }) });
    useMessageViewerStore.setState({
      connectionId: "conn-1",
      topic: "orders",
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: btoa("avro-bytes"), headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "Avro" }));

    expect(await screen.findByText("id:")).toBeInTheDocument();
    expect(screen.getByText('"orders"')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("connection_decode_avro", {
      id: "conn-1",
      topic: "orders",
      payloadBase64: btoa("avro-bytes"),
    });
  });

  it("shows an alert with the backend's message when Avro decoding fails", async () => {
    setInvokeHandlers({
      connection_decode_avro: () => {
        throw new Error("no manual schema is set for this topic and this connection has no Schema Registry configured");
      },
    });
    useMessageViewerStore.setState({
      connectionId: "conn-1",
      topic: "orders",
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: btoa("avro-bytes"), headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "Avro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no schema registry configured/i);
  });

  it("shows a hint to enable 'Load message payload' when payloadBase64 is null", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/load message payload/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Text" })).not.toBeInTheDocument();
  });

  it("shows the message's partition and offset even when the payload wasn't loaded", () => {
    useMessageViewerStore.setState({
      message: { partition: 3, offset: 17, timestampMs: null, key: null, payloadBase64: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/partition 3/i)).toBeInTheDocument();
    expect(screen.getByText(/offset 17/i)).toBeInTheDocument();
  });

  it("shows the message's partition and offset", () => {
    useMessageViewerStore.setState({
      message: { partition: 3, offset: 17, timestampMs: null, key: null, payloadBase64: btoa("x"), headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/partition 3/i)).toBeInTheDocument();
    expect(screen.getByText(/offset 17/i)).toBeInTheDocument();
  });

  it("opens on the Value tab by default", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByRole("tab", { name: "Value" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a table of headers on the Headers tab", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        key: null,
        payloadBase64: null,
        headers: [
          { key: "content-type", value: "application/json" },
          { key: "empty-header", value: null },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("content-type")).toBeInTheDocument();
    expect(screen.getByText("application/json")).toBeInTheDocument();
    expect(screen.getByText("empty-header")).toBeInTheDocument();
  });

  it("shows a placeholder on the Headers tab when the message has no headers", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, key: null, payloadBase64: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText(/no headers/i)).toBeInTheDocument();
  });

  it("shows headers even when the payload wasn't loaded for this fetch", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        key: null,
        payloadBase64: null,
        headers: [{ key: "trace-id", value: "abc" }],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("trace-id")).toBeInTheDocument();
  });
});
```
(Note: the old "shows an Avro banner with the schema id for Confluent-wire-format payloads" test is removed — the static banner it tested no longer exists, replaced by the real Avro mode above.)

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run src/features/connections/MessagePayloadViewer.test.tsx`
Expected: `Test Files 1 passed | Tests 14 passed` (13 original − 1 removed banner test + 2 new Avro tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/connections/MessagePayloadViewer.tsx frontend/src/features/connections/MessagePayloadViewer.test.tsx
git commit -m "feat(frontend): add a working Avro mode to the payload viewer"
```

---

### Task 10: `TopicSchemaTab` — manual per-topic schema editor

**Files:**
- Create: `frontend/src/features/connections/TopicSchemaTab.tsx`
- Create: `frontend/src/features/connections/TopicSchemaTab.test.tsx`
- Modify: `frontend/src/features/connections/TopicDetailPanel.tsx`
- Modify: `frontend/src/features/connections/TopicDetailPanel.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the component**

Create `frontend/src/features/connections/TopicSchemaTab.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useDeleteTopicSchema, useSetTopicSchema, useTopicSchema } from "./useClusterResources";

export interface TopicSchemaTabProps {
  connectionId: string;
  topicName: string;
}

/** A manually-pasted Avro schema for this topic — takes precedence over Schema Registry lookups when set. */
export function TopicSchemaTab({ connectionId, topicName }: TopicSchemaTabProps) {
  const { data: savedSchema, isLoading } = useTopicSchema(connectionId, topicName, "avro");
  const setSchema = useSetTopicSchema();
  const deleteSchema = useDeleteTopicSchema();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(savedSchema ?? "");
  }, [savedSchema]);

  if (isLoading) {
    return <p>Loading schema…</p>;
  }

  function handleSave() {
    setSchema.mutate({ connectionId, topic: topicName, format: "avro", schemaText: draft });
  }

  function handleClear() {
    deleteSchema.mutate({ connectionId, topic: topicName, format: "avro" });
    setDraft("");
  }

  return (
    <div className="topic-schema-tab">
      <p className="resizable-pane-placeholder">
        Paste an Avro schema (.avsc JSON) to decode this topic's messages with it — takes precedence over Schema
        Registry lookups. Clear it to go back to registry-based decoding.
      </p>
      <textarea
        className="topic-schema-editor"
        aria-label="Avro schema"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      <div className="connection-modal-input-row">
        <button type="button" onClick={handleSave} disabled={setSchema.isPending}>
          Save
        </button>
        <button type="button" onClick={handleClear} disabled={deleteSchema.isPending || (!savedSchema && !draft)}>
          Clear
        </button>
      </div>
      {setSchema.isError && <p role="alert">{setSchema.error?.message}</p>}
      {deleteSchema.isError && <p role="alert">{deleteSchema.error?.message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write the tests**

Create `frontend/src/features/connections/TopicSchemaTab.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { TopicSchemaTab } from "./TopicSchemaTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("TopicSchemaTab", () => {
  it("loads and shows the saved schema", async () => {
    setInvokeHandlers({ topic_schema_get: () => '{"type":"string"}' });
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);

    expect(await screen.findByLabelText("Avro schema")).toHaveValue('{"type":"string"}');
  });

  it("shows an empty editor when no schema is saved", async () => {
    setInvokeHandlers({ topic_schema_get: () => null });
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);

    expect(await screen.findByLabelText("Avro schema")).toHaveValue("");
  });

  it("saves the edited schema when Save is clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => null, topic_schema_set: () => undefined });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.type(screen.getByLabelText("Avro schema"), '{"type":"string"}');
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("topic_schema_set", {
        connectionId: "1",
        topic: "orders",
        format: "avro",
        schemaText: '{"type":"string"}',
      });
    });
  });

  it("shows an alert when saving an invalid schema fails", async () => {
    setInvokeHandlers({
      topic_schema_get: () => null,
      topic_schema_set: () => {
        throw new Error("invalid Avro schema");
      },
    });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.type(screen.getByLabelText("Avro schema"), "not json");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid Avro schema");
  });

  it("clears the schema when Clear is clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => '{"type":"string"}', topic_schema_delete: () => undefined });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("topic_schema_delete", { connectionId: "1", topic: "orders", format: "avro" });
    });
    expect(screen.getByLabelText("Avro schema")).toHaveValue("");
  });
});
```

- [ ] **Step 3: Wire the Schema tab into `TopicDetailPanel`**

Replace the full contents of `frontend/src/features/connections/TopicDetailPanel.tsx`:
```tsx
import { useState } from "react";
import { ConfigTab } from "./ConfigTab";
import { DataTab } from "./DataTab";
import { PartitionsTab } from "./PartitionsTab";
import { TopicPropertiesTab } from "./TopicPropertiesTab";
import { TopicSchemaTab } from "./TopicSchemaTab";

export interface TopicDetailPanelProps {
  connectionId: string;
  topicName: string;
}

type TopicTabId = "properties" | "data" | "partitions" | "config" | "schema";

const TOPIC_TABS: { id: TopicTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "data", label: "Data" },
  { id: "partitions", label: "Partitions" },
  { id: "config", label: "Config" },
  { id: "schema", label: "Schema" },
];

export function TopicDetailPanel({ connectionId, topicName }: TopicDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TopicTabId>("data");

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header">
        <h2>{topicName}</h2>
      </header>

      <div className="connection-modal-tabs" role="tablist">
        {TOPIC_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`connection-modal-tab${activeTab === tab.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="connection-modal-body">
        {activeTab === "properties" && (
          <TopicPropertiesTab connectionId={connectionId} topicName={topicName} />
        )}
        {activeTab === "data" && <DataTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "partitions" && <PartitionsTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "config" && <ConfigTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "schema" && <TopicSchemaTab connectionId={connectionId} topicName={topicName} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `TopicDetailPanel.test.tsx`**

In `frontend/src/features/connections/TopicDetailPanel.test.tsx`, change the import block:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopicDetailPanel } from "./TopicDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
```
to:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { TopicDetailPanel } from "./TopicDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
```

Change:
```tsx
  it("renders Properties, Data, Partitions, and Config tabs", () => {
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    expect(screen.getByRole("tab", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Partitions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Config" })).toBeInTheDocument();
  });
```
to:
```tsx
  it("renders Properties, Data, Partitions, Config, and Schema tabs", () => {
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    expect(screen.getByRole("tab", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Partitions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schema" })).toBeInTheDocument();
  });

  it("switches to the Schema tab when clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => null });
    const user = userEvent.setup();
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("tab", { name: "Schema" }));

    expect(await screen.findByLabelText("Avro schema")).toBeInTheDocument();
  });
```

- [ ] **Step 5: Add the editor's CSS**

In `frontend/src/styles/global.css`, add after the `.message-payload-body` block:
```css
.topic-schema-tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.topic-schema-editor {
  width: 100%;
  min-height: 220px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-fg);
  resize: vertical;
  box-sizing: border-box;
}
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/features/connections/TopicSchemaTab.test.tsx src/features/connections/TopicDetailPanel.test.tsx`
Expected: `tsc` clean; `Test Files 2 passed | Tests 10 passed` (5 new `TopicSchemaTab` tests + 5 `TopicDetailPanel` tests, 4 original + 1 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/connections/TopicSchemaTab.tsx frontend/src/features/connections/TopicSchemaTab.test.tsx frontend/src/features/connections/TopicDetailPanel.tsx frontend/src/features/connections/TopicDetailPanel.test.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): add a Schema tab for manual per-topic Avro schemas"
```

---

### Task 11: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run every backend crate's test suite**

Run: `cargo test -p kafkaoxide-core -p kafkaoxide-db -p kafkaoxide-secrets -p kafkaoxide-kafka -p kafkaoxide-avro -p kafkaoxide-schema-registry --lib`
Expected: all six crates report `test result: ok.` — core 24, db 21, secrets 8, kafka 41, avro 10, schema-registry 4 (108 total).

- [ ] **Step 2: Run the full frontend suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` produces no output; vitest reports every test file passing.

- [ ] **Step 3: Confirm `kafkaoxide-app` still can't build here, for the record — this is expected, not a regression**

Run: `cargo check -p kafkaoxide-app 2>&1 | tail -5`
Expected: fails on missing GTK/pkg-config system libraries (pre-existing sandbox limitation, unrelated to this change) — cross-check `src-tauri/src/commands/schema.rs` and `main.rs` by eye one more time since this is the only way to catch a typo here.

- [ ] **Step 4: Update the design spec's data-model section to match the no-FK migration actually shipped**

In `docs/superpowers/specs/2026-08-20-avro-schema-registry-design.md`, change:
```sql
CREATE TABLE topic_schemas (
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('avro', 'protobuf')),
    schema_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, topic, format)
);
```
to:
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
Directly below the block, change:
```
`kafkaoxide-db::topic_schemas`: `get_topic_schema`, `set_topic_schema` (upsert), `delete_topic_schema` — same shape as the existing `connections` module's CRUD functions.
```
to:
```
`kafkaoxide-db::topic_schemas`: `get`, `set` (upsert), `delete`, and `delete_all_for_connection` (called from `connection_delete` — no `ON DELETE CASCADE`, since this app never enables SQLite's `foreign_keys` pragma, so a declared FK here would silently never fire) — same shape as the existing `connections`/`tabs` modules' CRUD functions.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-20-avro-schema-registry-design.md
git commit -m "docs: correct the Avro design spec's data model to match the shipped no-FK migration"
```
