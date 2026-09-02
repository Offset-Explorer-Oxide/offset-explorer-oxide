//! Guards the fetch against stalling on librdkafka's prefetch-queue backoff.
//!
//! `fetch_consumer_config` lowers `queued.max.messages.kbytes` so a fetch
//! does not over-read a large-message topic. librdkafka then reaches that
//! threshold constantly, and postpones each next fetch by
//! `fetch.queue.backoff.ms` — whose default is a flat **1000 ms**. Left at
//! that default, a 30,000-message fetch spent 7,050 ms, of which 7,000 ms was
//! seven one-second stalls and ~50 ms was the work.
//!
//! Nothing about that was visible through the payload switch: the broker
//! sends whole records either way and they fill the same queue either way, so
//! the fetch was equally slow with "Fetch message payload" off — which is
//! what made it look like a client-side cost.
//!
//! The unit test `a_lowered_prefetch_queue_comes_with_a_lowered_queue_backoff`
//! pins the two properties against each other with no broker. This one pins
//! the consequence, which is the thing anyone actually cares about.
//!
//! ```bash
//! docker run -d --name kafka -p 9092:9092 apache/kafka:3.9.0
//! ./scripts/e2e-fixtures.sh
//! KAFKAOXIDE_E2E_BOOTSTRAP=localhost:9092 \
//!   cargo test -p kafkaoxide-kafka --test fetch_stall -- --nocapture
//! ```

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kafkaoxide_core::{Connection, MessageFilter, SecurityProtocol};
use kafkaoxide_kafka::{KafkaClient, RdKafkaClient};

/// Created by `scripts/e2e-fixtures.sh`: 30,000 x ~1 KB over 6 partitions.
const TOPIC: &str = "perf-probe";
const MESSAGES: u32 = 30_000;

/// Generous on purpose. The fix measures ~110 ms of poll loop for this topic
/// and the bug measured ~7,050 ms, so anything in this range separates them
/// by more than an order of magnitude in both directions — it fails on the
/// stall without becoming a flaky benchmark of whatever machine runs it.
const BUDGET: Duration = Duration::from_secs(3);

fn bootstrap_servers() -> Option<String> {
    std::env::var("KAFKAOXIDE_E2E_BOOTSTRAP").ok().filter(|value| !value.is_empty())
}

fn connection(bootstrap_servers: String) -> Connection {
    Connection {
        id: "e2e".into(),
        name: "e2e".into(),
        bootstrap_servers,
        kafka_version: "3.9".into(),
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
        created_at: "now".into(),
        updated_at: "now".into(),
    }
}

fn filter(include_payload: bool) -> MessageFilter {
    MessageFilter {
        partitions: None,
        max_messages_per_partition: Some(MESSAGES),
        max_total_messages: Some(MESSAGES),
        from_timestamp_ms: None,
        to_timestamp_ms: None,
        offset: None,
        include_payload,
        max_payload_preview_bytes: Some(4096),
    }
}

async fn fetch(include_payload: bool) -> Option<(Duration, usize)> {
    let bootstrap = bootstrap_servers()?;
    let client = RdKafkaClient::new();
    let connection = connection(bootstrap);
    let started = Instant::now();
    let result = client
        .fetch_messages(
            &connection,
            TOPIC,
            &filter(include_payload),
            None,
            Duration::from_secs(30),
            1_048_576,
            None,
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .expect("fetch failed");
    Some((started.elapsed(), result.messages.len()))
}

#[tokio::test(flavor = "multi_thread")]
async fn a_large_fetch_does_not_stall_on_the_prefetch_queue_backoff() {
    let Some((elapsed, count)) = fetch(false).await else {
        eprintln!("skipped: set KAFKAOXIDE_E2E_BOOTSTRAP (and run scripts/e2e-fixtures.sh)");
        return;
    };

    println!("metadata-only fetch of {count} messages: {} ms", elapsed.as_millis());
    assert_eq!(count, MESSAGES as usize, "the fixture topic is not the expected size");
    assert!(
        elapsed < BUDGET,
        "fetching {count} messages took {} ms. Each whole second in that figure is one \
         `fetch.queue.backoff.ms` stall against the lowered `queued.max.messages.kbytes` — \
         see `fetch_consumer_config`.",
        elapsed.as_millis(),
    );
}

/// The stall was independent of the payload switch, so the guard has to be
/// too — otherwise a regression could hide in whichever mode is untested.
#[tokio::test(flavor = "multi_thread")]
async fn the_same_holds_when_payloads_are_fetched() {
    let Some((elapsed, count)) = fetch(true).await else {
        eprintln!("skipped: set KAFKAOXIDE_E2E_BOOTSTRAP (and run scripts/e2e-fixtures.sh)");
        return;
    };

    println!("payload fetch of {count} messages: {} ms", elapsed.as_millis());
    assert!(
        elapsed < BUDGET,
        "fetching {count} messages with payloads took {} ms",
        elapsed.as_millis(),
    );
}
