//! What the key filter's cap is *for*, measured against a real broker.
//!
//! A key search reads its whole range and keeps only the matches, so the only
//! thing that makes it fast is not having to read the range. `max_total_messages`
//! is what buys that: the fetch walks backwards a slice at a time and stops as
//! soon as it has its N newest matches. These tests pin the difference — both in
//! messages examined, which is deterministic, and in wall-clock time, which is
//! asserted only loosely because a shared CI box is not a benchmark rig.
//!
//! ```bash
//! docker run -d --name kafka -p 9092:9092 apache/kafka:3.9.0
//! ./scripts/e2e-fixtures.sh          # creates perf-keys: 200,000 records
//! KAFKAOXIDE_E2E_BOOTSTRAP=localhost:9092 \
//!   cargo test -p kafkaoxide-kafka --test key_filter_perf -- --nocapture
//! ```

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kafkaoxide_core::{Connection, MessageFetchResult, MessageFilter, ScanProgress, SecurityProtocol};
use kafkaoxide_kafka::{KafkaClient, RdKafkaClient};

/// 200,000 records in one partition: 199,990 carrying the key `filler-`, then
/// ten carrying `needle` at the very end. Deliberately larger than
/// `INITIAL_SCAN_SLICE` (50,000) — a topic the first slice covered entirely
/// could not tell an early stop from a full read.
const PERF_TOPIC: &str = "perf-keys";
const TOPIC_RECORDS: u64 = 200_000;
/// Matches `INITIAL_SCAN_SLICE` in `messages.rs`. Not imported, deliberately:
/// this test is a check on the behaviour that constant produces, so it should
/// fail loudly if the constant changes rather than silently following it.
const FIRST_SLICE: u64 = 50_000;
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_MESSAGE_SIZE: u32 = 12 * 1024 * 1024;

fn bootstrap_servers() -> Option<String> {
    std::env::var("KAFKAOXIDE_E2E_BOOTSTRAP").ok().filter(|value| !value.is_empty())
}

macro_rules! broker {
    () => {
        match bootstrap_servers() {
            Some(bootstrap) => bootstrap,
            None => {
                eprintln!("skipped: set KAFKAOXIDE_E2E_BOOTSTRAP to run this test");
                return;
            }
        }
    };
}

fn connection(bootstrap_servers: String) -> Connection {
    Connection {
        id: "perf".into(),
        name: "perf".into(),
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

async fn timed_fetch(
    client: &RdKafkaClient,
    connection: &Connection,
    filter: MessageFilter,
) -> (MessageFetchResult, Duration) {
    let started = Instant::now();
    let result = client
        .fetch_messages(
            connection,
            PERF_TOPIC,
            &filter,
            None,
            READ_TIMEOUT,
            MAX_MESSAGE_SIZE,
            None,
            Arc::new(AtomicBool::new(false)),
            Arc::new(ScanProgress::default()),
        )
        .await
        .expect("fetch failed");
    (result, started.elapsed())
}

/// The headline claim: a capped key search does not read the range.
///
/// `needle` sits at the very end of a 200,000-record topic, so the first
/// backwards slice contains it and the walk stops there. The assertion is on
/// messages *examined*, which is exact and machine-independent — the timing
/// below is the softer, human-facing version of the same fact.
#[tokio::test(flavor = "multi_thread")]
async fn a_capped_key_search_stops_after_one_slice_instead_of_reading_the_topic() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let (capped, capped_time) = timed_fetch(
        &client,
        &connection,
        MessageFilter { key: Some("needle".into()), max_total_messages: Some(5), ..MessageFilter::default() },
    )
    .await;

    assert_eq!(capped.messages.len(), 5, "the cap is a cap on matches");
    assert!(
        capped.scanned <= FIRST_SLICE,
        "expected one slice ({FIRST_SLICE}) or less, scanned {}",
        capped.scanned
    );
    assert!(
        capped.scanned < TOPIC_RECORDS / 2,
        "a capped search must not read the whole topic: scanned {} of {TOPIC_RECORDS}",
        capped.scanned
    );
    eprintln!("capped(5):   scanned {:>7} in {:>6} ms", capped.scanned, capped_time.as_millis());
}

/// The comparison the cap is sold on. An uncapped key search is correct but
/// reads everything; the capped one answers the same question off the end of
/// the topic. Asserted as a ratio rather than an absolute duration, so it means
/// the same thing on a fast laptop and a loaded CI box.
#[tokio::test(flavor = "multi_thread")]
async fn capping_a_key_search_is_dramatically_cheaper_than_not_capping_it() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let (uncapped, uncapped_time) = timed_fetch(
        &client,
        &connection,
        MessageFilter { key: Some("needle".into()), ..MessageFilter::default() },
    )
    .await;
    let (capped, capped_time) = timed_fetch(
        &client,
        &connection,
        MessageFilter { key: Some("needle".into()), max_total_messages: Some(5), ..MessageFilter::default() },
    )
    .await;

    eprintln!(
        "uncapped:    scanned {:>7} in {:>6} ms\ncapped(5):   scanned {:>7} in {:>6} ms",
        uncapped.scanned,
        uncapped_time.as_millis(),
        capped.scanned,
        capped_time.as_millis()
    );

    // The uncapped search is the correctness baseline: every `needle` in the
    // topic, having read all 200,000 records to be sure.
    assert_eq!(uncapped.messages.len(), 10, "the fixture carries ten needles");
    assert_eq!(uncapped.scanned, TOPIC_RECORDS, "an uncapped search reads its whole range");

    // Deliberately loose. The point is an order of magnitude, and asserting a
    // tight ratio on a machine that is also running a broker in Docker would
    // make this test a source of flakes rather than of information.
    assert!(
        capped.scanned * 3 < uncapped.scanned,
        "capping should cut the read by far more than a third: {} vs {}",
        capped.scanned,
        uncapped.scanned
    );
}

