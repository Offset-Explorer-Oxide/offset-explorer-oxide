use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use kafkaoxide_core::{Connection, SaslMechanism, SecurityProtocol};
use rdkafka::ClientConfig;
use std::sync::OnceLock;

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
    // Set here rather than at each call site so it covers every client the
    // app builds — the pooled metadata consumer, each fetch's own consumer,
    // the admin client, and the modal's Test probe alike. See `CLIENT_ID`.
    config.set("client.id", client_id());
    apply_connection_attempt_limits(&mut config);
    apply_connection_footprint_limits(&mut config);

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

/// What this app calls itself when it talks to a broker.
///
/// librdkafka defaults `client.id` to the bare string `rdkafka`, which is
/// the same value every other rdkafka-based producer, consumer and CLI tool
/// on the cluster sends. That default costs an operator two things:
///
/// * **Attribution.** Broker request metrics, connection counts and quota
///   violations are reported per client id. Under the default, load from
///   this app is indistinguishable from load from anything else built on
///   librdkafka.
/// * **Control.** Kafka client quotas are keyed on client id (and
///   principal). With a shared default the only quota an operator can apply
///   to this app also throttles unrelated services — so in practice they
///   cannot contain it at all short of blocking the user outright.
///
/// Deliberately *not* included: hostname or username. Both would help an
/// operator, and both would send the user's machine identity to every
/// cluster they connect to — including ones they do not control. Name and
/// version are enough to attribute and throttle, which is the point.
///
/// The version is supplied at startup by [`set_app_version`] rather than
/// compiled in from `CARGO_PKG_VERSION`: the crates in this workspace are all
/// still at `0.1.0` and are not bumped per release, so the only true version
/// of the app is the one in `tauri.conf.json` that Tauri reports at runtime.
/// Baking in the crate version would have shipped `kafkaoxide/0.1.0` from
/// every release — attributable, but useless for telling an operator (or a
/// support thread) *which* build a user is running.
fn client_id() -> &'static str {
    APP_CLIENT_ID.get().map(String::as_str).unwrap_or(FALLBACK_CLIENT_ID)
}

/// Used until [`set_app_version`] runs, and by this crate's own tests, which
/// exercise the config builders directly with no Tauri app around them.
const FALLBACK_CLIENT_ID: &str = "kafkaoxide";

static APP_CLIENT_ID: OnceLock<String> = OnceLock::new();

/// Records the running app's version so every client this module builds can
/// identify itself as `kafkaoxide/<version>` — see [`client_id`].
///
/// Called once at startup from `src-tauri`, which is the only place that
/// knows the real version (`tauri.conf.json` via `package_info()`). Ignores
/// repeat calls: the version cannot change while the app is running, and the
/// first caller is the authoritative one.
///
/// Missing this call is not fatal — clients still identify themselves as
/// `kafkaoxide`, just without a version — so `src-tauri` also logs the
/// resulting id at startup, which is what makes a forgotten call visible
/// instead of silent.
pub fn set_app_version(version: &str) {
    let _ = APP_CLIENT_ID.set(format!("{FALLBACK_CLIENT_ID}/{version}"));
}

/// The client id every broker connection from this app reports, for the
/// startup log line — see [`set_app_version`].
pub fn broker_client_id() -> &'static str {
    client_id()
}

/// Caps how hard a single client hammers the brokers while it exists.
///
/// librdkafka has no "give up on authentication failure" switch: a client
/// whose credentials are rejected keeps reconnecting on
/// `reconnect.backoff.ms`, doubling up to `reconnect.backoff.max.ms`, to
/// every broker, for as long as the client object lives. With the defaults
/// (100ms initial, 10s max) a single 10-second request against a cluster
/// that rejects the password costs the brokers a double-digit number of
/// TCP/TLS/SASL handshakes — each one logged, multiplied by every user
/// running this app. Slowing the loop down cuts that to a handful.
///
/// This is damage limitation inside one client's lifetime, not the fix. The
/// fix is not creating the client at all — see `ConnectionRegistry`'s
/// authentication circuit breaker, which is what stops a rejected connection
/// from reaching this code a third time.
///
/// `socket.connection.setup.timeout.ms` is lowered from librdkafka's 30s
/// default for the same reason: a doomed handshake should be abandoned well
/// inside the request's own read timeout rather than sitting in the retry
/// loop until the very end of it.
fn apply_connection_attempt_limits(config: &mut ClientConfig) {
    config.set("reconnect.backoff.ms", "1000");
    config.set("reconnect.backoff.max.ms", "30000");
    config.set("socket.connection.setup.timeout.ms", "5000");
}

