use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::{
    AppError, BrokerSummary, ConfigEntry, Connection, ConnectionStatus, ConsumerGroupLag,
    ConsumerGroupSummary, MessageFetchResult, MessageFilter, MessageHeader, PartitionLag, PartitionSummary,
    SaslMechanism, SecurityProtocol, TopicMessage, TopicSummary,
};
use rdkafka::admin::{AdminClient, AdminOptions, ResourceSpecifier};
use rdkafka::client::{ClientContext, DefaultClientContext};
use rdkafka::consumer::{BaseConsumer, Consumer, ConsumerContext};
use rdkafka::error::{KafkaError, RDKafkaErrorCode};
use rdkafka::message::{BorrowedMessage, Headers};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};
use rdkafka::{ClientConfig, Message};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;

use crate::assignment::decode_consumer_protocol_assignment;
use crate::config::{build_client_config, client_config, BrokerSslConfig};
use crate::messages::{
    clamp_offset, combined_start_offset, distribute_total_budget, effective_max_messages_per_partition,
    newest_first_start_offset, partition_limits,
};

const TCP_PING_TIMEOUT: Duration = Duration::from_secs(3);

/// Fallback broker read timeout used only by this crate's own unit tests
/// (which call `KafkaClient` methods directly, bypassing the Tauri command
/// layer). Real callers always pass the user's configured General settings >
/// Brokers > Read Timeout value — see `frontend/src/features/settings/useGeneralSettingsStore.ts`
/// and its default, which this mirrors.
#[cfg(test)]
const TEST_READ_TIMEOUT: Duration = Duration::from_millis(10_000);

/// Fallback max message size used only by this crate's own unit tests — see
/// `TEST_READ_TIMEOUT`'s doc comment.
#[cfg(test)]
const TEST_MAX_MESSAGE_SIZE_BYTES: u32 = 1_048_576;

#[async_trait]
pub trait KafkaClient: Send + Sync {
    /// Checks a saved connection (used for the periodic, every-10s status
    /// dot poll in the connection tree — one call per saved connection, for
    /// as long as the app runs). Deliberately a plain TCP reachability
    /// check (see `ping_bootstrap`'s doc comment for the "why" behind that
    /// trade-off), NOT a real librdkafka client probe: creating and
    /// destroying a native Kafka client on this timer, forever, for every
    /// saved connection regardless of whether any of them are actually
    /// "Connected", was a real source of continuous native-resource churn —
    /// harmless in isolated bursts, but compounding into a slow, steady
    /// memory climb over a long-running session (worse on Windows, where
    /// librdkafka's client teardown is reportedly less prompt than on
    /// Unix). The deeper, protocol-level check (real SASL/SSL handshake,
    /// actual errors surfaced) still happens at Connect time via
    /// `test_connection`/the modal's "Test" button — this poll only ever
    /// needs to answer "is the network still there".
    async fn check_status(&self, connection: &Connection) -> Result<ConnectionStatus, AppError>;

    /// Plain TCP reachability check against each host:port in
    /// `bootstrap_servers` (comma-separated) — reports `Reachable` as soon
    /// as any one accepts a connection. Deliberately does not speak the
    /// Kafka wire protocol or apply any security settings: a broker that
    /// only accepts TLS/SASL (as virtually all managed cloud Kafka does)
    /// still has an open TCP port, and "is something listening" is the
    /// question this answers. Backs the ping button next to "Bootstrap
    /// servers" in the New Connection modal's General section.
    async fn ping_bootstrap(&self, bootstrap_servers: &str) -> Result<ConnectionStatus, AppError>;

    /// Tests full connectivity using the in-progress modal's entered
    /// values, before the connection has been saved. Backs the modal's
    /// bottom "Test" button. PLAIN/SCRAM mechanisms with no username/
    /// password entered will surface as an `Err` here rather than
    /// `ConnectionStatus::Unreachable` — this is a real config error, not a
    /// failed probe.
    async fn test_connection(
        &self,
        bootstrap_servers: &str,
        security_protocol: SecurityProtocol,
        sasl_mechanism: Option<SaslMechanism>,
        sasl_username: Option<&str>,
        password: Option<&str>,
        ssl: BrokerSslConfig<'_>,
    ) -> Result<ConnectionStatus, AppError>;

    /// Authenticates a saved connection and keeps the resulting client for
    /// every request that follows. Backs the cluster panel's Connect /
    /// Reconnect.
    ///
    /// Unlike `test_connection` (which probes values the user has typed but
    /// not saved, and throws the client away), this leaves a live,
    /// authenticated connection behind — so listing topics immediately
    /// afterwards is one request on an open socket rather than another full
    /// handshake.
    async fn connect(&self, connection: &Connection) -> Result<ConnectionStatus, AppError>;

    /// Closes and forgets this connection's pooled client. Called when the
    /// user disconnects, edits or deletes a connection, and when the broker
    /// rejects its credentials — anything that makes the pooled connection
    /// wrong or unwanted.
    fn release(&self, connection_id: &str);

    /// Backs the tree's "Brokers" sub-list once a cluster is connected.
    /// `read_timeout` is the user's configured General settings > Brokers >
    /// Read Timeout value.
    async fn list_brokers(&self, connection: &Connection, read_timeout: Duration) -> Result<Vec<BrokerSummary>, AppError>;

    /// Backs the tree's "Topics" sub-list once a cluster is connected.
    async fn list_topics(&self, connection: &Connection, read_timeout: Duration) -> Result<Vec<TopicSummary>, AppError>;

    /// Backs the tree's "Consumers" sub-list once a cluster is connected.
    async fn list_consumer_groups(
        &self,
        connection: &Connection,
        read_timeout: Duration,
    ) -> Result<Vec<ConsumerGroupSummary>, AppError>;

    /// Sums (high watermark - low watermark) across every partition of the
    /// topic. Backs the topic detail panel's Properties > Messages section,
    /// which fetches this lazily only when its Refresh button is clicked —
    /// never on tab open, since this can be an expensive per-partition call
    /// on a topic with many partitions.
    async fn count_topic_messages(&self, connection: &Connection, topic: &str, read_timeout: Duration) -> Result<u64, AppError>;

    /// Backs the topic Data tab's Fetch button. Pulls message metadata (plus
    /// base64 payload — decoded/rendered client-side when a row is
    /// clicked) applying the given filters; an all-`None` filter pulls
    /// everything. Bounded/historical, not a live tail: partition
    /// start/end offsets are resolved once up front (from watermarks, or
    /// from the from/to timestamps via `offsets_for_times`), so messages
    /// produced after the fetch starts are not included.
    ///
    /// When `on_message` is given, each message is also sent on it as soon
    /// as it's polled, in addition to being collected into the returned
    /// result — this lets a caller (the Tauri command layer) stream results
    /// to the UI incrementally instead of waiting for the whole fetch to
    /// finish. The channel is purely a progress feed: its receiver going
    /// away (e.g. the caller stopped listening) does not affect the fetch,
    /// which still runs to completion and returns the full result.
    ///
    /// `max_message_size_bytes` is the user's configured General settings >
    /// Messages > Max Message Size value, applied as librdkafka's
    /// `max.partition.fetch.bytes`.
    ///
    /// The returned `MessageFetchResult::total_matching` is how many
    /// messages satisfy `filter`'s partition/offset/timestamp constraints in
    /// total, uncapped by `max_messages_per_partition`/`max_total_messages`
    /// — lets the frontend tell the user whether more remain beyond what was
    /// actually pulled.
    async fn fetch_messages(
        &self,
        connection: &Connection,
        topic: &str,
        filter: &MessageFilter,
        on_message: Option<mpsc::UnboundedSender<TopicMessage>>,
        read_timeout: Duration,
        max_message_size_bytes: u32,
    ) -> Result<MessageFetchResult, AppError>;