/// The cost that is *not* avoidable, pinned so a regression in it is visible:
/// a key that is not in the topic at all has to read the whole range before it
/// can say so. This is the case the progress line and the Stop button exist
/// for, and it must still terminate rather than hanging on the idle timeout.
#[tokio::test(flavor = "multi_thread")]
async fn an_absent_key_reads_the_whole_range_and_still_finishes() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let (result, elapsed) = timed_fetch(
        &client,
        &connection,
        MessageFilter { key: Some("absent".into()), max_total_messages: Some(5), ..MessageFilter::default() },
    )
    .await;

    eprintln!("absent key:  scanned {:>7} in {:>6} ms", result.scanned, elapsed.as_millis());
    assert!(result.messages.is_empty());
    assert_eq!(result.scanned, TOPIC_RECORDS, "an absent key can only be ruled out by reading everything");
    // The walk's rounds must not each burn the 10s idle timeout. Five doublings
    // cover this topic, so a per-round stall would show up as tens of seconds.
    assert!(elapsed < Duration::from_secs(30), "the walk stalled: {elapsed:?}");
}

/// A metadata-only key search is the cheap shape of this feature, and the one
/// the Data tab uses by default. Nothing about the walk should make it read
/// payload bytes it does not keep.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_search_without_payloads_charges_no_payload_bytes() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let (result, _) = timed_fetch(
        &client,
        &connection,
        MessageFilter { key: Some("needle".into()), max_total_messages: Some(5), ..MessageFilter::default() },
    )
    .await;

    assert_eq!(result.messages.len(), 5);
    assert_eq!(result.payload_bytes_read, 0, "include_payload is off, so nothing is charged");
}

/// Stop must land mid-walk, not merely between fetches.
///
/// An absent key on this topic is five rounds of reading; the flag is checked
/// inside the poll loop *and* between rounds precisely so a Stop never has to
/// wait out a whole slice. Timed against the ~380 ms the same search takes
/// uninterrupted.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_walk_stops_promptly_when_cancelled_mid_scan() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    });

    let started = Instant::now();
    let result = client
        .fetch_messages(
            &connection,
            PERF_TOPIC,
            &MessageFilter { key: Some("absent".into()), max_total_messages: Some(5), ..MessageFilter::default() },
            None,
            READ_TIMEOUT,
            MAX_MESSAGE_SIZE,
            None,
            cancelled,
            Arc::new(ScanProgress::default()),
        )
        .await
        .expect("a cancelled fetch is not a failure");
    let elapsed = started.elapsed();

    eprintln!("cancelled:   scanned {:>7} in {:>6} ms", result.scanned, elapsed.as_millis());
    // Generous, because the check granularity is a poll slice and the machine
    // is also running the broker — but far below the ~380 ms the uninterrupted
    // search takes, which is the thing being proven.
    assert!(elapsed < Duration::from_secs(5), "a cancelled walk kept reading: {elapsed:?}");
}

/// The progress counter is what the Data tab's line is built from, so it has
/// to actually move — and to end up agreeing with the result.
#[tokio::test(flavor = "multi_thread")]
async fn the_progress_counter_reports_the_range_and_ends_agreeing_with_the_result() {
    let client = RdKafkaClient::new();
    let connection = connection(broker!());

    let progress = Arc::new(ScanProgress::default());
    let result = client
        .fetch_messages(
            &connection,
            PERF_TOPIC,
            &MessageFilter { key: Some("needle".into()), ..MessageFilter::default() },
            None,
            READ_TIMEOUT,
            MAX_MESSAGE_SIZE,
            None,
            Arc::new(AtomicBool::new(false)),
            Arc::clone(&progress),
        )
        .await
        .expect("fetch failed");

    let (scanned, total) = progress.snapshot();
    assert_eq!(total, TOPIC_RECORDS, "the denominator is the size of the resolved range");
    assert_eq!(scanned, result.scanned, "the live counter and the result must agree at the end");
    assert_eq!(result.total_matching, TOPIC_RECORDS);
}
