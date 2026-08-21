use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use kafkaoxide_core::{Connection, SaslMechanism, SecurityProtocol};
use rdkafka::ClientConfig;

/// Broker TLS material from the New Connection modal's Security tab. Only
/// `truststore_location`, `keystore_location`, `keystore_password`, and
/// `keystore_key_password` map to a real librdkafka config property
/// (`ssl.ca.location`, `ssl.keystore.location`, `ssl.keystore.password`,
/// and `ssl.key.password` respectively) — librdkafka verifies broker
/// certificates from an unencrypted CA file via `ssl.ca.location` and has
/// no concept of a password-protected Java-style truststore, so
/// `truststore_password` is accepted and stored (see `NewConnection`) but
/// deliberately never applied to a `ClientConfig` here.
#[derive(Debug, Clone, Copy, Default)]
pub struct BrokerSslConfig<'a> {
    pub truststore_location: Option<&'a str>,
    pub keystore_location: Option<&'a str>,
    pub keystore_password: Option<&'a str>,
    pub keystore_key_password: Option<&'a str>,
}

/// Builds a `ClientConfig` from raw values rather than a saved `Connection`.
/// Used for the New Connection modal's ping/Test flows, which probe
/// connectivity for values the user has typed but not saved yet.
pub fn build_client_config(
    bootstrap_servers: &str,
    security_protocol: SecurityProtocol,
    sasl_mechanism: Option<SaslMechanism>,
    sasl_username: Option<&str>,
    password: Option<&str>,
    ssl: BrokerSslConfig<'_>,
) -> ClientConfig {
    let mut config = ClientConfig::new();
    config.set("bootstrap.servers", bootstrap_servers);
    config.set("security.protocol", security_protocol.to_string().to_lowercase());

    if let Some(mechanism) = sasl_mechanism {
        config.set("sasl.mechanism", mechanism.to_string());
        if let Some(username) = sasl_username {
            config.set("sasl.username", username);
        }
        if let Some(password) = password {
            config.set("sasl.password", password);
        }
    }

    if let Some(location) = ssl.truststore_location {
        config.set("ssl.ca.location", location);
    } else if matches!(security_protocol, SecurityProtocol::Ssl | SecurityProtocol::SaslSsl) {
        if let Some(pem) = native_ca_bundle_pem() {
            config.set("ssl.ca.pem", pem);
        }
    }
    if let Some(location) = ssl.keystore_location {
        config.set("ssl.keystore.location", location);
    }
    if let Some(password) = ssl.keystore_password {
        config.set("ssl.keystore.password", password);
    }
    if let Some(password) = ssl.keystore_key_password {
        config.set("ssl.key.password", password);
    }

    config
}

/// Loads the OS's native trust store (Windows cert store / macOS Keychain /
/// Linux's /etc/ssl/certs, via `rustls-native-certs`) and re-encodes it as a
/// PEM bundle for librdkafka's `ssl.ca.pem`. Needed because the vendored
/// OpenSSL that rdkafka links against (see `ssl-vendored` in Cargo.toml) has
/// no default CA directory that exists on the runtime machine — without
/// this, TLS certificate verification fails for every broker, even ones
/// using a certificate signed by a public CA the OS already trusts.
/// Returns `None` if no certs could be loaded at all (better to leave
/// librdkafka with its own — broken — default than to set an empty bundle).
fn native_ca_bundle_pem() -> Option<String> {
    let result = rustls_native_certs::load_native_certs();
    if result.certs.is_empty() {
        return None;
    }

    let mut pem = String::new();
    for cert in &result.certs {
        pem.push_str("-----BEGIN CERTIFICATE-----\n");
        let encoded = BASE64.encode(cert.as_ref());
        for line in encoded.as_bytes().chunks(64) {
            pem.push_str(std::str::from_utf8(line).expect("base64 output is ASCII"));
            pem.push('\n');
        }
        pem.push_str("-----END CERTIFICATE-----\n");
    }
    Some(pem)
}