    /// Backs the topic detail panel's Partitions tab: id, leader, replicas,
    /// ISR, and low/high offsets for every partition.
    async fn list_partitions(
        &self,
        connection: &Connection,
        topic: &str,
        read_timeout: Duration,
    ) -> Result<Vec<PartitionSummary>, AppError>;

    /// Backs the topic detail panel's Config tab, via librdkafka's
    /// DescribeConfigs admin API.
    async fn describe_topic_config(
        &self,
        connection: &Connection,
        topic: &str,
        read_timeout: Duration,
    ) -> Result<Vec<ConfigEntry>, AppError>;

    /// Backs the consumer group detail panel's "Refresh" button. Decodes
    /// each member's partition assignment (see `crate::assignment`), then
    /// fetches committed offsets (via a throwaway consumer scoped to this
    /// group id — never subscribed/polled, so it cannot join the group or
    /// disturb the real consumers' rebalance) and log-end offsets for
    /// exactly those partitions.
    async fn fetch_consumer_group_lag(
        &self,
        connection: &Connection,
        group_id: &str,
        read_timeout: Duration,
    ) -> Result<ConsumerGroupLag, AppError>;
}

/// Collects a message's Kafka headers. Values are base64-encoded, not
/// lossy-UTF-8-decoded — a header value is an arbitrary Kafka byte string,
/// not guaranteed text, and lossy decoding would silently corrupt a binary
/// one.
fn extract_headers(message: &BorrowedMessage) -> Vec<MessageHeader> {
    let Some(headers) = message.headers() else {
        return Vec::new();
    };
    headers
        .iter()
        .map(|header| MessageHeader {
            key: header.key.to_string(),
            value_base64: header.value.map(|v| BASE64.encode(v)),
        })
        .collect()
}

/// Captures librdkafka's own detailed failure reason (e.g. "SSL connection
/// closed by peer", "SASL authentication failed") via the `error` callback.
/// `fetch_metadata`'s return value alone can't distinguish these cases — a
/// closed port, a TLS failure, and a bad SASL password all surface as the
/// same generic `BrokerTransportFailure` code — so without this, every
/// failure reason gets collapsed into an identical, unhelpful message.
///
/// Attached to *every* client this module creates, not just the connection
/// probe: the reason string is also what tells an authentication rejection
/// apart from a transport blip (see [`crate::auth::is_auth_failure`]), and
/// that verdict decides whether the connection's circuit breaker trips. A
/// client created without this context can only ever report the generic
/// code, so a password rotated mid-session would look like a network
/// problem and be retried like one.
#[derive(Clone, Default)]
struct ClientErrorContext {
    last_error: Arc<Mutex<Option<String>>>,
}

impl ClientErrorContext {
    /// librdkafka's reason for the most recent failure on this client, if it
    /// reported one through the `error` callback.
    fn last_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|guard| guard.clone())
    }

    fn clear(&self) {
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = None;
        }
    }
}

impl ClientContext for ClientErrorContext {
    fn error(&self, _error: rdkafka::error::KafkaError, reason: &str) {
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = Some(reason.to_string());
        }
    }
}

impl ConsumerContext for ClientErrorContext {}

/// Every consumer in this module: a `BaseConsumer` that reports librdkafka's
/// failure reasons through [`ClientErrorContext`].
type ObservedConsumer = BaseConsumer<ClientErrorContext>;

/// How long a failed request will spend serving the client's event queue to
/// find out *why* it failed. Only ever spent on the error path.
const ERROR_DRAIN_BUDGET: Duration = Duration::from_millis(250);

/// A consumer together with the context watching it fail.
///
/// Cloneable and cheap (two `Arc`s), so one client can be shared by every
/// request against a connection — see [`RdKafkaClient::metadata_client`].
#[derive(Clone)]
struct ObservedClient {
    consumer: Arc<ObservedConsumer>,
    context: ClientErrorContext,
}

impl ObservedClient {
    fn create(config: &ClientConfig) -> Result<Self, AppError> {
        let context = ClientErrorContext::default();
        match config.create_with_context::<_, ObservedConsumer>(context.clone()) {
            Ok(consumer) => Ok(ObservedClient {
                consumer: Arc::new(consumer),
                context,
            }),
            Err(err) => {
                // No client exists to drain, so the only reason available is
                // the creation error itself — which does carry librdkafka's
                // text (e.g. "Invalid sasl.username: not set").
                let reason = err.to_string();
                Err(failure_report(&err, &reason, "failed to create kafka consumer"))
            }
        }
    }

    /// Forgets any reason left over from an earlier request on this client.
    ///
    /// A pooled client outlives the request that created it, so without this
    /// a stale reason from a previous failure could be reported — and
    /// classified — as the current one's cause.
    fn begin(&self) {
        self.context.clear();
    }

    /// Serves the client's event queue until it yields librdkafka's reason
    /// for a failure, or the budget runs out.
    ///
    /// librdkafka reports failures as *events*, and rdkafka only turns an
    /// event into a `ClientContext::error` call while the client's queue is
    /// being served — which nothing but `poll` does (rdkafka 0.36 sets no
    /// classic `error_cb` at all; see `Client::poll_event`). A client that
    /// only calls `fetch_metadata` therefore never learns why anything
    /// failed: its context stays empty and every failure collapses into the
    /// same generic "Broker transport failure". Polling here is what makes
    /// the reason — and with it the difference between a rejected password
    /// and an unreachable broker — observable at all.
    ///
    /// Safe on a consumer with no `group.id` and no assignment: rdkafka
    /// leaves such a client's main queue in place precisely so it can be
    /// used for metadata and watermarks.
    fn drain_error_events(&self) {
        let deadline = std::time::Instant::now() + ERROR_DRAIN_BUDGET;
        while self.context.last_error().is_none() && std::time::Instant::now() < deadline {
            let _ = self.consumer.poll(Duration::from_millis(10));
        }
    }

    /// Turns a librdkafka failure into a report carrying its real reason,
    /// typed as [`AppError::Authentication`] when the credentials were
    /// rejected and [`AppError::Kafka`] otherwise.
    ///
    /// The distinction is the whole point: `AppError::Authentication` is
    /// what the command layer trips the connection's circuit breaker on, so
    /// a rejected connection stops dialling the broker instead of being
    /// retried like a transient failure.
    fn failure(&self, error: &KafkaError, what: &str) -> error_stack::Report<AppError> {
        self.drain_error_events();
        let reason = self.context.last_error().unwrap_or_else(|| error.to_string());
        failure_report(error, &reason, what)
    }
}

