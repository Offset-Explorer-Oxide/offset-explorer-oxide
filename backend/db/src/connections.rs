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
    kafka_version: String,
    zookeeper_enabled: bool,
    zookeeper_host: Option<String>,
    zookeeper_port: Option<i64>,
    zookeeper_chroot_path: Option<String>,
    security_protocol: String,
    sasl_mechanism: Option<String>,
    sasl_username: Option<String>,
    sasl_oauth_url: Option<String>,
    schema_registry_endpoint: Option<String>,
    schema_registry_trust_store_location: Option<String>,
    schema_registry_keystore_location: Option<String>,
    ssl_truststore_location: Option<String>,
    ssl_keystore_location: Option<String>,
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
            kafka_version: self.kafka_version,
            zookeeper_enabled: self.zookeeper_enabled,
            zookeeper_host: self.zookeeper_host,
            zookeeper_port: self.zookeeper_port,
            zookeeper_chroot_path: self.zookeeper_chroot_path,
            security_protocol,
            sasl_mechanism,
            sasl_username: self.sasl_username,
            sasl_oauth_url: self.sasl_oauth_url,
            schema_registry_endpoint: self.schema_registry_endpoint,
            schema_registry_trust_store_location: self.schema_registry_trust_store_location,
            schema_registry_keystore_location: self.schema_registry_keystore_location,
            ssl_truststore_location: self.ssl_truststore_location,
            ssl_keystore_location: self.ssl_keystore_location,
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
        "INSERT INTO connections (
             id, name, bootstrap_servers, kafka_version,
             zookeeper_enabled, zookeeper_host, zookeeper_port, zookeeper_chroot_path,
             security_protocol, sasl_mechanism, sasl_username, sasl_oauth_url,
             schema_registry_endpoint, schema_registry_trust_store_location, schema_registry_keystore_location,
             ssl_truststore_location, ssl_keystore_location,
             created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)",
    )
    .bind(&id)
    .bind(&new_conn.name)
    .bind(&new_conn.bootstrap_servers)
    .bind(&new_conn.kafka_version)
    .bind(new_conn.zookeeper_enabled)
    .bind(&new_conn.zookeeper_host)
    .bind(new_conn.zookeeper_port)
    .bind(&new_conn.zookeeper_chroot_path)
    .bind(&security_protocol)
    .bind(&sasl_mechanism)
    .bind(&new_conn.sasl_username)
    .bind(&new_conn.sasl_oauth_url)
    .bind(&new_conn.schema_registry_endpoint)
    .bind(&new_conn.schema_registry_trust_store_location)
    .bind(&new_conn.schema_registry_keystore_location)
    .bind(&new_conn.ssl_truststore_location)
    .bind(&new_conn.ssl_keystore_location)
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
        "UPDATE connections SET
             name = ?1, bootstrap_servers = ?2, kafka_version = ?3,
             zookeeper_enabled = ?4, zookeeper_host = ?5, zookeeper_port = ?6, zookeeper_chroot_path = ?7,
             security_protocol = ?8, sasl_mechanism = ?9, sasl_username = ?10, sasl_oauth_url = ?11,
             schema_registry_endpoint = ?12, schema_registry_trust_store_location = ?13, schema_registry_keystore_location = ?14,
             ssl_truststore_location = ?15, ssl_keystore_location = ?16,
             updated_at = ?17
         WHERE id = ?18",
    )
    .bind(&new_conn.name)
    .bind(&new_conn.bootstrap_servers)
    .bind(&new_conn.kafka_version)
    .bind(new_conn.zookeeper_enabled)
    .bind(&new_conn.zookeeper_host)
    .bind(new_conn.zookeeper_port)
    .bind(&new_conn.zookeeper_chroot_path)
    .bind(&security_protocol)
    .bind(&sasl_mechanism)
    .bind(&new_conn.sasl_username)
    .bind(&new_conn.sasl_oauth_url)
    .bind(&new_conn.schema_registry_endpoint)
    .bind(&new_conn.schema_registry_trust_store_location)
    .bind(&new_conn.schema_registry_keystore_location)
    .bind(&new_conn.ssl_truststore_location)
    .bind(&new_conn.ssl_keystore_location)
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
            kafka_version: "3.7".to_string(),
            zookeeper_enabled: false,
            zookeeper_host: None,
            zookeeper_port: None,
            zookeeper_chroot_path: None,
            security_protocol: SecurityProtocol::Plaintext,
            sasl_mechanism: None,
            sasl_username: None,
            sasl_password: None,
            sasl_oauth_url: None,
            schema_registry_endpoint: None,
            schema_registry_basic_auth_credentials: None,
            schema_registry_trust_store_location: None,
            schema_registry_trust_store_password: None,
            schema_registry_keystore_location: None,
            schema_registry_keystore_password: None,
            schema_registry_keystore_key_password: None,
            ssl_truststore_location: None,
            ssl_truststore_password: None,
            ssl_keystore_location: None,
            ssl_keystore_password: None,
            ssl_keystore_key_password: None,
        }
    }

    #[tokio::test]
    async fn creates_and_fetches_a_connection() {
        let pool = test_pool().await;
        let created = create(&pool, &plaintext_connection("Local")).await.unwrap();

        assert_eq!(created.name, "Local");
        assert_eq!(created.security_protocol, SecurityProtocol::Plaintext);
        assert_eq!(created.kafka_version, "3.7");
        assert!(!created.zookeeper_enabled);
        assert_eq!(created.zookeeper_host, None);

        let fetched = get(&pool, &created.id).await.unwrap();
        assert_eq!(fetched, created);
    }

    #[tokio::test]
    async fn persists_zookeeper_and_schema_registry_properties() {
        let pool = test_pool().await;
        let mut new_conn = plaintext_connection("With Zookeeper");
        new_conn.kafka_version = "2.8".to_string();
        new_conn.zookeeper_enabled = true;
        new_conn.zookeeper_host = Some("zk.local".to_string());
        new_conn.zookeeper_port = Some(2181);
        new_conn.zookeeper_chroot_path = Some("/kafka".to_string());
        new_conn.sasl_username = Some("kafka-user".to_string());
        new_conn.sasl_oauth_url = Some("https://idp.example.com/token".to_string());
        new_conn.schema_registry_endpoint = Some("https://schema-registry.local".to_string());
        new_conn.schema_registry_trust_store_location = Some("/etc/ts.jks".to_string());
        new_conn.schema_registry_keystore_location = Some("/etc/ks.jks".to_string());
        new_conn.ssl_truststore_location = Some("/etc/broker-ts.pem".to_string());
        new_conn.ssl_keystore_location = Some("/etc/broker-ks.p12".to_string());

        let created = create(&pool, &new_conn).await.unwrap();

        assert_eq!(created.kafka_version, "2.8");
        assert!(created.zookeeper_enabled);
        assert_eq!(created.zookeeper_host.as_deref(), Some("zk.local"));
        assert_eq!(created.zookeeper_port, Some(2181));
        assert_eq!(created.zookeeper_chroot_path.as_deref(), Some("/kafka"));
        assert_eq!(created.sasl_username.as_deref(), Some("kafka-user"));
        assert_eq!(
            created.sasl_oauth_url.as_deref(),
            Some("https://idp.example.com/token")
        );
        assert_eq!(
            created.schema_registry_endpoint.as_deref(),
            Some("https://schema-registry.local")
        );
        assert_eq!(created.schema_registry_trust_store_location.as_deref(), Some("/etc/ts.jks"));
        assert_eq!(created.schema_registry_keystore_location.as_deref(), Some("/etc/ks.jks"));
        assert_eq!(created.ssl_truststore_location.as_deref(), Some("/etc/broker-ts.pem"));
        assert_eq!(created.ssl_keystore_location.as_deref(), Some("/etc/broker-ks.p12"));

        let fetched = get(&pool, &created.id).await.unwrap();
        assert_eq!(fetched, created);
    }

    #[tokio::test]
    async fn does_not_persist_secret_fields() {
        let pool = test_pool().await;
        let mut new_conn = plaintext_connection("Secretive");
        new_conn.sasl_password = Some("sasl-secret".to_string());
        new_conn.schema_registry_basic_auth_credentials = Some("user:pass".to_string());
        new_conn.schema_registry_trust_store_password = Some("ts-secret".to_string());
        new_conn.schema_registry_keystore_password = Some("ks-secret".to_string());
        new_conn.schema_registry_keystore_key_password = Some("ks-key-secret".to_string());
        new_conn.ssl_truststore_password = Some("broker-ts-secret".to_string());
        new_conn.ssl_keystore_password = Some("broker-ks-secret".to_string());
        new_conn.ssl_keystore_key_password = Some("broker-ks-key-secret".to_string());

        let created = create(&pool, &new_conn).await.unwrap();
        let json = serde_json::to_string(&created).unwrap();

        assert!(!json.contains("sasl-secret"));
        assert!(!json.contains("user:pass"));
        assert!(!json.contains("ts-secret"));
        assert!(!json.contains("ks-secret"));
        assert!(!json.contains("ks-key-secret"));
        assert!(!json.contains("broker-ts-secret"));
        assert!(!json.contains("broker-ks-secret"));
        assert!(!json.contains("broker-ks-key-secret"));
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
        update_data.sasl_oauth_url = Some("https://idp.example.com/token".to_string());

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
