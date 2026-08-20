# kafkaoxide Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the kafkaoxide Cargo workspace + Tauri/React app shell with working connection CRUD (SQLite + OS keychain), a live-status connection tree, tabs, a Zed-style theme switcher, and a bottom Logs panel — the MVP described in the design spec.

**Architecture:** A Cargo workspace with four small library crates (`kafkaoxide-core` domain types/errors, `kafkaoxide-db` SQLite persistence via sqlx, `kafkaoxide-secrets` OS-keychain access behind a `SecretStore` trait, `kafkaoxide-kafka` an `rdkafka`-backed `KafkaClient` trait) plus a thin `kafkaoxide-app` Tauri binary that wires Tauri commands/events to those crates. The React/Vite frontend calls Tauri commands through a typed `invoke` wrapper, uses `zustand` for local UI state and `@tanstack/react-query` for server-state caching, and renders a custom (non-library) tree component.

**Tech Stack:** Rust (Cargo workspace, `tokio`, `serde`, `error-stack`, `sqlx`+SQLite, `rdkafka`, `keyring`, `strum`, `async-trait`), Tauri 2, React + TypeScript + Vite, `zustand`, `@tanstack/react-query`, Vitest + React Testing Library.

**Reference:** `docs/superpowers/specs/2026-08-18-kafkaoxide-design.md`

---

## Ground rules for whoever executes this

- Every crate/package version below is a reasonable current choice, not a guarantee of what `cargo`/`npm` will resolve. If a version string or an API used in a code sample doesn't compile/build as written (e.g. a method renamed in a newer crate release), that's expected — fix it to match the installed version, keep the *behavior* the same, and continue. Don't silently skip a test to work around a compile error.
- Run every "Run tests" step for real and paste/observe the actual output before moving on — don't assume it passed.
- `rdkafka`'s `cmake-build` feature vendors and statically builds librdkafka from source the first time it's compiled; that first `cargo build`/`cargo test` touching `kafkaoxide-kafka` will be slow (multiple minutes). Later builds are incremental and fast.
- Building/running the `kafkaoxide-app` Tauri binary (Task 5's final verification, and Task 12) needs `pkg-config`, `libwebkit2gtk-4.1-dev`, `libjavascriptcoregtk-4.1-dev`, `libsoup-3.0-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` installed on the system (Linux). If those aren't present and can't be installed (no passwordless sudo), skip the live-run verification for that task, note it as skipped, and continue — the code is still correct and should be verified on a machine that has them.
- No code comments except where a comment explains a genuinely non-obvious *why* (e.g. the keychain testability note in Task 3). Don't narrate what code does.

---

## Task 1: Workspace scaffold + `kafkaoxide-core`

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/core/Cargo.toml`
- Create: `crates/core/src/lib.rs`
- Create: `crates/core/src/error.rs`
- Create: `crates/core/src/connection.rs`
- Create: `.gitignore` additions for Rust build artifacts

- [ ] **Step 1: Create the workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
  "crates/core",
  "crates/db",
  "crates/secrets",
  "crates/kafka",
  "src-tauri",
]

[workspace.dependencies]
error-stack = "0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt", "rt-multi-thread", "macros", "sync", "time"] }
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
strum = { version = "0.26", features = ["derive"] }
async-trait = "0.1"
kafkaoxide-core = { path = "crates/core" }
kafkaoxide-db = { path = "crates/db" }
kafkaoxide-secrets = { path = "crates/secrets" }
kafkaoxide-kafka = { path = "crates/kafka" }
```

Only `crates/core` exists so far; the other workspace members are created in later tasks — that's fine, `cargo` only needs them to exist by the time you build the workspace as a whole.

- [ ] **Step 2: Append Rust build artifacts to `.gitignore`**

Append this block to the existing `.gitignore` (don't remove what's already there). `Cargo.lock` is intentionally *not* ignored — it should be committed for reproducible builds of the `kafkaoxide-app` binary:

```
# Rust
/target
**/target
```

- [ ] **Step 3: Create `crates/core/Cargo.toml`**

```toml
[package]
name = "kafkaoxide-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true }
strum = { workspace = true }
```

- [ ] **Step 4: Write the failing test for `AppError`**

Create `crates/core/src/error.rs`:

```rust
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Db,
    Kafka,
    Secrets,
    Validation,
    NotFound,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Db => write!(f, "database error"),
            AppError::Kafka => write!(f, "kafka error"),
            AppError::Secrets => write!(f, "secrets store error"),
            AppError::Validation => write!(f, "validation error"),
            AppError::NotFound => write!(f, "not found"),
        }
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn displays_a_human_readable_message_per_variant() {
        assert_eq!(AppError::Db.to_string(), "database error");
        assert_eq!(AppError::NotFound.to_string(), "not found");
    }
}
```

- [ ] **Step 5: Write the failing test for the connection domain types**

Create `crates/core/src/connection.rs`:

```rust
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString)]
pub enum SecurityProtocol {
    #[strum(serialize = "PLAINTEXT")]
    #[serde(rename = "PLAINTEXT")]
    Plaintext,
    #[strum(serialize = "SSL")]
    #[serde(rename = "SSL")]
    Ssl,
    #[strum(serialize = "SASL_PLAINTEXT")]
    #[serde(rename = "SASL_PLAINTEXT")]
    SaslPlaintext,
    #[strum(serialize = "SASL_SSL")]
    #[serde(rename = "SASL_SSL")]
    SaslSsl,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString)]
pub enum SaslMechanism {
    #[strum(serialize = "PLAIN")]
    #[serde(rename = "PLAIN")]
    Plain,
    #[strum(serialize = "SCRAM-SHA-256")]
    #[serde(rename = "SCRAM-SHA-256")]
    ScramSha256,
    #[strum(serialize = "SCRAM-SHA-512")]
    #[serde(rename = "SCRAM-SHA-512")]
    ScramSha512,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub bootstrap_servers: String,
    pub security_protocol: SecurityProtocol,
    pub sasl_mechanism: Option<SaslMechanism>,
    pub sasl_username: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnection {
    pub name: String,
    pub bootstrap_servers: String,
    pub security_protocol: SecurityProtocol,
    pub sasl_mechanism: Option<SaslMechanism>,
    pub sasl_username: Option<String>,
    pub sasl_password: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectionStatus {
    Unknown,
    Reachable,
    Unreachable,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn security_protocol_round_trips_through_display_and_fromstr() {
        for protocol in [
            SecurityProtocol::Plaintext,
            SecurityProtocol::Ssl,
            SecurityProtocol::SaslPlaintext,
            SecurityProtocol::SaslSsl,
        ] {
            let text = protocol.to_string();
            assert_eq!(SecurityProtocol::from_str(&text).unwrap(), protocol);
        }
    }

    #[test]
    fn sasl_mechanism_round_trips_through_display_and_fromstr() {
        for mechanism in [
            SaslMechanism::Plain,
            SaslMechanism::ScramSha256,
            SaslMechanism::ScramSha512,
        ] {
            let text = mechanism.to_string();
            assert_eq!(SaslMechanism::from_str(&text).unwrap(), mechanism);
        }
    }

    #[test]
    fn connection_serializes_fields_as_camel_case() {
        let connection = Connection {
            id: "1".into(),
            name: "Local".into(),
            bootstrap_servers: "localhost:9092".into(),
            security_protocol: SecurityProtocol::Plaintext,
            sasl_mechanism: None,
            sasl_username: None,
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        let json = serde_json::to_string(&connection).unwrap();
        assert!(json.contains("\"bootstrapServers\":\"localhost:9092\""));
        assert!(json.contains("\"securityProtocol\":\"PLAINTEXT\""));
    }
}
```

The last test needs `serde_json` as a dev-dependency — add it now.

- [ ] **Step 6: Add `serde_json` dev-dependency and wire up `lib.rs`**

Update `crates/core/Cargo.toml`, adding:

```toml
[dev-dependencies]
serde_json = { workspace = true }
```

Create `crates/core/src/lib.rs`:

```rust
mod connection;
mod error;

pub use connection::{Connection, ConnectionStatus, NewConnection, SaslMechanism, SecurityProtocol};
pub use error::AppError;
```

- [ ] **Step 7: Run the tests**

Run: `cargo test -p kafkaoxide-core`
Expected: all tests in `error.rs` and `connection.rs` pass (5 tests).

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml .gitignore crates/core
git commit -m "Add Cargo workspace and kafkaoxide-core domain types"
```

---

## Task 2: `kafkaoxide-db` — SQLite persistence

**Files:**
- Create: `crates/db/Cargo.toml`
- Create: `crates/db/migrations/0001_init.sql`
- Create: `crates/db/src/lib.rs`
- Create: `crates/db/src/connections.rs`
- Create: `crates/db/src/tabs.rs`

- [ ] **Step 1: Create `crates/db/Cargo.toml`**

```toml
[package]
name = "kafkaoxide-db"
version = "0.1.0"
edition = "2021"

[dependencies]
kafkaoxide-core = { workspace = true }
error-stack = { workspace = true }
chrono = { workspace = true }
uuid = { workspace = true }
serde = { workspace = true }
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "macros", "migrate"] }