/// Builds the report for a librdkafka failure whose reason is already known.
fn failure_report(error: &KafkaError, reason: &str, what: &str) -> error_stack::Report<AppError> {
    // `.change_context(AppError::Kafka)` alone would demote the `KafkaError`
    // to a non-`Printable` context frame that `format_report`
    // (src-tauri/src/commands/connections.rs) never surfaces to the user —
    // rendering the reason into the attachment is the only way it reaches
    // them instead of just the generic wrapper text.
    let kind = if crate::auth::is_auth_failure(Some(error), Some(reason)) {
        AppError::Authentication
    } else {
        AppError::Kafka
    };
    error_stack::Report::new(kind).attach_printable(format!("{what}: {reason}"))
}

async fn run_probe(config: ClientConfig) -> Result<ConnectionStatus, AppError> {
    tokio::task::spawn_blocking(move || {
        let client = ObservedClient::create(&config)?;
        probe_with(&client, PROBE_TIMEOUT)
    })
    .await
    .change_context(AppError::Kafka)
    .attach_printable("status check task panicked")?
}

/// How long a connection probe waits for the broker to answer. Covers the
/// TCP connection, the TLS and SASL handshakes, and the metadata response.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Asks the broker for metadata, which is the cheapest request that can only
/// succeed once the connection is fully established and authenticated.
fn probe_with(client: &ObservedClient, timeout: Duration) -> Result<ConnectionStatus, AppError> {
    client.begin();
    match client.consumer.fetch_metadata(None, timeout) {
        Ok(_) => Ok(ConnectionStatus::Reachable),
        Err(err) => Err(client.failure(&err, "failed to reach the cluster")),
    }
}

/// A client kept alive for reuse, with the version of the connection it was
/// built from.
struct PooledClient {
    /// The connection's `updated_at` at the time this client was built. A
    /// client built from credentials the user has since edited must never be
    /// reused, and this is what notices — even if nothing thought to
    /// release it.
    updated_at: String,
    client: ObservedClient,
}

/// The real Kafka client, holding one authenticated connection per saved
/// cluster.
///
/// Every request used to build its own client, which meant a TCP connection
/// plus — on a secured cluster — a TLS and SASL handshake before any request
/// could be sent. Connecting alone cost four of them: the probe, then the
/// tree's brokers, topics and consumer groups. The handshake dominated;
/// the request itself was never the slow part.
///
/// Now the probe at Connect leaves its authenticated client behind, and
/// every metadata request after it reuses that connection. librdkafka keeps
/// the socket alive and reconnects on its own if the broker goes away, so
/// the pooled client survives a broker restart without the app doing
/// anything.
///
/// Message fetching deliberately does *not* use this pool: a fetch assigns
/// partitions and polls, which is per-request state, and reusing one
/// consumer across fetches measured 3x slower (see `fetch_messages`).
#[derive(Default)]
pub struct RdKafkaClient {
    metadata_clients: Mutex<HashMap<String, PooledClient>>,
}

impl RdKafkaClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// This connection's pooled client, building and pooling one if there
    /// isn't a current one.
    ///
    /// Holds the pool lock across creation deliberately: the three requests
    /// the tree fires the moment a cluster connects would otherwise each
    /// build their own client for the same connection, which is the
    /// stampede this pool exists to prevent.
    fn metadata_client(&self, connection: &Connection) -> Result<ObservedClient, AppError> {
        let mut pool = self.metadata_clients.lock().unwrap_or_else(|err| err.into_inner());

        if let Some(pooled) = pool.get(&connection.id) {
            if pooled.updated_at == connection.updated_at {
                return Ok(pooled.client.clone());
            }
        }

        let client = ObservedClient::create(&client_config(connection))?;
        pool.insert(
            connection.id.clone(),
            PooledClient {
                updated_at: connection.updated_at.clone(),
                client: client.clone(),
            },
        );
        Ok(client)
    }

    fn drop_pooled_client(&self, connection_id: &str) {
        self.metadata_clients
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .remove(connection_id);
    }
}

#[async_trait]
impl KafkaClient for RdKafkaClient {
    async fn check_status(&self, connection: &Connection) -> Result<ConnectionStatus, AppError> {
        self.ping_bootstrap(&connection.bootstrap_servers).await
    }

    async fn connect(&self, connection: &Connection) -> Result<ConnectionStatus, AppError> {
        // A connection that fails to authenticate must not stay pooled: the
        // next request would reuse a client the broker has already rejected.
        let client = match self.metadata_client(connection) {
            Ok(client) => client,
            Err(err) => {
                self.drop_pooled_client(&connection.id);
                return Err(err);
            }
        };

        let result = tokio::task::spawn_blocking(move || probe_with(&client, PROBE_TIMEOUT))
            .await
            .change_context(AppError::Kafka)
            .attach_printable("connect task panicked")?;

        if result.is_err() {
            self.drop_pooled_client(&connection.id);
        }
        result
    }

    fn release(&self, connection_id: &str) {
        self.drop_pooled_client(connection_id);
    }

