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

        let basic_auth = match auth.basic_auth_credentials {
            Some(creds) => {
                let (user, pass) = creds.split_once(':').ok_or_else(|| {
                    Report::new(AppError::SchemaRegistry).attach_printable(
                        "schema registry basic auth credentials must be in \"username:password\" format",
                    )
                })?;
                Some((user.to_string(), pass.to_string()))
            }
            None => None,
        };

        Ok(SchemaRegistryClient {
            http,
            base_url: endpoint.trim_end_matches('/').to_string(),
            basic_auth,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub async fn fetch_schema_by_id(&self, id: u32) -> Result<String, AppError> {
        if let Some(cached) = self
            .cache
            .lock()
            .expect("schema cache lock poisoned")
            .get(&id)
        {
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
            return Err(Report::new(AppError::NotFound))
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

    #[test]
    fn rejects_malformed_basic_auth_credentials() {
        let auth = SchemaRegistryAuth {
            basic_auth_credentials: Some("not-user-colon-pass"),
            ..Default::default()
        };

        let result = SchemaRegistryClient::new("http://localhost:1", auth);

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetches_a_schema_by_id() {
        let (base_url, _handle) =
            one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"{\"type\":\"string\"}"}"#).await;
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
        let (base_url, handle) =
            one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"\"string\""}"#).await;
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
        let (base_url, handle) =
            one_shot_server("HTTP/1.1 200 OK", r#"{"schema":"\"string\""}"#).await;
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