[dev-dependencies]
tokio = { workspace = true }
```

- [ ] **Step 2: Create the migration**

Create `crates/db/migrations/0001_init.sql`:

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bootstrap_servers TEXT NOT NULL,
  security_protocol TEXT NOT NULL,
  sasl_mechanism TEXT,
  sasl_username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 3: Write `crates/db/src/lib.rs` (pool init) and its module declarations**

```rust
pub mod connections;
pub mod tabs;

use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

pub async fn init_pool(database_url: &str) -> Result<SqlitePool, AppError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to connect to sqlite at {database_url}"))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to run migrations")?;

    Ok(pool)
}
```

- [ ] **Step 4: Write the failing tests for the connections repository**

Create `crates/db/src/connections.rs`:

```rust
use chrono::Utc;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::{AppError, Connection, NewConnection, SaslMechanism, SecurityProtocol};
use sqlx::sqlite::SqlitePool;
use sqlx::FromRow;
use std::str::FromStr;
use uuid::Uuid;

#[derive(FromRow)]
struct ConnectionRow {
    id: String,
    name: String,
    bootstrap_servers: String,
    security_protocol: String,
    sasl_mechanism: Option<String>,
    sasl_username: Option<String>,
    created_at: String,
    updated_at: String,
}

impl ConnectionRow {
    fn into_connection(self) -> Result<Connection, AppError> {
        let security_protocol = SecurityProtocol::from_str(&self.security_protocol)
            .change_context(AppError::Db)
            .attach_printable_lazy(|| format!("invalid security_protocol {}", self.security_protocol))?;
        let sasl_mechanism = self
            .sasl_mechanism
            .as_deref()
            .map(SaslMechanism::from_str)
            .transpose()
            .change_context(AppError::Db)
            .attach_printable("invalid sasl_mechanism")?;
        Ok(Connection {
            id: self.id,
            name: self.name,
            bootstrap_servers: self.bootstrap_servers,
            security_protocol,
            sasl_mechanism,
            sasl_username: self.sasl_username,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

pub async fn create(pool: &SqlitePool, new_conn: &NewConnection) -> Result<Connection, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let security_protocol = new_conn.security_protocol.to_string();
    let sasl_mechanism = new_conn.sasl_mechanism.map(|m| m.to_string());

    sqlx::query(
        "INSERT INTO connections (id, name, bootstrap_servers, security_protocol, sasl_mechanism, sasl_username, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
    )
    .bind(&id)
    .bind(&new_conn.name)
    .bind(&new_conn.bootstrap_servers)
    .bind(&security_protocol)
    .bind(&sasl_mechanism)
    .bind(&new_conn.sasl_username)
    .bind(&now)
    .execute(pool)
    .await
    .change_context(AppError::Db)
    .attach_printable("failed to insert connection")?;

    get(pool, &id).await
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Connection, AppError> {
    let row = sqlx::query_as::<_, ConnectionRow>("SELECT * FROM connections WHERE id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to fetch connection {id}"))?;

    let row = match row {
        Some(row) => row,
        None => {
            return Err(error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("connection {id} not found"));
        }
    };

    row.into_connection()
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<Connection>, AppError> {
    let rows = sqlx::query_as::<_, ConnectionRow>("SELECT * FROM connections ORDER BY created_at ASC")
        .fetch_all(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to list connections")?;

    rows.into_iter().map(ConnectionRow::into_connection).collect()
}

pub async fn update(pool: &SqlitePool, id: &str, new_conn: &NewConnection) -> Result<Connection, AppError> {
    let now = Utc::now().to_rfc3339();
    let security_protocol = new_conn.security_protocol.to_string();
    let sasl_mechanism = new_conn.sasl_mechanism.map(|m| m.to_string());

    let result = sqlx::query(
        "UPDATE connections SET name = ?1, bootstrap_servers = ?2, security_protocol = ?3, sasl_mechanism = ?4, sasl_username = ?5, updated_at = ?6
         WHERE id = ?7",
    )
    .bind(&new_conn.name)
    .bind(&new_conn.bootstrap_servers)
    .bind(&security_protocol)
    .bind(&sasl_mechanism)
    .bind(&new_conn.sasl_username)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await
    .change_context(AppError::Db)
    .attach_printable_lazy(|| format!("failed to update connection {id}"))?;

    if result.rows_affected() == 0 {
        return Err(error_stack::Report::new(AppError::NotFound))
            .attach_printable_lazy(|| format!("connection {id} not found"));
    }

    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM connections WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to delete connection {id}"))?;

    if result.rows_affected() == 0 {
        return Err(error_stack::Report::new(AppError::NotFound))
            .attach_printable_lazy(|| format!("connection {id} not found"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn plaintext_connection(name: &str) -> NewConnection {
        NewConnection {
            name: name.to_string(),
            bootstrap_servers: "localhost:9092".to_string(),
            security_protocol: SecurityProtocol::Plaintext,
            sasl_mechanism: None,
            sasl_username: None,
            sasl_password: None,
        }
    }

    #[tokio::test]
    async fn creates_and_fetches_a_connection() {
        let pool = test_pool().await;
        let created = create(&pool, &plaintext_connection("Local")).await.unwrap();

        assert_eq!(created.name, "Local");
        assert_eq!(created.security_protocol, SecurityProtocol::Plaintext);

        let fetched = get(&pool, &created.id).await.unwrap();
        assert_eq!(fetched, created);
    }

    #[tokio::test]
    async fn lists_connections_in_creation_order() {
        let pool = test_pool().await;
        create(&pool, &plaintext_connection("First")).await.unwrap();
        create(&pool, &plaintext_connection("Second")).await.unwrap();

        let connections = list(&pool).await.unwrap();
        assert_eq!(connections.len(), 2);
        assert_eq!(connections[0].name, "First");
        assert_eq!(connections[1].name, "Second");
    }

    #[tokio::test]
    async fn updates_a_connection() {
        let pool = test_pool().await;
        let created = create(&pool, &plaintext_connection("Local")).await.unwrap();

        let mut update_data = plaintext_connection("Renamed");
        update_data.security_protocol = SecurityProtocol::SaslSsl;
        update_data.sasl_mechanism = Some(SaslMechanism::ScramSha256);
        update_data.sasl_username = Some("alice".to_string());

        let updated = update(&pool, &created.id, &update_data).await.unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.security_protocol, SecurityProtocol::SaslSsl);
        assert_eq!(updated.sasl_mechanism, Some(SaslMechanism::ScramSha256));
    }

    #[tokio::test]
    async fn update_of_missing_connection_returns_not_found() {
        let pool = test_pool().await;
        let result = update(&pool, "missing-id", &plaintext_connection("X")).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn deletes_a_connection() {
        let pool = test_pool().await;
        let created = create(&pool, &plaintext_connection("Local")).await.unwrap();

        delete(&pool, &created.id).await.unwrap();

        let connections = list(&pool).await.unwrap();
        assert!(connections.is_empty());
    }
}
```

- [ ] **Step 5: Run the connections tests**

Run: `cargo test -p kafkaoxide-db connections::`
Expected: 5 tests pass (this is also the first compile of `sqlx`, so it may take a minute).

- [ ] **Step 6: Write the failing tests for the tabs repository**

Create `crates/db/src/tabs.rs`:

```rust
use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub name: String,
    pub position: i64,
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<Tab>, AppError> {
    sqlx::query_as::<_, Tab>("SELECT id, name, position FROM tabs ORDER BY position ASC")
        .fetch_all(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to list tabs")
}

pub async fn create(pool: &SqlitePool, name: &str) -> Result<Tab, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let next_position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM tabs")
        .fetch_one(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to compute next tab position")?;

    sqlx::query("INSERT INTO tabs (id, name, position, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(&id)
        .bind(name)
        .bind(next_position)
        .bind(&now)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable("failed to insert tab")?;

    Ok(Tab {
        id,
        name: name.to_string(),
        position: next_position,
    })
}

pub async fn rename(pool: &SqlitePool, id: &str, name: &str) -> Result<(), AppError> {
    let result = sqlx::query("UPDATE tabs SET name = ?1 WHERE id = ?2")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to rename tab {id}"))?;

    if result.rows_affected() == 0 {
        return Err(error_stack::Report::new(AppError::NotFound))
            .attach_printable_lazy(|| format!("tab {id} not found"));
    }

    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM tabs WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .change_context(AppError::Db)
        .attach_printable_lazy(|| format!("failed to delete tab {id}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn creates_tabs_with_increasing_position() {
        let pool = test_pool().await;
        let first = create(&pool, "First").await.unwrap();
        let second = create(&pool, "Second").await.unwrap();

        assert_eq!(first.position, 0);
        assert_eq!(second.position, 1);
    }

    #[tokio::test]
    async fn lists_tabs_ordered_by_position() {
        let pool = test_pool().await;
        create(&pool, "First").await.unwrap();
        create(&pool, "Second").await.unwrap();

        let tabs = list(&pool).await.unwrap();
        assert_eq!(
            tabs.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            vec!["First", "Second"]
        );
    }

    #[tokio::test]
    async fn renames_a_tab() {
        let pool = test_pool().await;
        let tab = create(&pool, "First").await.unwrap();

        rename(&pool, &tab.id, "Renamed").await.unwrap();

        let tabs = list(&pool).await.unwrap();
        assert_eq!(tabs[0].name, "Renamed");
    }

    #[tokio::test]
    async fn rename_of_missing_tab_returns_not_found() {
        let pool = test_pool().await;
        let result = rename(&pool, "missing-id", "X").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn deletes_a_tab() {
        let pool = test_pool().await;
        let tab = create(&pool, "First").await.unwrap();

        delete(&pool, &tab.id).await.unwrap();

        let tabs = list(&pool).await.unwrap();
        assert!(tabs.is_empty());
    }
}
```

- [ ] **Step 7: Run all db crate tests**

Run: `cargo test -p kafkaoxide-db`
Expected: 10 tests pass (5 connections + 5 tabs).

- [ ] **Step 8: Commit**

```bash
git add crates/db
git commit -m "Add kafkaoxide-db with connections and tabs repositories"
```

---

## Task 3: `kafkaoxide-secrets` — OS keychain access

**Files:**
- Create: `crates/secrets/Cargo.toml`
- Create: `crates/secrets/src/lib.rs`

Context: this sandbox has no D-Bus secret-service daemon (`gnome-keyring-daemon`/`kwallet`) running, so the real OS keychain isn't reachable here. Rather than skip testing secrets handling, the crate exposes a `SecretStore` trait with a real `KeyringSecretStore` implementation and an in-memory `InMemorySecretStore` test double — tests exercise the trait contract via the double; production wiring (in Task 5) uses the real one.

- [ ] **Step 1: Create `crates/secrets/Cargo.toml`**

```toml
[package]
name = "kafkaoxide-secrets"
version = "0.1.0"
edition = "2021"

[dependencies]
kafkaoxide-core = { workspace = true }
error-stack = { workspace = true }
keyring = "3"
```

- [ ] **Step 2: Write the failing tests and the implementation together**

Create `crates/secrets/src/lib.rs`:

```rust
use error_stack::{Result, ResultExt};
use kafkaoxide_core::AppError;

pub trait SecretStore: Send + Sync {
    fn set_password(&self, connection_id: &str, password: &str) -> Result<(), AppError>;
    fn get_password(&self, connection_id: &str) -> Result<Option<String>, AppError>;
    fn delete_password(&self, connection_id: &str) -> Result<(), AppError>;
}

const SERVICE: &str = "kafkaoxide";

fn account_for(connection_id: &str) -> String {
    format!("connection:{connection_id}")
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_password(&self, connection_id: &str, password: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}"))?;

        entry
            .set_password(password)
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to store secret for {connection_id}"))
    }

    fn get_password(&self, connection_id: &str) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}"))?;

        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err)
                .change_context(AppError::Secrets)
                .attach_printable_lazy(|| format!("failed to read secret for {connection_id}")),
        }
    }

    fn delete_password(&self, connection_id: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(SERVICE, &account_for(connection_id))
            .change_context(AppError::Secrets)
            .attach_printable_lazy(|| format!("failed to open keychain entry for {connection_id}"))?;

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err)
                .change_context(AppError::Secrets)
                .attach_printable_lazy(|| format!("failed to delete secret for {connection_id}")),
        }
    }
}

pub mod testing {
    use super::SecretStore;
    use error_stack::Result;
    use kafkaoxide_core::AppError;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct InMemorySecretStore {
        entries: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for InMemorySecretStore {
        fn set_password(&self, connection_id: &str, password: &str) -> Result<(), AppError> {
            self.entries
                .lock()
                .unwrap()
                .insert(connection_id.to_string(), password.to_string());
            Ok(())
        }

        fn get_password(&self, connection_id: &str) -> Result<Option<String>, AppError> {
            Ok(self.entries.lock().unwrap().get(connection_id).cloned())
        }

        fn delete_password(&self, connection_id: &str) -> Result<(), AppError> {
            self.entries.lock().unwrap().remove(connection_id);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::InMemorySecretStore;
    use super::SecretStore;

    #[test]
    fn round_trips_a_password() {
        let store = InMemorySecretStore::default();
        store.set_password("conn-1", "hunter2").unwrap();
        assert_eq!(store.get_password("conn-1").unwrap(), Some("hunter2".to_string()));
    }

    #[test]
    fn missing_password_returns_none() {
        let store = InMemorySecretStore::default();
        assert_eq!(store.get_password("missing").unwrap(), None);
    }

    #[test]
    fn delete_removes_a_password() {
        let store = InMemorySecretStore::default();
        store.set_password("conn-1", "hunter2").unwrap();
        store.delete_password("conn-1").unwrap();
        assert_eq!(store.get_password("conn-1").unwrap(), None);
    }

    #[test]
    fn delete_of_missing_password_is_a_no_op() {
        let store = InMemorySecretStore::default();
        store.delete_password("missing").unwrap();
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p kafkaoxide-secrets`
Expected: 4 tests pass. (This does not touch the real OS keychain, so it should pass in any environment.)

- [ ] **Step 4: Commit**

```bash
git add crates/secrets
git commit -m "Add kafkaoxide-secrets with SecretStore trait and keychain/in-memory impls"
```

---

## Task 4: `kafkaoxide-kafka` — broker status check

**Files:**
- Create: `crates/kafka/Cargo.toml`
- Create: `crates/kafka/src/lib.rs`
- Create: `crates/kafka/src/config.rs`
- Create: `crates/kafka/src/client.rs`

- [ ] **Step 1: Create `crates/kafka/Cargo.toml`**

```toml
[package]
name = "kafkaoxide-kafka"
version = "0.1.0"
edition = "2021"

[dependencies]
kafkaoxide-core = { workspace = true }
error-stack = { workspace = true }
async-trait = { workspace = true }
tokio = { workspace = true }
rdkafka = { version = "0.36", features = ["cmake-build"] }
```

- [ ] **Step 2: Write the failing tests and implementation for `client_config`**

Create `crates/kafka/src/config.rs`:

```rust
use kafkaoxide_core::Connection;
use rdkafka::ClientConfig;

pub fn client_config(connection: &Connection, password: Option<&str>) -> ClientConfig {
    let mut config = ClientConfig::new();
    config.set("bootstrap.servers", &connection.bootstrap_servers);
    config.set(
        "security.protocol",
        connection.security_protocol.to_string().to_lowercase(),
    );

    if let Some(mechanism) = &connection.sasl_mechanism {
        config.set("sasl.mechanism", mechanism.to_string());
        if let Some(username) = &connection.sasl_username {
            config.set("sasl.username", username);
        }
        if let Some(password) = password {
            config.set("sasl.password", password);
        }
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use kafkaoxide_core::{SaslMechanism, SecurityProtocol};

    fn sample_connection() -> Connection {
        Connection {
            id: "1".into(),
            name: "test".into(),
            bootstrap_servers: "localhost:9092".into(),
            security_protocol: SecurityProtocol::SaslSsl,
            sasl_mechanism: Some(SaslMechanism::ScramSha256),
            sasl_username: Some("alice".into()),
            created_at: "now".into(),
            updated_at: "now".into(),
        }
    }

    #[test]
    fn builds_bootstrap_servers_and_security_protocol() {
        let config = client_config(&sample_connection(), None);
        assert_eq!(config.get("bootstrap.servers"), Some("localhost:9092"));
        assert_eq!(config.get("security.protocol"), Some("sasl_ssl"));
    }

    #[test]
    fn builds_sasl_fields_when_password_given() {
        let config = client_config(&sample_connection(), Some("hunter2"));
        assert_eq!(config.get("sasl.mechanism"), Some("SCRAM-SHA-256"));
        assert_eq!(config.get("sasl.username"), Some("alice"));
        assert_eq!(config.get("sasl.password"), Some("hunter2"));
    }

    #[test]
    fn omits_sasl_fields_for_plaintext() {
        let mut connection = sample_connection();
        connection.security_protocol = SecurityProtocol::Plaintext;
        connection.sasl_mechanism = None;
        connection.sasl_username = None;

        let config = client_config(&connection, None);
        assert_eq!(config.get("sasl.mechanism"), None);
    }
}
```

- [ ] **Step 3: Run the config tests**

Run: `cargo test -p kafkaoxide-kafka config::`
Expected: 3 tests pass. (First compile of `rdkafka` — this vendors and builds librdkafka via cmake, which can take several minutes.)

If `ClientConfig::get` doesn't exist in the resolved `rdkafka` version, check its docs for the equivalent accessor (it's typically a thin wrapper over an internal `HashMap<String, String>`) and adjust the test calls accordingly — the behavior under test (which keys get set) stays the same.

- [ ] **Step 4: Write the failing test and implementation for `KafkaClient::check_status`**

Create `crates/kafka/src/client.rs`:

```rust
use async_trait::async_trait;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::{AppError, Connection, ConnectionStatus};
use rdkafka::consumer::{BaseConsumer, Consumer};
use std::time::Duration;

use crate::config::client_config;

#[async_trait]
pub trait KafkaClient: Send + Sync {
    async fn check_status(
        &self,
        connection: &Connection,
        password: Option<&str>,
    ) -> Result<ConnectionStatus, AppError>;
}

pub struct RdKafkaClient;

#[async_trait]
impl KafkaClient for RdKafkaClient {
    async fn check_status(
        &self,
        connection: &Connection,
        password: Option<&str>,
    ) -> Result<ConnectionStatus, AppError> {
        let config = client_config(connection, password);

        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;

            match consumer.fetch_metadata(None, Duration::from_secs(3)) {
                Ok(_) => Ok(ConnectionStatus::Reachable),
                Err(_) => Ok(ConnectionStatus::Unreachable),
            }
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("status check task panicked")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kafkaoxide_core::SecurityProtocol;

    #[tokio::test]
    async fn reports_unreachable_for_a_closed_port() {
        let connection = Connection {
            id: "1".into(),
            name: "test".into(),
            bootstrap_servers: "127.0.0.1:1".into(),
            security_protocol: SecurityProtocol::Plaintext,
            sasl_mechanism: None,
            sasl_username: None,
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        let client = RdKafkaClient;
        let status = client.check_status(&connection, None).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }
}
```

Create `crates/kafka/src/lib.rs`:

```rust
pub mod client;
pub mod config;

pub use client::{KafkaClient, RdKafkaClient};
```

- [ ] **Step 5: Run all kafka crate tests**

Run: `cargo test -p kafkaoxide-kafka`
Expected: 4 tests pass (3 config + 1 client). The `check_status` test takes ~3 seconds (the timeout).

- [ ] **Step 6: Commit**

```bash
git add crates/kafka
git commit -m "Add kafkaoxide-kafka with KafkaClient trait and rdkafka-backed status check"
```

---

## Task 5: `kafkaoxide-app` — Tauri binary wiring

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/state.rs`
- Create: `src-tauri/src/logging.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/connections.rs`
- Create: `src-tauri/src/commands/tabs.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/icons/` (placeholder note — bundling is disabled in Phase 0, see Step 3)

This crate has no meaningful unit tests of its own (it's wiring, not logic) — correctness here is verified by compiling and running the app, which happens at the end of this task and again in Task 12.

- [ ] **Step 1: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "kafkaoxide-app"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

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
```

- [ ] **Step 2: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Create `src-tauri/tauri.conf.json`**

Bundling is turned off for Phase 0 (`bundle.active: false`) so we don't need app icons yet — icons and bundle config are a Phase 4 polish concern per the design spec.

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "kafkaoxide",
  "version": "0.1.0",
  "identifier": "dev.kafkaoxide.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "kafkaoxide",
        "width": 1200,
        "height": 800
      }
    ]
  },
  "bundle": {
    "active": false
  }
}
```

- [ ] **Step 4: Create `src-tauri/src/state.rs`**

```rust
use kafkaoxide_kafka::KafkaClient;
use kafkaoxide_secrets::SecretStore;
use sqlx::sqlite::SqlitePool;
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub kafka: Arc<dyn KafkaClient>,
    pub secrets: Arc<dyn SecretStore>,
}
```

- [ ] **Step 5: Create `src-tauri/src/logging.rs`**

```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

pub fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let entry = LogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: level.to_string(),
        message: message.into(),
    };
    let _ = app.emit("log", entry);
}
```

- [ ] **Step 6: Create `src-tauri/src/commands/connections.rs`**

```rust
use crate::state::AppState;
use kafkaoxide_core::{Connection, ConnectionStatus, NewConnection};
use tauri::{AppHandle, State};

#[derive(serde::Serialize)]
pub struct CommandError {
    pub message: String,
}

impl From<error_stack::Report<kafkaoxide_core::AppError>> for CommandError {
    fn from(report: error_stack::Report<kafkaoxide_core::AppError>) -> Self {
        CommandError {
            message: format!("{report:?}"),
        }
    }
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
    let password = new_connection.sasl_password.clone();
    let connection = kafkaoxide_db::connections::create(&state.pool, &new_connection).await?;
    if let Some(password) = password {
        state.secrets.set_password(&connection.id, &password)?;
    }
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
    let password = new_connection.sasl_password.clone();
    let connection = kafkaoxide_db::connections::update(&state.pool, &id, &new_connection).await?;
    if let Some(password) = password {
        state.secrets.set_password(&connection.id, &password)?;
    }
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
    state.secrets.delete_password(&id)?;
    crate::logging::emit_log(&app, "info", format!("Deleted connection {id}"));
    Ok(())
}

#[tauri::command]
pub async fn connection_check_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConnectionStatus, CommandError> {
    let connection = kafkaoxide_db::connections::get(&state.pool, &id).await?;
    let password = state.secrets.get_password(&id)?;
    Ok(state.kafka.check_status(&connection, password.as_deref()).await?)
}
```

- [ ] **Step 7: Create `src-tauri/src/commands/tabs.rs`**

```rust
use crate::commands::connections::CommandError;
use crate::state::AppState;
use kafkaoxide_db::tabs::Tab;
use tauri::State;

#[tauri::command]
pub async fn tab_list(state: State<'_, AppState>) -> Result<Vec<Tab>, CommandError> {
    Ok(kafkaoxide_db::tabs::list(&state.pool).await?)
}

#[tauri::command]
pub async fn tab_create(state: State<'_, AppState>, name: String) -> Result<Tab, CommandError> {
    Ok(kafkaoxide_db::tabs::create(&state.pool, &name).await?)
}

#[tauri::command]
pub async fn tab_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::tabs::rename(&state.pool, &id, &name).await?)
}

#[tauri::command]
pub async fn tab_delete(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    Ok(kafkaoxide_db::tabs::delete(&state.pool, &id).await?)
}
```

Create `src-tauri/src/commands/mod.rs`:

```rust
pub mod connections;
pub mod tabs;
```

- [ ] **Step 8: Create `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod logging;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let data_dir = handle.path().app_data_dir().expect("app data dir");
                std::fs::create_dir_all(&data_dir).expect("create app data dir");
                let db_path = data_dir.join("kafkaoxide.sqlite");
                let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
                let pool = kafkaoxide_db::init_pool(&database_url)
                    .await
                    .expect("failed to initialize database");

                handle.manage(AppState {
                    pool,
                    kafka: Arc::new(kafkaoxide_kafka::RdKafkaClient),
                    secrets: Arc::new(kafkaoxide_secrets::KeyringSecretStore),
                });

                logging::emit_log(&handle, "info", "Application started");
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connections::connection_list,
            commands::connections::connection_create,
            commands::connections::connection_update,
            commands::connections::connection_delete,
            commands::connections::connection_check_status,
            commands::tabs::tab_list,
            commands::tabs::tab_create,
            commands::tabs::tab_rename,
            commands::tabs::tab_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 9: Attempt to build the Tauri crate**

Run: `cargo build -p kafkaoxide-app`

If this fails because `pkg-config` or `libwebkit2gtk-4.1-dev`/`libjavascriptcoregtk-4.1-dev`/`libsoup-3.0-dev` are missing and can't be installed (no passwordless sudo), stop here, note in your task summary that this build step is unverified pending those system packages, and proceed to Task 6 — the frontend doesn't depend on this crate compiling. Come back to this build once the packages are available (see the plan's "Ground rules" section for the install command).

Expected once dependencies are present: builds successfully (first build also compiles `rdkafka`'s vendored librdkafka if not already cached from Task 4, and can take several minutes).

- [ ] **Step 10: Commit**

```bash
git add src-tauri
git commit -m "Add kafkaoxide-app Tauri binary wiring connection and tab commands"
```

---

## Task 6: Frontend scaffold (Vite + React + TS + Vitest)

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/test-setup.ts`
- Create: `src/lib/tauri.ts`
- Create: `src/lib/testInvoke.ts`
- Modify: `.gitignore` (add `node_modules`, `dist`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kafkaoxide",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "@tauri-apps/api": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`**

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>kafkaoxide</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create `src/lib/tauri.ts` (typed command wrappers)**

```ts
import { invoke } from "@tauri-apps/api/core";

export type SecurityProtocol = "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
export type SaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
export type ConnectionStatus = "UNKNOWN" | "REACHABLE" | "UNREACHABLE";

export interface Connection {
  id: string;
  name: string;
  bootstrapServers: string;
  securityProtocol: SecurityProtocol;
  saslMechanism: SaslMechanism | null;
  saslUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewConnection {
  name: string;
  bootstrapServers: string;
  securityProtocol: SecurityProtocol;
  saslMechanism: SaslMechanism | null;
  saslUsername: string | null;
  saslPassword: string | null;
}

export interface Tab {
  id: string;
  name: string;
  position: number;
}

export const api = {
  listConnections: () => invoke<Connection[]>("connection_list"),
  createConnection: (newConnection: NewConnection) =>
    invoke<Connection>("connection_create", { newConnection }),
  updateConnection: (id: string, newConnection: NewConnection) =>
    invoke<Connection>("connection_update", { id, newConnection }),
  deleteConnection: (id: string) => invoke<void>("connection_delete", { id }),
  checkConnectionStatus: (id: string) =>
    invoke<ConnectionStatus>("connection_check_status", { id }),
  listTabs: () => invoke<Tab[]>("tab_list"),
  createTab: (name: string) => invoke<Tab>("tab_create", { name }),
  renameTab: (id: string, name: string) => invoke<void>("tab_rename", { id, name }),
  deleteTab: (id: string) => invoke<void>("tab_delete", { id }),
};
```

- [ ] **Step 6: Create `src/lib/testInvoke.ts`**

Each test file that needs to mock Tauri commands must call `vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))` itself at module scope (Vitest only hoists `vi.mock` calls that are written literally in the test file). This helper configures the *behavior* of that mock once it exists:

```ts
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

export function setInvokeHandlers(handlers: Record<string, (args: any) => unknown>) {
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    const handler = handlers[command];
    if (!handler) {
      return Promise.reject(new Error(`no mock handler for command: ${command}`));
    }
    return Promise.resolve(handler(args));
  });
}
```

- [ ] **Step 7: Create a minimal `src/App.tsx` and `src/main.tsx` (placeholder, filled in by later tasks)**

```tsx
// src/App.tsx
export function App() {
  return <div>kafkaoxide</div>;
}
```

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Write a smoke test to prove the toolchain works**

Create `src/App.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders", () => {
    render(<App />);
    expect(screen.getByText("kafkaoxide")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Install dependencies and run the test**

Run: `npm install`
Then run: `npm run test`
Expected: 1 test passes.

- [ ] **Step 10: Add frontend build artifacts to `.gitignore` and commit**

Append to `.gitignore`:

```
# Node
node_modules
dist
```

```bash
git add package.json package-lock.json vite.config.ts vitest.config.ts tsconfig.json index.html src .gitignore
git commit -m "Scaffold Vite/React/TS frontend with Vitest smoke test"
```

---

## Task 7: Theme feature (Zed-style hover-preview switcher)

**Files:**
- Create: `src/styles/themes.css`
- Create: `src/styles/global.css`
- Create: `src/features/theme/themes.ts`
- Create: `src/features/theme/useThemeStore.ts`
- Create: `src/features/theme/ThemeProvider.tsx`
- Create: `src/features/theme/ThemeSwitcher.tsx`
- Create: `src/features/theme/theme.test.tsx`

- [ ] **Step 1: Create the theme CSS variable sets**

Create `src/styles/themes.css`:

```css
:root[data-theme="zed-dark"] {
  --color-bg: #1e1e2e;
  --color-bg-elevated: #262638;
  --color-fg: #cdd6f4;
  --color-fg-muted: #8890b5;
  --color-accent: #89b4fa;
  --color-border: #313244;
  --color-status-green: #a6e3a1;
  --color-status-gray: #6c7086;
  --color-status-red: #f38ba8;
}

:root[data-theme="zed-light"] {
  --color-bg: #fafafa;
  --color-bg-elevated: #ffffff;
  --color-fg: #1e1e2e;
  --color-fg-muted: #6c6f85;
  --color-accent: #1e66f5;
  --color-border: #e6e6e6;
  --color-status-green: #40a02b;
  --color-status-gray: #9ca0b0;
  --color-status-red: #d20f39;
}

:root[data-theme="ayu-dark"] {
  --color-bg: #0b0e14;
  --color-bg-elevated: #131721;
  --color-fg: #bfbdb6;
  --color-fg-muted: #6c7380;
  --color-accent: #ffb454;
  --color-border: #1e232d;
  --color-status-green: #aad94c;
  --color-status-gray: #4d5566;
  --color-status-red: #f26d78;
}
```

- [ ] **Step 2: Create `src/features/theme/themes.ts`**

```ts
export interface ThemeDef {
  id: string;
  label: string;
  kind: "light" | "dark";
}

export const THEMES: ThemeDef[] = [
  { id: "zed-dark", label: "Zed Dark", kind: "dark" },
  { id: "zed-light", label: "Zed Light", kind: "light" },
  { id: "ayu-dark", label: "Ayu Dark", kind: "dark" },
];

export const DEFAULT_THEME_ID = "zed-dark";
```

- [ ] **Step 3: Create `src/features/theme/useThemeStore.ts`**

```ts
import { create } from "zustand";
import { DEFAULT_THEME_ID } from "./themes";

interface ThemeState {
  appliedThemeId: string;
  previewThemeId: string | null;
  setApplied: (id: string) => void;
  setPreview: (id: string | null) => void;
}

const STORAGE_KEY = "kafkaoxide.theme";

function loadStoredTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

export const useThemeStore = create<ThemeState>((set) => ({
  appliedThemeId: loadStoredTheme(),
  previewThemeId: null,
  setApplied: (id) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    set({ appliedThemeId: id, previewThemeId: null });
  },
  setPreview: (id) => set({ previewThemeId: id }),
}));

export function activeThemeId(state: Pick<ThemeState, "appliedThemeId" | "previewThemeId">): string {
  return state.previewThemeId ?? state.appliedThemeId;
}
```

- [ ] **Step 4: Create `ThemeProvider.tsx` and `ThemeSwitcher.tsx`**

```tsx
// src/features/theme/ThemeProvider.tsx
import { useEffect } from "react";
import { activeThemeId, useThemeStore } from "./useThemeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const previewThemeId = useThemeStore((s) => s.previewThemeId);
  const themeId = activeThemeId({ appliedThemeId, previewThemeId });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, [themeId]);

  return <>{children}</>;
}
```

```tsx
// src/features/theme/ThemeSwitcher.tsx
import { THEMES } from "./themes";
import { useThemeStore } from "./useThemeStore";

export function ThemeSwitcher() {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const setApplied = useThemeStore((s) => s.setApplied);
  const setPreview = useThemeStore((s) => s.setPreview);

  return (
    <div className="theme-switcher">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          aria-pressed={theme.id === appliedThemeId}
          className="theme-swatch"
          onMouseEnter={() => setPreview(theme.id)}
          onMouseLeave={() => setPreview(null)}
          onClick={() => setApplied(theme.id)}
        >
          {theme.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write the behavioral tests**

Create `src/features/theme/theme.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useThemeStore } from "./useThemeStore";
import { DEFAULT_THEME_ID } from "./themes";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID, previewThemeId: null });
});

describe("theme hover preview", () => {
  it("applies the default theme on mount", () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_THEME_ID);
  });

  it("previews a theme on hover without committing it", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "Zed Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("zed-light");
    expect(useThemeStore.getState().appliedThemeId).toBe(DEFAULT_THEME_ID);
  });

  it("reverts to the applied theme when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "Zed Light" }));
    await user.unhover(screen.getByRole("button", { name: "Zed Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_THEME_ID);
  });

  it("commits the theme on click", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Zed Light" }));
    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    expect(localStorage.getItem("kafkaoxide.theme")).toBe("zed-light");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm run test`
Expected: theme tests (4) + existing App smoke test (1) pass.

- [ ] **Step 7: Commit**

```bash
git add src/styles/themes.css src/features/theme
git commit -m "Add Zed-inspired theme system with hover-preview switcher"
```

---

## Task 8: Tabs feature

**Files:**
- Create: `src/features/tabs/useTabsStore.ts`
- Create: `src/features/tabs/TabBar.tsx`
- Create: `src/features/tabs/TabBar.test.tsx`

- [ ] **Step 1: Create `src/features/tabs/useTabsStore.ts`**

```ts
import { create } from "zustand";
import { api, Tab } from "../../lib/tauri";

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  loadTabs: () => Promise<void>;
  addTab: (name: string) => Promise<void>;
  renameTab: (id: string, name: string) => Promise<void>;
  selectTab: (id: string) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  loadTabs: async () => {
    const tabs = await api.listTabs();
    set({
      tabs,
      activeTabId: get().activeTabId ?? tabs[0]?.id ?? null,
    });
  },
  addTab: async (name: string) => {
    const tab = await api.createTab(name);
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
  },
  renameTab: async (id: string, name: string) => {
    await api.renameTab(id, name);
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab)),
    }));
  },
  selectTab: (id: string) => set({ activeTabId: id }),
}));
```

- [ ] **Step 2: Create `src/features/tabs/TabBar.tsx`**

```tsx
import { useState } from "react";
import { useTabsStore } from "./useTabsStore";

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const selectTab = useTabsStore((s) => s.selectTab);
  const renameTab = useTabsStore((s) => s.renameTab);
  const addTab = useTabsStore((s) => s.addTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function startEditing(id: string, currentName: string) {
    setEditingId(id);
    setDraftName(currentName);
  }

  function commitEditing() {
    if (editingId && draftName.trim().length > 0) {
      renameTab(editingId, draftName.trim());
    }
    setEditingId(null);
  }

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          className="tab"
          onClick={() => selectTab(tab.id)}
          onDoubleClick={() => startEditing(tab.id, tab.name)}
        >
          {editingId === tab.id ? (
            <input
              autoFocus
              value={draftName}
              aria-label={`Rename tab ${tab.name}`}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitEditing}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEditing();
                if (e.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <span>{tab.name}</span>
          )}
        </div>
      ))}
      <button type="button" aria-label="New tab" onClick={() => addTab("New Tab")}>
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the behavioral tests**

Create `src/features/tabs/TabBar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useTabsStore } from "./useTabsStore";
import { TabBar } from "./TabBar";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null });
});

describe("TabBar", () => {
  it("renders tabs and selects one on click", async () => {
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });
    const user = userEvent.setup();
    render(<TabBar />);

    await user.click(screen.getByText("Beta"));
    expect(useTabsStore.getState().activeTabId).toBe("2");
  });

  it("renames a tab via double-click, edit, and Enter", async () => {
    setInvokeHandlers({ tab_rename: () => undefined });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });
    const user = userEvent.setup();
    render(<TabBar />);

    await user.dblClick(screen.getByText("Alpha"));
    const input = screen.getByLabelText("Rename tab Alpha");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    await waitFor(() => {
      expect(useTabsStore.getState().tabs[0].name).toBe("Renamed");
    });
    expect(invoke).toHaveBeenCalledWith("tab_rename", { id: "1", name: "Renamed" });
  });

  it("adds a new tab", async () => {
    setInvokeHandlers({
      tab_create: (args: any) => ({ id: "new-1", name: args.name, position: 1 }),
    });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });
    const user = userEvent.setup();
    render(<TabBar />);

    await user.click(screen.getByLabelText("New tab"));

    await waitFor(() => {
      expect(useTabsStore.getState().tabs).toHaveLength(2);
    });
    expect(useTabsStore.getState().activeTabId).toBe("new-1");
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: 3 new TabBar tests pass, plus all previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/tabs
git commit -m "Add tabs feature with renameable, addable tab bar"
```

---

## Task 9: Connections feature (form + tree with live status)

**Files:**
- Create: `src/features/connections/ConnectionForm.tsx`
- Create: `src/features/connections/ConnectionForm.test.tsx`
- Create: `src/features/connections/useConnections.ts`
- Create: `src/features/connections/ConnectionTree.tsx`
- Create: `src/features/connections/ConnectionTree.test.tsx`

- [ ] **Step 1: Create `ConnectionForm.tsx`**

```tsx
import { FormEvent, useState } from "react";
import { NewConnection, SaslMechanism, SecurityProtocol } from "../../lib/tauri";

const SECURITY_PROTOCOLS: SecurityProtocol[] = ["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"];
const SASL_MECHANISMS: SaslMechanism[] = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"];

export interface ConnectionFormProps {
  initial?: NewConnection;
  onSubmit: (connection: NewConnection) => void | Promise<void>;
  submitLabel: string;
}

export function ConnectionForm({ initial, onSubmit, submitLabel }: ConnectionFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bootstrapServers, setBootstrapServers] = useState(initial?.bootstrapServers ?? "");
  const [securityProtocol, setSecurityProtocol] = useState<SecurityProtocol>(
    initial?.securityProtocol ?? "PLAINTEXT",
  );
  const [saslMechanism, setSaslMechanism] = useState<SaslMechanism | "">(initial?.saslMechanism ?? "");
  const [saslUsername, setSaslUsername] = useState(initial?.saslUsername ?? "");
  const [saslPassword, setSaslPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const requiresSasl = securityProtocol === "SASL_PLAINTEXT" || securityProtocol === "SASL_SSL";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError("Name is required");
      return;
    }
    if (bootstrapServers.trim().length === 0) {
      setError("Bootstrap servers is required");
      return;
    }
    if (requiresSasl && saslMechanism === "") {
      setError("SASL mechanism is required for this security protocol");
      return;
    }

    await onSubmit({
      name: name.trim(),
      bootstrapServers: bootstrapServers.trim(),
      securityProtocol,
      saslMechanism: requiresSasl && saslMechanism !== "" ? saslMechanism : null,
      saslUsername: requiresSasl && saslUsername.trim().length > 0 ? saslUsername.trim() : null,
      saslPassword: requiresSasl && saslPassword.length > 0 ? saslPassword : null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="connection-form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Bootstrap servers
        <input
          value={bootstrapServers}
          onChange={(e) => setBootstrapServers(e.target.value)}
          placeholder="localhost:9092"
        />
      </label>
      <label>
        Security protocol
        <select
          value={securityProtocol}
          onChange={(e) => setSecurityProtocol(e.target.value as SecurityProtocol)}
        >
          {SECURITY_PROTOCOLS.map((protocol) => (
            <option key={protocol} value={protocol}>
              {protocol}
            </option>
          ))}
        </select>
      </label>
      {requiresSasl && (
        <>
          <label>
            SASL mechanism
            <select
              value={saslMechanism}
              onChange={(e) => setSaslMechanism(e.target.value as SaslMechanism)}
            >
              <option value="">Select…</option>
              {SASL_MECHANISMS.map((mechanism) => (
                <option key={mechanism} value={mechanism}>
                  {mechanism}
                </option>
              ))}
            </select>
          </label>
          <label>
            Username
            <input value={saslUsername} onChange={(e) => setSaslUsername(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={saslPassword}
              onChange={(e) => setSaslPassword(e.target.value)}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
```

- [ ] **Step 2: Write `ConnectionForm.test.tsx`**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionForm } from "./ConnectionForm";

describe("ConnectionForm", () => {
  it("submits a plaintext connection without SASL fields", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionForm onSubmit={onSubmit} submitLabel="Save" />);

    await user.type(screen.getByLabelText("Name"), "Local Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "localhost:9092");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Local Kafka",
      bootstrapServers: "localhost:9092",
      securityProtocol: "PLAINTEXT",
      saslMechanism: null,
      saslUsername: null,
      saslPassword: null,
    });
  });

  it("shows validation error when name is missing", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionForm onSubmit={onSubmit} submitLabel="Save" />);

    await user.type(screen.getByLabelText("Bootstrap servers"), "localhost:9092");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires a SASL mechanism when SASL_SSL is selected", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionForm onSubmit={onSubmit} submitLabel="Save" />);

    await user.type(screen.getByLabelText("Name"), "Secure Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "broker:9093");
    await user.selectOptions(screen.getByLabelText("Security protocol"), "SASL_SSL");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("SASL mechanism is required");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits full SASL details when provided", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionForm onSubmit={onSubmit} submitLabel="Save" />);

    await user.type(screen.getByLabelText("Name"), "Secure Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "broker:9093");
    await user.selectOptions(screen.getByLabelText("Security protocol"), "SASL_SSL");
    await user.selectOptions(screen.getByLabelText("SASL mechanism"), "SCRAM-SHA-512");
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Secure Kafka",
      bootstrapServers: "broker:9093",
      securityProtocol: "SASL_SSL",
      saslMechanism: "SCRAM-SHA-512",
      saslUsername: "alice",
      saslPassword: "hunter2",
    });
  });
});
```

- [ ] **Step 3: Run the form tests**

Run: `npm run test`
Expected: 4 new ConnectionForm tests pass, all previous tests still pass.

- [ ] **Step 4: Create `useConnections.ts` (react-query hooks)**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NewConnection } from "../../lib/tauri";

export function useConnectionsQuery() {
  return useQuery({ queryKey: ["connections"], queryFn: api.listConnections });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newConnection: NewConnection) => api.createConnection(newConnection),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useConnectionStatus(id: string) {
  return useQuery({
    queryKey: ["connection-status", id],
    queryFn: () => api.checkConnectionStatus(id),
    refetchInterval: 10_000,
    initialData: "UNKNOWN" as const,
  });
}
```

- [ ] **Step 5: Create `ConnectionTree.tsx`**

```tsx
import { ConnectionStatus } from "../../lib/tauri";
import { useConnectionsQuery, useConnectionStatus } from "./useConnections";

function statusClass(status: ConnectionStatus): string {
  if (status === "REACHABLE") return "status-dot status-dot--green";
  if (status === "UNREACHABLE") return "status-dot status-dot--red";
  return "status-dot status-dot--gray";
}

function ConnectionRow({ id, name }: { id: string; name: string }) {
  const { data: status } = useConnectionStatus(id);
  return (
    <div className="connection-row" role="treeitem" aria-label={name}>
      <span className={statusClass(status ?? "UNKNOWN")} data-testid={`status-${id}`} />
      <span>{name}</span>
    </div>
  );
}

export function ConnectionTree() {
  const { data: connections, isLoading } = useConnectionsQuery();

  if (isLoading) {
    return <p>Loading connections…</p>;
  }

  if (!connections || connections.length === 0) {
    return <p>No connections yet. Add one to get started.</p>;
  }

  return (
    <div role="tree" aria-label="Connections">
      {connections.map((connection) => (
        <ConnectionRow key={connection.id} id={connection.id} name={connection.name} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write `ConnectionTree.test.tsx`**

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ConnectionTree } from "./ConnectionTree";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function sampleConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "1",
    name: "Local Kafka",
    bootstrapServers: "localhost:9092",
    securityProtocol: "PLAINTEXT",
    saslMechanism: null,
    saslUsername: null,
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectionTree", () => {
  it("shows an empty state when there are no connections", async () => {
    setInvokeHandlers({ connection_list: () => [] });
    renderWithClient(<ConnectionTree />);

    expect(await screen.findByText("No connections yet. Add one to get started.")).toBeInTheDocument();
  });

  it("renders a green status dot for a reachable connection", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Local Kafka");
    await waitFor(() => {
      expect(screen.getByTestId("status-1").className).toContain("status-dot--green");
    });
  });

  it("renders a red status dot for an unreachable connection", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection({ id: "2", name: "Broken Kafka" })],
      connection_check_status: () => "UNREACHABLE",
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Broken Kafka");
    await waitFor(() => {
      expect(screen.getByTestId("status-2").className).toContain("status-dot--red");
    });
  });
});
```

- [ ] **Step 7: Run all frontend tests**

Run: `npm run test`
Expected: 3 new ConnectionTree tests pass, all previous tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/connections
git commit -m "Add connection form and status-aware connection tree"
```

---

## Task 10: Bottom panel (Logs tool)

**Files:**
- Create: `src/features/bottom-panel/useLogsStore.ts`
- Create: `src/features/bottom-panel/useLogsListener.ts`
- Create: `src/features/bottom-panel/LogsPanel.tsx`
- Create: `src/features/bottom-panel/BottomPanel.tsx`
- Create: `src/features/bottom-panel/BottomPanel.test.tsx`

- [ ] **Step 1: Create the logs store**

```ts
// src/features/bottom-panel/useLogsStore.ts
import { create } from "zustand";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface LogsState {
  entries: LogEntry[];
  addEntry: (entry: LogEntry) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  addEntry: (entry) => set((state) => ({ entries: [...state.entries, entry] })),
}));
```

- [ ] **Step 2: Create the Tauri event listener hook**

```ts
// src/features/bottom-panel/useLogsListener.ts
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { LogEntry, useLogsStore } from "./useLogsStore";

export function useLogsListener() {
  const addEntry = useLogsStore((s) => s.addEntry);

  useEffect(() => {
    const unlisten = listen<LogEntry>("log", (event) => addEntry(event.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addEntry]);
}
```

- [ ] **Step 3: Create `LogsPanel.tsx` and `BottomPanel.tsx`**

```tsx
// src/features/bottom-panel/LogsPanel.tsx
import { useLogsStore } from "./useLogsStore";

export function LogsPanel() {
  const entries = useLogsStore((s) => s.entries);

  if (entries.length === 0) {
    return <p className="logs-empty">No log entries yet.</p>;
  }

  return (
    <ul className="logs-panel" aria-label="Application logs">
      {entries.map((entry, index) => (
        <li key={index} className={`log-entry log-entry--${entry.level}`}>
          <span className="log-timestamp">{entry.timestamp}</span>
          <span className="log-message">{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// src/features/bottom-panel/BottomPanel.tsx
import { useState } from "react";
import { LogsPanel } from "./LogsPanel";
import { useLogsListener } from "./useLogsListener";

const TOOLS = [{ id: "logs", label: "Logs" }] as const;

export function BottomPanel() {
  useLogsListener();
  const [activeTool, setActiveTool] = useState<string>("logs");

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-tabs" role="tablist">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            aria-selected={activeTool === tool.id}
            onClick={() => setActiveTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div className="bottom-panel-content">{activeTool === "logs" && <LogsPanel />}</div>
    </div>
  );
}
```

- [ ] **Step 4: Write `BottomPanel.test.tsx`**

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLogsStore } from "./useLogsStore";
import { BottomPanel } from "./BottomPanel";

let capturedHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: (event: { payload: unknown }) => void) => {
    capturedHandler = handler;
    return Promise.resolve(() => {});
  }),
}));

beforeEach(() => {
  useLogsStore.setState({ entries: [] });
  capturedHandler = null;
});

describe("BottomPanel logs tool", () => {
  it("shows an empty state with no log entries", () => {
    render(<BottomPanel />);
    expect(screen.getByText("No log entries yet.")).toBeInTheDocument();
  });

  it("renders a log entry pushed over the tauri event channel", async () => {
    render(<BottomPanel />);

    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());
    capturedHandler!({
      payload: {
        timestamp: "2026-08-18T00:00:00Z",
        level: "info",
        message: 'Created connection "Local Kafka"',
      },
    });

    expect(await screen.findByText('Created connection "Local Kafka"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm run test`
Expected: 2 new BottomPanel tests pass, all previous tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/bottom-panel
git commit -m "Add bottom panel with backend-sourced Logs tool"
```

---

## Task 11: Wire the full app shell layout

**Files:**
- Modify: `src/App.tsx`
- Create: `src/styles/global.css`

- [ ] **Step 1: Create `src/styles/global.css`**

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  padding: 4px 8px;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.app-sidebar {
  width: 260px;
  min-width: 200px;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  padding: 8px;
}

.app-main {
  flex: 1;
  padding: 8px;
  overflow: auto;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.status-dot--green {
  background: var(--color-status-green);
}
.status-dot--gray {
  background: var(--color-status-gray);
}
.status-dot--red {
  background: var(--color-status-red);
}

.bottom-panel {
  height: 160px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  gap: 4px;
}
.tab {
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.tab[aria-selected="true"] {
  background: var(--color-accent);
  color: var(--color-bg);
}

@media (max-width: 720px) {
  .app-sidebar {
    width: 180px;
    min-width: 140px;
  }
}
```

- [ ] **Step 2: Rewrite `src/App.tsx` to assemble the full shell**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { ThemeSwitcher } from "./features/theme/ThemeSwitcher";
import { TabBar } from "./features/tabs/TabBar";
import { ConnectionTree } from "./features/connections/ConnectionTree";
import { ConnectionForm } from "./features/connections/ConnectionForm";
import { useCreateConnection } from "./features/connections/useConnections";
import { BottomPanel } from "./features/bottom-panel/BottomPanel";
import "./styles/themes.css";
import "./styles/global.css";

const queryClient = new QueryClient();

function AppShell() {
  const [showForm, setShowForm] = useState(false);
  const createConnection = useCreateConnection();

  return (
    <div className="app-shell">
      <header className="app-header">
        <TabBar />
        <ThemeSwitcher />
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <button type="button" onClick={() => setShowForm(true)}>
            + Add connection
          </button>
          {showForm && (
            <ConnectionForm
              submitLabel="Add connection"
              onSubmit={async (connection) => {
                await createConnection.mutateAsync(connection);
                setShowForm(false);
              }}
            />
          )}
          <ConnectionTree />
        </aside>
        <main className="app-main">
          <p className="app-main-placeholder">Select a topic to browse messages.</p>
        </main>
      </div>
      <BottomPanel />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Update the App smoke test for the new shell**

The old smoke test in `src/App.test.tsx` asserted on the placeholder `"kafkaoxide"` text, which no longer renders. Replace the whole file with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

describe("App", () => {
  it("renders the shell with tab bar, sidebar, and bottom panel", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<App />);

    expect(await screen.findByText("No connections yet. Add one to get started.")).toBeInTheDocument();
    expect(screen.getByText("Select a topic to browse messages.")).toBeInTheDocument();
    expect(screen.getByLabelText("New tab")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run all frontend tests**

Run: `npm run test`
Expected: every test file passes, including the rewritten `App.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles/global.css
git commit -m "Assemble full app shell layout (tabs, sidebar tree, main, bottom panel)"
```

---

## Task 12: Full workspace verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire Rust workspace test suite**

Run: `cargo test --workspace --exclude kafkaoxide-app`
Expected: all tests across `kafkaoxide-core`, `kafkaoxide-db`, `kafkaoxide-secrets`, `kafkaoxide-kafka` pass (23 tests total: 5 + 10 + 4 + 4).

`kafkaoxide-app` is excluded from this run deliberately — it has no unit tests, and if the Tauri system packages aren't installed, even `cargo check` on it will fail to compile.

- [ ] **Step 2: Attempt the Tauri app build/check**

Run: `cargo build -p kafkaoxide-app`

If this fails due to missing `pkg-config`/`libwebkit2gtk-4.1-dev`/etc. (see this plan's "Ground rules" section), record that as a known gap for this environment rather than a plan failure — everything it depends on (`core`, `db`, `secrets`, `kafka`) is independently verified in Step 1.

- [ ] **Step 3: Run the entire frontend test suite**

Run: `npm run test`
Expected: all frontend test files pass.

- [ ] **Step 4: Run the frontend production build (type-checks + bundles)**

Run: `npm run build`
Expected: `tsc` reports no type errors and Vite produces a `dist/` bundle. This is a meaningful check independent of whether the Tauri binary itself builds in this sandbox — it proves the frontend code is type-correct and bundleable.

- [ ] **Step 5: If Tauri system packages are available, run the app for a manual smoke check**

Run: `npm run tauri dev`

Manually verify: the window opens, the theme switcher hover-previews and click-commits a theme, "+ Add connection" opens the form, submitting a plaintext connection makes it appear in the tree with a status dot (gray then green/red once the status check resolves), a Logs entry appears for the created connection, and double-clicking a tab lets you rename it. Close the app when done. If the system packages aren't available, skip this step and note it as unverified.

- [ ] **Step 6: Final commit (if Step 2 required any fixes)**

Only needed if any of the above steps required code changes to pass. Otherwise, Phase 0 is complete as of Task 11's commit.

```bash
git add -A
git commit -m "Fix issues found during full workspace verification"
```

---

## What's explicitly not in this phase

Per the design spec's roadmap: topics/partitions tree levels and sibling-scoped search, the message browsing right panel (play/pause, filters, ag-grid), the message detail/JSON viewer panel, memory usage monitoring, and additional themes/bottom-panel tools. Each is a separate brainstorm → plan → build cycle building on this foundation.