    async fn ping_bootstrap(&self, bootstrap_servers: &str) -> Result<ConnectionStatus, AppError> {
        for addr in bootstrap_servers.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if let Ok(Ok(_)) = timeout(TCP_PING_TIMEOUT, TcpStream::connect(addr)).await {
                return Ok(ConnectionStatus::Reachable);
            }
        }
        Ok(ConnectionStatus::Unreachable)
    }

    async fn test_connection(
        &self,
        bootstrap_servers: &str,
        security_protocol: SecurityProtocol,
        sasl_mechanism: Option<SaslMechanism>,
        sasl_username: Option<&str>,
        password: Option<&str>,
        ssl: BrokerSslConfig<'_>,
    ) -> Result<ConnectionStatus, AppError> {
        run_probe(build_client_config(
            bootstrap_servers,
            security_protocol,
            sasl_mechanism,
            sasl_username,
            password,
            ssl,
        ))
        .await
    }

    async fn list_brokers(&self, connection: &Connection, read_timeout: Duration) -> Result<Vec<BrokerSummary>, AppError> {
        let client = self.metadata_client(connection)?;
        tokio::task::spawn_blocking(move || {
            client.begin();
            let metadata = client
                .consumer
                .fetch_metadata(None, read_timeout)
                .map_err(|err| client.failure(&err, "failed to fetch broker metadata"))?;

            Ok(metadata
                .brokers()
                .iter()
                .map(|broker| BrokerSummary {
                    id: broker.id(),
                    host: broker.host().to_string(),
                    port: broker.port(),
                })
                .collect())
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("list_brokers task panicked")?
    }

    async fn list_topics(&self, connection: &Connection, read_timeout: Duration) -> Result<Vec<TopicSummary>, AppError> {
        let client = self.metadata_client(connection)?;
        tokio::task::spawn_blocking(move || {
            client.begin();
            let metadata = client
                .consumer
                .fetch_metadata(None, read_timeout)
                .map_err(|err| client.failure(&err, "failed to fetch topic metadata"))?;

            Ok(metadata
                .topics()
                .iter()
                .map(|topic| TopicSummary {
                    name: topic.name().to_string(),
                    partition_count: topic.partitions().len(),
                })
                .collect())
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("list_topics task panicked")?
    }

    async fn list_consumer_groups(
        &self,
        connection: &Connection,
        read_timeout: Duration,
    ) -> Result<Vec<ConsumerGroupSummary>, AppError> {
        let client = self.metadata_client(connection)?;
        tokio::task::spawn_blocking(move || {
            client.begin();
            let groups = client
                .consumer
                .fetch_group_list(None, read_timeout)
                .map_err(|err| client.failure(&err, "failed to fetch consumer group list"))?;

            Ok(groups
                .groups()
                .iter()
                .map(|group| ConsumerGroupSummary {
                    group_id: group.name().to_string(),
                    state: group.state().to_string(),
                })
                .collect())
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("list_consumer_groups task panicked")?
    }

    async fn count_topic_messages(&self, connection: &Connection, topic: &str, read_timeout: Duration) -> Result<u64, AppError> {
        let client = self.metadata_client(connection)?;
        let topic = topic.to_string();
        tokio::task::spawn_blocking(move || {
            client.begin();
            let consumer = Arc::clone(&client.consumer);
            let metadata = consumer.fetch_metadata(Some(&topic), read_timeout).map_err(|err| {
                client.failure(&err, &format!("failed to fetch metadata for topic {topic}"))
            })?;
            let topic_metadata = metadata
                .topics()
                .iter()
                .find(|t| t.name() == topic)
                .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("topic {topic} not found"))?;

            let mut total: u64 = 0;
            for partition in topic_metadata.partitions() {
                let (low, high) = consumer
                    .fetch_watermarks(&topic, partition.id(), read_timeout)
                    .change_context(AppError::Kafka)
                    .attach_printable_lazy(|| {
                        format!("failed to fetch watermarks for {topic}:{}", partition.id())
                    })?;
                total += (high - low).max(0) as u64;
            }
            Ok(total)
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("count_topic_messages task panicked")?
    }

    async fn fetch_messages(
        &self,
        connection: &Connection,
        topic: &str,
        filter: &MessageFilter,
        on_message: Option<mpsc::UnboundedSender<TopicMessage>>,
        read_timeout: Duration,
        max_message_size_bytes: u32,
    ) -> Result<MessageFetchResult, AppError> {
        let mut config = client_config(connection);
        config.set("group.id", "kafkaoxide-message-browser");
        config.set("enable.auto.commit", "false");
        config.set("max.partition.fetch.bytes", max_message_size_bytes.to_string());

        // librdkafka keeps pre-fetching ahead of what this fetch will
        // actually consume: assigning a partition at an offset tells it where
        // to start, never where to stop, so it reads forward towards the high
        // watermark until its local queue is full. That queue defaults to
        // 64 MB, which on a topic of 2-10 MB records is several times more
        // data pulled over the network than a 100-message fetch will ever
        // show.
        //
        // Kept at twice the largest message the user expects (floor of 1 MB)
        // so a single maximum-size record always fits with room to spare —
        // a queue smaller than one message would stall the fetch outright.
        let prefetch_kbytes = (u64::from(max_message_size_bytes) * 2 / 1024).max(1024);
        config.set("queued.max.messages.kbytes", prefetch_kbytes.to_string());

        // How long a broker may hold a fetch request open waiting for data
        // before answering it (librdkafka's default is 500ms). That default
        // is tuned for a streaming consumer, where an idle wait costs nothing
        // and saves request churn. This is an interactive browse: every fetch
        // here is bounded, already knows the offsets it wants, and has a user
        // watching — so a half-second of the broker holding a request is a
        // half-second of the UI looking stuck.
        config.set("fetch.wait.max.ms", "50");
        let topic = topic.to_string();
        let filter = filter.clone();
        tokio::task::spawn_blocking(move || {
            // A consumer per fetch, deliberately.
            //
            // Pooling them across fetches looks obviously right — the Data
            // tab's per-row "Fetch payload" is a whole fetch for one message,
            // and building a consumer means librdkafka's threads, a socket,
            // and on a SASL/TLS cluster a full handshake. Measured against a
            // real broker over 20 single-row fetches, it was 3x *slower*:
            // ~104ms per row building a fresh consumer, ~346ms reusing one
            // (~551ms before `fetch.wait.max.ms` was lowered below). Parking
            // a consumer between fetches means unassigning and reassigning it,
            // and whatever that costs inside librdkafka dwarfs what building
            // a new one costs. Measure before reaching for this again.
            let client = ObservedClient::create(&config)?;
            let consumer = Arc::clone(&client.consumer);

            let metadata = consumer.fetch_metadata(Some(&topic), read_timeout).map_err(|err| {
                client.failure(&err, &format!("failed to fetch metadata for topic {topic}"))
            })?;
            let topic_metadata = metadata
                .topics()
                .iter()
                .find(|t| t.name() == topic)
                .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("topic {topic} not found"))?;

            let target_partitions: Vec<i32> = match &filter.partitions {
                Some(partitions) => partitions.clone(),
                None => topic_metadata.partitions().iter().map(|p| p.id()).collect(),
            };

            // Queried once per partition and reused. `fetch_watermarks` is a
            // blocking round trip to the partition's leader, and the offset
            // maths below reads each partition's watermarks several times
            // over — as a closure that re-queried, a 48-partition topic paid
            // well over a hundred round trips before a single message moved.
            let watermarks_by_partition: BTreeMap<i32, (i64, i64)> = target_partitions
                .iter()
                .map(|&partition| {
                    consumer
                        .fetch_watermarks(&topic, partition, read_timeout)
                        .map(|watermarks| (partition, watermarks))
                        .change_context(AppError::Kafka)
                        .attach_printable_lazy(|| format!("failed to fetch watermarks for {topic}:{partition}"))
                })
                .collect::<Result<_, _>>()?;

            let watermarks = |partition: i32| -> Result<(i64, i64), AppError> {
                watermarks_by_partition
                    .get(&partition)
                    .copied()
                    .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                    .attach_printable_lazy(|| format!("no such partition: {topic}:{partition}"))
            };

            // An explicit `offset` and a `from_timestamp_ms` are independent
            // constraints, not alternatives — both apply together (AND) when
            // both are given, via `combined_start_offset`, rather than one
            // silently overriding the other. See its doc comment for why the
            // later (higher) of the two is the correct combination.
            let explicit_start_offsets: Option<BTreeMap<i32, i64>> = filter
                .offset
                .map(|offset| {
                    target_partitions
                        .iter()
                        .map(|&p| watermarks(p).map(|(low, high)| (p, clamp_offset(offset, low, high))))
                        .collect::<Result<BTreeMap<i32, i64>, AppError>>()
                })
                .transpose()?;

            let from_timestamp_start_offsets: Option<BTreeMap<i32, i64>> = filter
                .from_timestamp_ms
                .map(|from_ms| {
                    resolve_offsets_by_timestamp(&consumer, &topic, &target_partitions, from_ms, read_timeout, |p| {
                        watermarks(p).map(|(low, _)| low)
                    })
                })
                .transpose()?;

            // Where the *filter* puts each partition's start, before any count
            // cap narrows it: the explicit offset / from-timestamp when either
            // is given, the low watermark otherwise. Everything below measures
            // against this — "how many messages match" is a property of the
            // filter, and the count caps then carve a window out of that range
            // rather than defining it.
            let start_is_pinned_by_filter =
                explicit_start_offsets.is_some() || from_timestamp_start_offsets.is_some();
            let filter_start_offsets: BTreeMap<i32, i64> = if start_is_pinned_by_filter {
                target_partitions
                    .iter()
                    .map(|&p| {
                        let explicit = explicit_start_offsets.as_ref().and_then(|m| m.get(&p).copied());
                        let from_ts = from_timestamp_start_offsets.as_ref().and_then(|m| m.get(&p).copied());
                        let start = combined_start_offset(explicit, from_ts)
                            .expect("at least one start-offset source is set for every target partition");
                        (p, start)
                    })
                    .collect()
            } else {
                target_partitions
                    .iter()
                    .map(|&p| watermarks(p).map(|(low, _)| (p, low)))
                    .collect::<Result<_, _>>()?
            };

            let end_offsets: BTreeMap<i32, i64> = if let Some(to_ms) = filter.to_timestamp_ms {
                resolve_offsets_by_timestamp(&consumer, &topic, &target_partitions, to_ms, read_timeout, |p| {
                    watermarks(p).map(|(_, high)| high)
                })?
            } else {
                target_partitions
                    .iter()
                    .map(|&p| watermarks(p).map(|(_, high)| (p, high)))
                    .collect::<Result<_, _>>()?
            };

            // How many messages actually satisfy the partition/offset/
            // timestamp constraints, uncapped by the count limits below — the
            // frontend shows the gap ("100 of 4,812 loaded") so the user can
            // tell more remain beyond what was pulled. Measured from the
            // filter's own start, not from the capped window: measuring from
            // the window made this the same number as the window itself, so
            // "loaded / matching" reported the cap back to the user as though
            // it were the size of the topic.
            let total_matching: u64 = partition_limits(&filter_start_offsets, &end_offsets, None)
                .values()
                .map(|&available| available.max(0) as u64)
                .sum();

            // Two independent limits, both honoured. "Max messages per
            // partition" is a window — never read further back than this in
            // any one partition. "Total max messages" is a budget — how many
            // to actually read, spread over the partitions rather than
            // draining them in id order.
            //
            // `partition_limits` treats `None` as "uncapped", which is right
            // for it as a generic utility and wrong for this caller: an
            // offset- or timestamp-filtered fetch with no count set would
            // otherwise read from its start point to the end of the
            // partition, so the per-partition window always gets a concrete
            // value via `effective_max_messages_per_partition`.
            let windows = partition_limits(
                &filter_start_offsets,
                &end_offsets,
                Some(effective_max_messages_per_partition(filter.max_messages_per_partition)),
            );
            let limits = distribute_total_budget(&windows, filter.max_total_messages);

            // The start offsets to actually assign. When the filter pinned a
            // start, reading begins there. Otherwise the fetch is
            // newest-first, and each partition begins exactly its allocation
            // back from the end — so a budget of 100 across 48 partitions
            // reads ~2 messages per partition instead of reading 100 from
            // each and discarding 4,700 of them. On a topic of multi-megabyte
            // records that difference is the whole fetch.
            let start_offsets: BTreeMap<i32, i64> = if start_is_pinned_by_filter {
                filter_start_offsets
            } else {
                target_partitions
                    .iter()
                    .map(|&p| {
                        watermarks(p).map(|(low, high)| {
                            // `end` rather than the high watermark: with a
                            // to-timestamp filter the newest message in range
                            // is that boundary, not the end of the partition.
                            let end = end_offsets.get(&p).copied().unwrap_or(high);
                            let take = limits.get(&p).copied().unwrap_or(0);
                            (p, newest_first_start_offset(low, end, take))
                        })
                    })
                    .collect::<Result<_, _>>()?
            };

            let mut assign_tpl = TopicPartitionList::new();
            for (&partition, &limit) in &limits {
                if limit > 0 {
                    let start = start_offsets.get(&partition).copied().unwrap_or(0);
                    assign_tpl
                        .add_partition_offset(&topic, partition, Offset::Offset(start))
                        .change_context(AppError::Kafka)
                        .attach_printable("failed to build partition assignment")?;
                }
            }
            consumer
                .assign(&assign_tpl)
                .change_context(AppError::Kafka)
                .attach_printable("failed to assign partitions")?;

            let total_target: i64 = limits.values().sum();
            let mut remaining = limits;
            let mut collected = Vec::new();
            const POLL_TIMEOUT: Duration = Duration::from_millis(500);
            const IDLE_TIMEOUT: Duration = Duration::from_secs(10);
            let mut idle_elapsed = Duration::ZERO;
            let mut last_poll_error: Option<String> = None;

            while (collected.len() as i64) < total_target && idle_elapsed < IDLE_TIMEOUT {
                match consumer.poll(POLL_TIMEOUT) {
                    Some(Ok(borrowed)) => {
                        idle_elapsed = Duration::ZERO;
                        let partition = borrowed.partition();
                        let budget = remaining.get(&partition).copied().unwrap_or(0);
                        if budget <= 0 {
                            continue;
                        }
                        let message = TopicMessage {
                            partition,
                            offset: borrowed.offset(),
                            timestamp_ms: borrowed.timestamp().to_millis(),
                            key_base64: borrowed.key().map(|k| BASE64.encode(k)),
                            payload_base64: filter
                                .include_payload
                                .then(|| BASE64.encode(borrowed.payload().unwrap_or(&[]))),
                            headers: extract_headers(&borrowed),
                        };
                        if let Some(sender) = &on_message {
                            let _ = sender.send(message.clone());
                        }
                        collected.push(message);
                        remaining.insert(partition, budget - 1);
                    }
                    Some(Err(err)) => {
                        idle_elapsed += POLL_TIMEOUT;
                        last_poll_error = Some(describe_poll_error(&err));
                    }
                    None => {
                        idle_elapsed += POLL_TIMEOUT;
                    }
                }
            }

            Ok(MessageFetchResult { messages: collected, total_matching, poll_error: last_poll_error })
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("fetch_messages task panicked")?
    }

    async fn list_partitions(
        &self,
        connection: &Connection,
        topic: &str,
        read_timeout: Duration,
    ) -> Result<Vec<PartitionSummary>, AppError> {
        let client = self.metadata_client(connection)?;
        let topic = topic.to_string();
        tokio::task::spawn_blocking(move || {
            client.begin();
            let consumer = Arc::clone(&client.consumer);
            let metadata = consumer.fetch_metadata(Some(&topic), read_timeout).map_err(|err| {
                client.failure(&err, &format!("failed to fetch metadata for topic {topic}"))
            })?;
            let topic_metadata = metadata
                .topics()
                .iter()
                .find(|t| t.name() == topic)
                .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("topic {topic} not found"))?;

            topic_metadata
                .partitions()
                .iter()
                .map(|partition| {
                    let (low, high) = consumer
                        .fetch_watermarks(&topic, partition.id(), read_timeout)
                        .change_context(AppError::Kafka)
                        .attach_printable_lazy(|| {
                            format!("failed to fetch watermarks for {topic}:{}", partition.id())
                        })?;
                    Ok(PartitionSummary {
                        id: partition.id(),
                        leader: partition.leader(),
                        replicas: partition.replicas().to_vec(),
                        isr: partition.isr().to_vec(),
                        low_offset: low,
                        high_offset: high,
                    })
                })
                .collect()
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("list_partitions task panicked")?
    }

    async fn describe_topic_config(
        &self,
        connection: &Connection,
        topic: &str,
        read_timeout: Duration,
    ) -> Result<Vec<ConfigEntry>, AppError> {
        let config = client_config(connection);
        // The admin client is its own type, so it can't come from the
        // consumer pool, and there is no queue for `drain_error_events` to
        // serve — an admin failure is classified from its error code alone.
        let admin: AdminClient<DefaultClientContext> = config
            .create()
            .map_err(|err| failure_report(&err, &err.to_string(), "failed to create kafka admin client"))?;

        let specifier = ResourceSpecifier::Topic(topic);
        let options = AdminOptions::new().request_timeout(Some(read_timeout));
        let results = admin.describe_configs([&specifier], &options).await.map_err(|err| {
            failure_report(&err, &err.to_string(), &format!("failed to describe config for topic {topic}"))
        })?;

        let resource_result = results
            .into_iter()
            .next()
            .ok_or_else(|| error_stack::Report::new(AppError::Kafka))
            .attach_printable_lazy(|| format!("no config result returned for topic {topic}"))?;
        let resource = resource_result
            .change_context(AppError::Kafka)
            .attach_printable_lazy(|| format!("kafka rejected describe-config for topic {topic}"))?;

        Ok(resource
            .entries
            .into_iter()
            .map(|entry| ConfigEntry { name: entry.name, value: entry.value })
            .collect())
    }

    async fn fetch_consumer_group_lag(
        &self,
        connection: &Connection,
        group_id: &str,
        read_timeout: Duration,
    ) -> Result<ConsumerGroupLag, AppError> {
        let client = self.metadata_client(connection)?;
        let mut group_config = client_config(connection);
        let group_id = group_id.to_string();
        tokio::task::spawn_blocking(move || {
            client.begin();
            let consumer = Arc::clone(&client.consumer);
            let groups = consumer.fetch_group_list(Some(&group_id), read_timeout).map_err(|err| {
                client.failure(&err, &format!("failed to fetch group list for {group_id}"))
            })?;
            let group = groups
                .groups()
                .iter()
                .find(|g| g.name() == group_id)
                .ok_or_else(|| error_stack::Report::new(AppError::NotFound))
                .attach_printable_lazy(|| format!("group {group_id} not found"))?;

            let mut owners: HashMap<(String, i32), (String, String)> = HashMap::new();
            let mut decode_failures = 0usize;
            let mut decode_attempts = 0usize;
            for member in group.members() {
                if group.protocol_type() != "consumer" {
                    continue;
                }
                let Some(assignment_bytes) = member.assignment() else {
                    continue;
                };
                decode_attempts += 1;
                match decode_consumer_protocol_assignment(assignment_bytes) {
                    Ok(partitions) => {
                        for (topic, partition) in partitions {
                            owners.insert(
                                (topic, partition),
                                (member.client_id().to_string(), member.client_host().to_string()),
                            );
                        }
                    }
                    Err(_) => decode_failures += 1,
                }
            }

            if decode_attempts > 0 && decode_failures == decode_attempts {
                return Err(error_stack::Report::new(AppError::Kafka)).attach_printable_lazy(|| {
                    format!("could not determine partition assignment for group {group_id}")
                });
            }

            if owners.is_empty() {
                return Ok(ConsumerGroupLag {
                    state: group.state().to_string(),
                    partitions: Vec::new(),
                });
            }

            let mut tpl = TopicPartitionList::new();
            for (topic, partition) in owners.keys() {
                tpl.add_partition(topic, *partition);
            }

            group_config.set("group.id", &group_id);
            // Not pooled: this one carries a `group.id`, which changes what
            // the client is, and it exists only for this request.
            let group_client = ObservedClient::create(&group_config)?;
            let committed = group_client
                .consumer
                .committed_offsets(tpl, read_timeout)
                .map_err(|err| {
                    group_client.failure(&err, &format!("failed to fetch committed offsets for {group_id}"))
                })?;

            let mut partitions = Vec::new();
            for element in committed.elements() {
                let topic = element.topic().to_string();
                let partition = element.partition();
                let current_offset = element.offset().to_raw().filter(|&o| o >= 0);

                let (_low, high) = consumer
                    .fetch_watermarks(&topic, partition, read_timeout)
                    .change_context(AppError::Kafka)
                    .attach_printable_lazy(|| {
                        format!("failed to fetch watermarks for {topic}:{partition}")
                    })?;

                let lag = current_offset.map(|current| (high - current).max(0));
                let (client_id, client_host) = owners
                    .get(&(topic.clone(), partition))
                    .cloned()
                    .map(|(id, host)| (Some(id), Some(host)))
                    .unwrap_or((None, None));

                partitions.push(PartitionLag {
                    topic,
                    partition,
                    current_offset,
                    log_end_offset: high,
                    lag,
                    client_id,
                    client_host,
                });
            }

            Ok(ConsumerGroupLag { state: group.state().to_string(), partitions })
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("fetch_consumer_group_lag task panicked")?
    }
}

/// Turns a poll failure into a line that explains itself.
///
/// `NotImplemented` is what librdkafka reports for a batch it has no code path
/// to decompress, and rdkafka-rust throws away the detail: the error op
/// librdkafka enqueues carries a string naming the offending codec
/// (`rd_kafka_event_error_string`), but `handle_error_event` keeps only the
/// error *code*, so all that reaches us is "Message consumption error:
/// NotImplemented (Local: Not implemented)". Every bug report about this
/// arrived as exactly that sentence, which cannot distinguish "this build was
/// compiled without the codec" — the cause every previous time — from anything
/// else sharing the code.
///
/// So attach what this binary can actually decode, read out of librdkafka
/// itself (see [`crate::build_info`]). The next report then says which case it
/// is without a round trip.
fn describe_poll_error(err: &KafkaError) -> String {
    let message = err.to_string();

    let code = match err {
        KafkaError::MessageConsumption(code) | KafkaError::MessageConsumptionFatal(code) => *code,
        _ => return message,
    };
    if code != RDKafkaErrorCode::NotImplemented {
        return message;
    }

    let features = crate::build_info::builtin_features();
    match crate::build_info::missing_required_features().as_slice() {
        [] => format!(
            "{message} - this build decodes {features}, so the batch is not \
             simply using a codec that was left out of the build"
        ),
        missing => format!(
            "{message} - this build of librdkafka is missing {}, and a topic \
             compressed with one of those cannot be read at all. Compiled \
             with: {features}",
            missing.join(", "),
        ),
    }
}

/// Resolves each target partition's offset at `timestamp_ms` via
/// `offsets_for_times`, falling back to `fallback` (a watermark lookup) for
/// any partition librdkafka couldn't resolve to a concrete offset (e.g. the
/// timestamp is after every message in the partition).
fn resolve_offsets_by_timestamp(
    consumer: &ObservedConsumer,
    topic: &str,
    partitions: &[i32],
    timestamp_ms: i64,
    read_timeout: Duration,
    fallback: impl Fn(i32) -> Result<i64, AppError>,
) -> Result<BTreeMap<i32, i64>, AppError> {
    let mut request = TopicPartitionList::new();
    for &partition in partitions {
        request
            .add_partition_offset(topic, partition, Offset::Offset(timestamp_ms))
            .change_context(AppError::Kafka)
            .attach_printable("failed to build offsets_for_times request")?;
    }

    let resolved = consumer
        .offsets_for_times(request, read_timeout)
        .change_context(AppError::Kafka)
        .attach_printable("failed to resolve timestamp to offsets")?;

    let mut result = BTreeMap::new();
    for partition in partitions {
        let raw_offset = resolved
            .elements_for_topic(topic)
            .into_iter()
            .find(|elem| elem.partition() == *partition)
            .and_then(|elem| elem.offset().to_raw())
            .filter(|&offset| offset >= 0);

        let offset = match raw_offset {
            Some(offset) => offset,
            None => fallback(*partition)?,
        };
        result.insert(*partition, offset);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pooled_test_connection() -> Connection {
        Connection {
            id: "conn-1".into(),
            name: "test".into(),
            // Creating a librdkafka client does not connect, so these tests
            // need no broker.
            bootstrap_servers: "localhost:9092".into(),
            kafka_version: "3.7".into(),
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
            updated_at: "2026-08-27T00:00:00Z".into(),
        }
    }

    /// The point of the pool: a second request against the same connection
    /// reuses the first one's client — and therefore its already-established,
    /// already-authenticated connection — instead of paying for another
    /// handshake.
    #[test]
    fn a_second_request_for_the_same_connection_reuses_one_client() {
        let kafka = RdKafkaClient::new();
        let connection = pooled_test_connection();

        let first = kafka.metadata_client(&connection).expect("first client");
        let second = kafka.metadata_client(&connection).expect("second client");

        assert!(Arc::ptr_eq(&first.consumer, &second.consumer), "expected one pooled client, got two");
    }

    #[test]
    fn different_connections_get_their_own_clients() {
        let kafka = RdKafkaClient::new();
        let one = pooled_test_connection();
        let mut two = pooled_test_connection();
        two.id = "conn-2".into();

        let first = kafka.metadata_client(&one).expect("first client");
        let second = kafka.metadata_client(&two).expect("second client");

        assert!(!Arc::ptr_eq(&first.consumer, &second.consumer));
    }

    /// An edited connection must never keep talking to the broker with the
    /// settings the user just replaced — even if nothing thought to release
    /// the old client.
    #[test]
    fn editing_a_connection_retires_the_client_built_from_the_old_settings() {
        let kafka = RdKafkaClient::new();
        let connection = pooled_test_connection();
        let before = kafka.metadata_client(&connection).expect("first client");

        let mut edited = connection.clone();
        edited.bootstrap_servers = "otherhost:9092".into();
        edited.updated_at = "2026-08-27T01:00:00Z".into();
        let after = kafka.metadata_client(&edited).expect("client after the edit");

        assert!(!Arc::ptr_eq(&before.consumer, &after.consumer));
    }

    #[test]
    fn releasing_a_connection_drops_its_pooled_client() {
        let kafka = RdKafkaClient::new();
        let connection = pooled_test_connection();
        let before = kafka.metadata_client(&connection).expect("first client");

        kafka.release(&connection.id);
        let after = kafka.metadata_client(&connection).expect("client after release");

        assert!(!Arc::ptr_eq(&before.consumer, &after.consumer));
    }

    #[test]
    fn a_pooled_client_forgets_an_earlier_requests_failure_reason() {
        // The context outlives the request, so a reason left behind by an
        // earlier failure must not be read as this request's cause.
        let kafka = RdKafkaClient::new();
        let client = kafka.metadata_client(&pooled_test_connection()).expect("client");
        client.context.error(KafkaError::Canceled, "Authentication failed");
        assert!(client.context.last_error().is_some());

        client.begin();

        assert_eq!(client.context.last_error(), None);
    }

    /// The report that started this: a bare `NotImplemented` says nothing
    /// about *why*, and the answer is a compile-time property of the binary,
    /// so the binary should be the one to state it.
    #[test]
    fn a_not_implemented_poll_error_reports_what_this_build_can_decode() {
        let described = describe_poll_error(&KafkaError::MessageConsumption(
            RDKafkaErrorCode::NotImplemented,
        ));

        assert!(
            described.starts_with("Message consumption error"),
            "the original error must survive, got {described:?}"
        );
        assert!(
            described.contains(&crate::build_info::builtin_features()),
            "the codec list librdkafka reports must be in the message, got {described:?}"
        );
    }

    /// Fatal and non-fatal arrive as different variants of the same code, and
    /// a user hitting the fatal one needs the same explanation.
    #[test]
    fn the_fatal_variant_is_explained_the_same_way() {
        let described = describe_poll_error(&KafkaError::MessageConsumptionFatal(
            RDKafkaErrorCode::NotImplemented,
        ));

        assert!(described.contains(&crate::build_info::builtin_features()));
    }

    /// Only `NotImplemented` is about codecs. Annotating every poll failure
    /// with a codec list would bury the actual reason for the common ones.
    #[test]
    fn other_poll_errors_are_left_exactly_as_rdkafka_worded_them() {
        let err = KafkaError::MessageConsumption(RDKafkaErrorCode::UnknownTopicOrPartition);

        assert_eq!(describe_poll_error(&err), err.to_string());
    }

    fn sample_connection() -> Connection {
        Connection {
            id: "1".into(),
            name: "test".into(),
            bootstrap_servers: "127.0.0.1:1".into(),
            kafka_version: "3.7".into(),
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

    #[tokio::test]
    async fn check_status_reports_unreachable_for_a_closed_port_without_creating_a_kafka_client() {
        // Regression test: check_status used to create+destroy a real
        // librdkafka client on every call (via run_probe), and this is the
        // periodic every-10s status-dot poll — one such cycle per saved
        // connection, forever, for as long as the app runs, entirely
        // independent of whether the user ever actually "Connects". That
        // continuous native-client churn was a plausible source of the
        // slow memory growth reported on long-running Windows sessions.
        // check_status must now be a plain TCP check (like ping_bootstrap)
        // and therefore never produce a hard Err for a merely-closed port.
        let client = RdKafkaClient::new();
        let status = client.check_status(&sample_connection()).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    #[tokio::test]
    async fn ping_bootstrap_reports_unreachable_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let status = client.ping_bootstrap("127.0.0.1:1").await.unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    // Reproduces the reported bug: a broker that only accepts TLS/SASL (as
    // virtually all managed cloud Kafka does) still has an open TCP port —
    // it just won't speak plaintext Kafka wire protocol on it. Ping should
    // answer "is something listening", not "can I complete an unauthenticated
    // plaintext Kafka handshake", so it must not depend on rdkafka's
    // fetch_metadata at all. This listener accepts a connection and then
    // does nothing — never sending anything a real Kafka client would
    // recognize — simulating exactly that TLS-only-broker case.
    #[tokio::test]
    async fn ping_bootstrap_reports_reachable_for_a_listener_that_speaks_no_kafka_protocol() {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = listener.accept().await;
        });

        let client = RdKafkaClient::new();
        let status = client
            .ping_bootstrap(&format!("127.0.0.1:{port}"))
            .await
            .unwrap();
        assert_eq!(status, ConnectionStatus::Reachable);
    }

    #[tokio::test]
    async fn ping_bootstrap_reports_reachable_when_any_of_several_servers_is_up() {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = listener.accept().await;
        });

        let client = RdKafkaClient::new();
        // First entry (port 1) is closed; second is the live listener above.
        let status = client
            .ping_bootstrap(&format!("127.0.0.1:1,127.0.0.1:{port}"))
            .await
            .unwrap();
        assert_eq!(status, ConnectionStatus::Reachable);
    }

    #[tokio::test]
    async fn ping_bootstrap_reports_unreachable_for_an_unresolvable_host() {
        let client = RdKafkaClient::new();
        let status = client
            .ping_bootstrap("this-host-does-not-resolve.invalid:9092")
            .await
            .unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    /// A closed port must never be mistaken for rejected credentials: the
    /// command layer trips a connection's circuit breaker on
    /// `AppError::Authentication`, so a false positive here would lock a
    /// user out of a cluster that is merely down.
    #[tokio::test]
    async fn test_connection_reports_an_unreachable_port_as_a_kafka_error_not_an_auth_failure() {
        let client = RdKafkaClient::new();
        let result = client
            .test_connection(
                "127.0.0.1:1",
                SecurityProtocol::Plaintext,
                None,
                None,
                None,
                BrokerSslConfig::default(),
            )
            .await;

        let report = result.expect_err("a closed port should fail");
        assert!(
            !matches!(report.current_context(), AppError::Authentication),
            "expected a transport-level error, got {report:?}"
        );
    }

    #[tokio::test]
    async fn test_connection_reports_a_real_error_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client
            .test_connection(
                "127.0.0.1:1",
                SecurityProtocol::Plaintext,
                None,
                None,
                None,
                BrokerSslConfig::default(),
            )
            .await;
        assert!(result.is_err(), "expected a real error, got {result:?}");
    }

    #[tokio::test]
    async fn list_brokers_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client.list_brokers(&sample_connection(), TEST_READ_TIMEOUT).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_topics_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client.list_topics(&sample_connection(), TEST_READ_TIMEOUT).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_consumer_groups_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client.list_consumer_groups(&sample_connection(), TEST_READ_TIMEOUT).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn count_topic_messages_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client
            .count_topic_messages(&sample_connection(), "orders", TEST_READ_TIMEOUT)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_messages_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), None, TEST_READ_TIMEOUT, TEST_MAX_MESSAGE_SIZE_BYTES)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_messages_surfaces_the_real_metadata_fetch_failure_reason() {
        // Regression test: `.change_context(AppError::Kafka)` alone silently
        // drops the underlying `KafkaError`'s message (it becomes a
        // non-`Printable` context frame `format_report` never walks), so a
        // metadata-fetch failure used to reach the user as just "failed to
        // fetch metadata for topic orders" with no indication of *why* —
        // useless for diagnosing an intermittent broker/network issue.
        let client = RdKafkaClient::new();
        let report = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), None, TEST_READ_TIMEOUT, TEST_MAX_MESSAGE_SIZE_BYTES)
            .await
            .expect_err("expected a metadata-fetch failure against a closed port");
        let printable = printable_attachments(&report).join(" | ").to_lowercase();
        assert!(
            printable.contains("transport") || printable.contains("timed out") || printable.contains("connect"),
            "expected the real librdkafka failure reason in a Printable attachment, got: {printable:?}"
        );
    }

    #[tokio::test]
    async fn fetch_messages_streams_each_message_on_the_given_channel_as_it_arrives() {
        // A closed-port fetch fails before ever polling a message, so this
        // only proves the sender is accepted and the channel closes cleanly
        // (no hang) when the fetch errors out early — full delivery-of-real-
        // messages behavior needs a live broker and isn't covered by this
        // unit test suite (see the `_errors_for_a_closed_port` tests' doc
        // comments for why: no broker fixture in this crate).
        let client = RdKafkaClient::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let result = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), Some(tx), TEST_READ_TIMEOUT, TEST_MAX_MESSAGE_SIZE_BYTES)
            .await;
        assert!(result.is_err());
        assert!(rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn list_partitions_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client.list_partitions(&sample_connection(), "orders", TEST_READ_TIMEOUT).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn describe_topic_config_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client.describe_topic_config(&sample_connection(), "orders", TEST_READ_TIMEOUT).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_consumer_group_lag_errors_for_a_closed_port() {
        let client = RdKafkaClient::new();
        let result = client
            .fetch_consumer_group_lag(&sample_connection(), "billing-service", TEST_READ_TIMEOUT)
            .await;
        assert!(result.is_err());
    }

    // Mirrors `format_report` in `src-tauri/src/commands/connections.rs` —
    // that's the ONLY thing that actually reaches the frontend
    // (`CommandError.message`), and it walks exclusively `Printable`
    // attachments, ignoring everything else in the report (including
    // whatever `format!("{:?}", report)` would show, which is much more
    // verbose and can make a bug look fixed when it isn't).
    fn printable_attachments(report: &error_stack::Report<AppError>) -> Vec<String> {
        use error_stack::{AttachmentKind, FrameKind};
        report
            .frames()
            .filter_map(|frame| match frame.kind() {
                FrameKind::Attachment(AttachmentKind::Printable(printable)) => Some(printable.to_string()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn test_connection_surfaces_a_config_error_for_sasl_mechanisms_missing_a_username() {
        // PLAIN/SCRAM mechanisms need sasl.username — if the Authentication
        // tab's Username field was left blank, librdkafka refuses to even
        // build a client, which is surfaced as an error rather than
        // misreported as "unreachable". The user-visible message must
        // contain librdkafka's actual reason, not just the generic "failed
        // to create kafka consumer" wrapper text — that alone isn't
        // actionable for someone staring at an error dialog.
        let client = RdKafkaClient::new();
        let result = client
            .test_connection(
                "127.0.0.1:1",
                SecurityProtocol::SaslPlaintext,
                Some(SaslMechanism::Plain),
                None,
                None,
                BrokerSslConfig::default(),
            )
            .await;
        let report = result.expect_err("expected a config error");
        let printable = printable_attachments(&report).join(" | ").to_lowercase();
        assert!(
            printable.contains("sasl") || printable.contains("username"),
            "expected the real librdkafka reason in a user-visible (Printable) attachment, got: {printable:?}"
        );
    }

    #[tokio::test]
    async fn test_connection_reaches_the_probe_stage_once_a_username_is_given() {
        // Distinguishes this from `..._missing_a_username` above: both now
        // return `Err`, but this one must fail *during the connection
        // attempt* (client creation succeeds), not during config
        // validation — the error message should reflect a probe failure,
        // not "failed to create kafka consumer".
        let client = RdKafkaClient::new();
        let result = client
            .test_connection(
                "127.0.0.1:1",
                SecurityProtocol::SaslPlaintext,
                Some(SaslMechanism::Plain),
                Some("kafka-user"),
                Some("hunter2"),
                BrokerSslConfig::default(),
            )
            .await;
        let err = result.expect_err("expected a real error, but the probe unexpectedly succeeded");
        let message = format!("{err:?}");
        assert!(
            !message.contains("failed to create kafka consumer"),
            "expected a probe-stage failure, but client creation itself failed: {message}"
        );
    }
}