/// Bounds what a client does to the cluster beyond the requests it is asked
/// to make.
///
/// Both of these are already librdkafka's defaults; they are set explicitly
/// because both are properties this app depends on against real production
/// clusters, and neither should be able to change underneath it on a
/// librdkafka upgrade.
///
/// * `enable.sparse.connections` keeps a client connected only to the
///   brokers it actually talks to. It is why one pooled metadata client
///   costs the cluster roughly one connection rather than one per broker —
///   the difference between a desktop fleet being unnoticeable and being a
///   connection-count problem.
/// * `allow.auto.create.topics` stops a metadata request for a topic that
///   does not exist from *creating* it on a cluster with auto-creation
///   enabled. A read-only browsing tool must never bring a topic into
///   existence because someone clicked a stale row.
fn apply_connection_footprint_limits(config: &mut ClientConfig) {
    config.set("enable.sparse.connections", "true");
    config.set("allow.auto.create.topics", "false");
}

/// The OS trust store, loaded and PEM-encoded once per run of the app.
///
/// Every `ClientConfig` this module builds needs the same bundle, and a
/// config is built for *every* broker request — listing topics, listing
/// partitions, each message fetch. Rebuilding it each time meant
/// re-enumerating the OS certificate store (a Win32 call on Windows, a
/// Keychain query on macOS) and re-base64-encoding ~150 certificates before
/// a single byte went out on the wire, on every click. It cannot change
/// while the app is running, so it is computed once.
static NATIVE_CA_BUNDLE: OnceLock<Option<String>> = OnceLock::new();

/// Loads the OS's native trust store (Windows cert store / macOS Keychain /
/// Linux's /etc/ssl/certs, via `rustls-native-certs`) and re-encodes it as a
/// PEM bundle for librdkafka's `ssl.ca.pem`. Needed because the vendored
/// OpenSSL that rdkafka links against (see `ssl-vendored` in Cargo.toml) has
/// no default CA directory that exists on the runtime machine — without
/// this, TLS certificate verification fails for every broker, even ones
/// using a certificate signed by a public CA the OS already trusts.
/// Returns `None` if no certs could be loaded at all (better to leave
/// librdkafka with its own — broken — default than to set an empty bundle).
///
/// Cached in [`NATIVE_CA_BUNDLE`]; the work below happens once per run.
fn native_ca_bundle_pem() -> Option<&'static str> {
    NATIVE_CA_BUNDLE.get_or_init(build_native_ca_bundle_pem).as_deref()
}