/// Builds a `ClientConfig` for a saved connection. `sasl_username` and
/// `ssl_truststore_location`/`ssl_keystore_location` come straight from the
/// connection (not secrets); `password` is the connection's SASL password,
/// looked up from the OS keychain by the Tauri command layer. The broker
/// keystore passwords aren't retrieved from the keychain here yet — same
/// scope boundary, just not wired up for that field yet.
pub fn client_config(connection: &Connection, password: Option<&str>) -> ClientConfig {
    build_client_config(
        &connection.bootstrap_servers,
        connection.security_protocol,
        connection.sasl_mechanism,
        connection.sasl_username.as_deref(),
        password,
        BrokerSslConfig {
            truststore_location: connection.ssl_truststore_location.as_deref(),
            keystore_location: connection.ssl_keystore_location.as_deref(),
            keystore_password: None,
            keystore_key_password: None,
        },
    )
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
            kafka_version: "3.7".into(),
            zookeeper_enabled: false,
            zookeeper_host: None,
            zookeeper_port: None,
            zookeeper_chroot_path: None,
            security_protocol: SecurityProtocol::SaslSsl,
            sasl_mechanism: Some(SaslMechanism::ScramSha256),
            sasl_username: Some("kafka-user".into()),
            sasl_oauth_url: None,
            schema_registry_endpoint: None,
            schema_registry_trust_store_location: None,
            schema_registry_keystore_location: None,
            ssl_truststore_location: None,
            ssl_keystore_location: None,
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
        assert_eq!(config.get("sasl.username"), Some("kafka-user"));
        assert_eq!(config.get("sasl.password"), Some("hunter2"));
    }

    #[test]
    fn omits_sasl_username_when_a_saved_connection_has_none() {
        let mut connection = sample_connection();
        connection.sasl_username = None;

        let config = client_config(&connection, Some("hunter2"));
        assert_eq!(config.get("sasl.username"), None);
    }

    #[test]
    fn omits_sasl_fields_for_plaintext() {
        let mut connection = sample_connection();
        connection.security_protocol = SecurityProtocol::Plaintext;
        connection.sasl_mechanism = None;

        let config = client_config(&connection, None);
        assert_eq!(config.get("sasl.mechanism"), None);
    }

    #[test]
    fn client_config_carries_a_saved_connections_ssl_locations() {
        let mut connection = sample_connection();
        connection.ssl_truststore_location = Some("/etc/broker-ts.pem".into());
        connection.ssl_keystore_location = Some("/etc/broker-ks.p12".into());

        let config = client_config(&connection, None);
        assert_eq!(config.get("ssl.ca.location"), Some("/etc/broker-ts.pem"));
        assert_eq!(config.get("ssl.keystore.location"), Some("/etc/broker-ks.p12"));
    }

    #[test]
    fn build_client_config_sets_every_ssl_property_when_given() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Ssl,
            None,
            None,
            None,
            BrokerSslConfig {
                truststore_location: Some("/etc/broker-ts.pem"),
                keystore_location: Some("/etc/broker-ks.p12"),
                keystore_password: Some("keystore-secret"),
                keystore_key_password: Some("key-secret"),
            },
        );

        assert_eq!(config.get("ssl.ca.location"), Some("/etc/broker-ts.pem"));
        assert_eq!(config.get("ssl.keystore.location"), Some("/etc/broker-ks.p12"));
        assert_eq!(config.get("ssl.keystore.password"), Some("keystore-secret"));
        assert_eq!(config.get("ssl.key.password"), Some("key-secret"));
    }

    #[test]
    fn build_client_config_omits_ssl_properties_when_none_given() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Plaintext,
            None,
            None,
            None,
            BrokerSslConfig::default(),
        );

        assert_eq!(config.get("ssl.ca.location"), None);
        assert_eq!(config.get("ssl.keystore.location"), None);
        assert_eq!(config.get("ssl.keystore.password"), None);
        assert_eq!(config.get("ssl.key.password"), None);
    }

    // Regression test for the root cause behind "Test"/"Connect" reporting
    // unable-to-reach against a real managed-cloud cluster (Confluent Cloud,
    // AWS MSK): vendored OpenSSL has no default CA trust store on the
    // runtime machine, so without this, TLS certificate verification always
    // fails for anyone who hasn't manually supplied a custom CA file — even
    // though the broker's cert is signed by a public CA the OS already
    // trusts. When no custom truststore is given, the native OS trust store
    // must be loaded and passed via `ssl.ca.pem`.
    #[test]
    fn build_client_config_injects_the_native_ca_bundle_for_ssl_without_a_custom_truststore() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Ssl,
            None,
            None,
            None,
            BrokerSslConfig::default(),
        );

        let ca_pem = config.get("ssl.ca.pem").expect("ssl.ca.pem should be set");
        assert!(ca_pem.contains("BEGIN CERTIFICATE"), "expected PEM-encoded certificates, got: {ca_pem}");
    }

    #[test]
    fn build_client_config_injects_the_native_ca_bundle_for_sasl_ssl_without_a_custom_truststore() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::SaslSsl,
            Some(SaslMechanism::Plain),
            Some("kafka-user"),
            Some("hunter2"),
            BrokerSslConfig::default(),
        );

        let ca_pem = config.get("ssl.ca.pem").expect("ssl.ca.pem should be set");
        assert!(ca_pem.contains("BEGIN CERTIFICATE"), "expected PEM-encoded certificates, got: {ca_pem}");
    }

    #[test]
    fn build_client_config_prefers_a_custom_truststore_over_the_native_ca_bundle() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::SaslSsl,
            None,
            None,
            None,
            BrokerSslConfig {
                truststore_location: Some("/etc/broker-ts.pem"),
                ..BrokerSslConfig::default()
            },
        );

        assert_eq!(config.get("ssl.ca.location"), Some("/etc/broker-ts.pem"));
        assert_eq!(config.get("ssl.ca.pem"), None);
    }

    #[test]
    fn build_client_config_does_not_inject_a_ca_bundle_for_non_ssl_protocols() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::SaslPlaintext,
            Some(SaslMechanism::Plain),
            Some("kafka-user"),
            Some("hunter2"),
            BrokerSslConfig::default(),
        );

        assert_eq!(config.get("ssl.ca.pem"), None);
    }
}