fn build_native_ca_bundle_pem() -> Option<String> {
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

/// Loads and caches the OS trust store ahead of the first broker request, so
/// that cost lands during app start-up rather than in the middle of the
/// user's first click. Cheap and idempotent after the first call.
pub fn warm_native_ca_bundle() {
    let _ = native_ca_bundle_pem();
}

/// Builds a `ClientConfig` for a saved connection — every field, including
/// secrets, comes straight from the connection (see `Connection`'s doc
/// comment for why secrets live in plain columns rather than the OS
/// keychain).
pub fn client_config(connection: &Connection) -> ClientConfig {
    build_client_config(
        &connection.bootstrap_servers,
        connection.security_protocol,
        connection.sasl_mechanism,
        connection.sasl_username.as_deref(),
        connection.sasl_password.as_deref(),
        BrokerSslConfig {
            truststore_location: connection.ssl_truststore_location.as_deref(),
            keystore_location: connection.ssl_keystore_location.as_deref(),
            keystore_password: connection.ssl_keystore_password.as_deref(),
            keystore_key_password: connection.ssl_keystore_key_password.as_deref(),
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
            created_at: "now".into(),
            updated_at: "now".into(),
        }
    }

    #[test]
    fn keeps_each_client_connected_only_to_the_brokers_it_uses() {
        // One pooled client per connection is only cheap for the cluster if
        // it doesn't hold a socket open to every broker.
        let config = client_config(&sample_connection());
        assert_eq!(config.get("enable.sparse.connections"), Some("true"));
    }

    #[test]
    fn never_lets_a_metadata_request_create_a_topic() {
        let config = client_config(&sample_connection());
        assert_eq!(config.get("allow.auto.create.topics"), Some("false"));
    }

    #[test]
    fn applies_the_footprint_limits_to_unsaved_connections_too() {
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Plaintext,
            None,
            None,
            None,
            BrokerSslConfig::default(),
        );

        assert_eq!(config.get("enable.sparse.connections"), Some("true"));
        assert_eq!(config.get("allow.auto.create.topics"), Some("false"));
    }

    #[test]
    fn reuses_one_cached_copy_of_the_native_ca_bundle_across_configs() {
        // Rebuilt per config, this re-enumerated the OS certificate store on
        // every single broker request — a cost paid on every click, before
        // any byte went out on the wire.
        let first = native_ca_bundle_pem();
        let second = native_ca_bundle_pem();

        match (first, second) {
            (Some(a), Some(b)) => assert!(std::ptr::eq(a, b), "expected the same cached bundle, not a rebuilt one"),
            (None, None) => {}
            _ => panic!("the cached bundle changed between calls"),
        }
    }

    #[test]
    fn slows_the_reconnect_loop_down_from_librdkafkas_defaults() {
        // The retry-storm guard: librdkafka reconnects a rejected client
        // every 100ms by default, so a doomed request costs the broker a
        // handshake burst rather than one attempt.
        let config = client_config(&sample_connection());
        assert_eq!(config.get("reconnect.backoff.ms"), Some("1000"));
        assert_eq!(config.get("reconnect.backoff.max.ms"), Some("30000"));
    }

    #[test]
    fn abandons_a_stalled_connection_setup_well_inside_a_request_timeout() {
        let config = client_config(&sample_connection());
        assert_eq!(config.get("socket.connection.setup.timeout.ms"), Some("5000"));
    }

    /// Pins `APP_CLIENT_ID` before reading it.
    ///
    /// Tests in a binary share one process and run in parallel, so a test
    /// that read `client_id()` while another was still calling
    /// `set_app_version` could see the fallback once and the versioned id the
    /// next time. Every client-id test calls this first, which drives the
    /// `OnceLock` to its final value before any assertion depends on it —
    /// whichever test wins the race, the value is stable from then on.
    fn stable_client_id() -> &'static str {
        set_app_version("9.9.9");
        client_id()
    }

    /// Never librdkafka's default `rdkafka`, which merges this app's load
    /// into every other rdkafka-based client on the cluster and leaves an
    /// operator no client id to attach a quota to.
    #[test]
    fn identifies_itself_to_the_broker_rather_than_using_librdkafkas_default() {
        stable_client_id();
        let config = client_config(&sample_connection());
        let client_id = config.get("client.id").expect("client.id must always be set");

        assert!(
            client_id.starts_with("kafkaoxide"),
            "expected a kafkaoxide client id, got {client_id:?}"
        );
        assert_ne!(client_id, "rdkafka");
    }

    #[test]
    fn identifies_unsaved_connections_the_same_way() {
        // The modal's Test/ping buttons dial real brokers too, so they must
        // be as attributable as a saved connection's requests are.
        let expected = stable_client_id();
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Plaintext,
            None,
            None,
            None,
            BrokerSslConfig::default(),
        );

        assert_eq!(config.get("client.id").as_deref(), Some(expected));
    }

    /// Sent to every cluster the user connects to, including ones they do not
    /// control, so it must carry the app's identity and nothing of the
    /// user's.
    #[test]
    fn does_not_leak_the_machine_or_user_identity_in_the_client_id() {
        let id = stable_client_id();
        assert!(!id.contains(char::is_whitespace), "client id must be a single token");

        for leaked in [std::env::var("HOSTNAME"), std::env::var("USER")] {
            if let Ok(value) = leaked {
                if !value.is_empty() {
                    assert!(!id.contains(&value), "client id must not carry {value:?}");
                }
            }
        }
    }

    /// The crates in this workspace sit at 0.1.0 and are not bumped per
    /// release, so a `CARGO_PKG_VERSION`-derived id would have reported
    /// `kafkaoxide/0.1.0` forever — attributable, but useless for telling
    /// which build a user is actually running.
    #[test]
    fn carries_the_app_version_once_the_app_supplies_it() {
        // Asserts the shape rather than the exact version: `OnceLock` means
        // whichever test set it first wins, and any of them supplies one.
        let id = stable_client_id();

        assert!(id.starts_with("kafkaoxide/"), "expected a versioned id, got {id:?}");
        assert!(id.len() > "kafkaoxide/".len(), "expected a version after the prefix, got {id:?}");
    }

    #[test]
    fn falls_back_to_an_unversioned_id_rather_than_an_empty_one() {
        // A forgotten `set_app_version` must still leave the client
        // attributable — degraded, not broken.
        assert_eq!(FALLBACK_CLIENT_ID, "kafkaoxide");
        assert!(!FALLBACK_CLIENT_ID.is_empty());
    }

    #[test]
    fn applies_the_connection_attempt_limits_to_unsaved_connections_too() {
        // The modal's Test button probes typed-but-unsaved values, and is
        // exactly where a user with a wrong password will click repeatedly.
        let config = build_client_config(
            "localhost:9092",
            SecurityProtocol::Plaintext,
            None,
            None,
            None,
            BrokerSslConfig::default(),
        );

        assert_eq!(config.get("reconnect.backoff.ms"), Some("1000"));
        assert_eq!(config.get("socket.connection.setup.timeout.ms"), Some("5000"));
    }

    #[test]
    fn builds_bootstrap_servers_and_security_protocol() {
        let config = client_config(&sample_connection());
        assert_eq!(config.get("bootstrap.servers"), Some("localhost:9092"));
        assert_eq!(config.get("security.protocol"), Some("sasl_ssl"));
    }

    #[test]
    fn builds_sasl_fields_when_password_given() {
        let mut connection = sample_connection();
        connection.sasl_password = Some("hunter2".into());

        let config = client_config(&connection);
        assert_eq!(config.get("sasl.mechanism"), Some("SCRAM-SHA-256"));
        assert_eq!(config.get("sasl.username"), Some("kafka-user"));
        assert_eq!(config.get("sasl.password"), Some("hunter2"));
    }

    #[test]
    fn omits_sasl_username_when_a_saved_connection_has_none() {
        let mut connection = sample_connection();
        connection.sasl_username = None;
        connection.sasl_password = Some("hunter2".into());

        let config = client_config(&connection);
        assert_eq!(config.get("sasl.username"), None);
    }

    #[test]
    fn omits_sasl_fields_for_plaintext() {
        let mut connection = sample_connection();
        connection.security_protocol = SecurityProtocol::Plaintext;
        connection.sasl_mechanism = None;

        let config = client_config(&connection);
        assert_eq!(config.get("sasl.mechanism"), None);
    }

    #[test]
    fn client_config_carries_a_saved_connections_ssl_locations() {
        let mut connection = sample_connection();
        connection.ssl_truststore_location = Some("/etc/broker-ts.pem".into());
        connection.ssl_keystore_location = Some("/etc/broker-ks.p12".into());

        let config = client_config(&connection);
        assert_eq!(config.get("ssl.ca.location"), Some("/etc/broker-ts.pem"));
        assert_eq!(config.get("ssl.keystore.location"), Some("/etc/broker-ks.p12"));
    }

    #[test]
    fn client_config_carries_a_saved_connections_keystore_passwords() {
        // Regression test: previously these were hardcoded to `None`
        // regardless of what was saved, since the keychain-backed design
        // never wired this field up. Now that secrets are plain connection
        // fields, there's no reason for this gap to exist.
        let mut connection = sample_connection();
        connection.ssl_keystore_password = Some("keystore-secret".into());
        connection.ssl_keystore_key_password = Some("key-secret".into());

        let config = client_config(&connection);
        assert_eq!(config.get("ssl.keystore.password"), Some("keystore-secret"));
        assert_eq!(config.get("ssl.key.password"), Some("key-secret"));
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
