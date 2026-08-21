use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use error_stack::{Result, ResultExt};
use kafkaoxide_core::{
    AppError, BrokerSummary, ConfigEntry, Connection, ConnectionStatus, ConsumerGroupLag,
    ConsumerGroupSummary, MessageFilter, MessageHeader, PartitionLag, PartitionSummary,
    SaslMechanism, SecurityProtocol, TopicMessage, TopicSummary,
};
use rdkafka::admin::{AdminClient, AdminOptions, ResourceSpecifier};
use rdkafka::client::{ClientContext, DefaultClientContext};
use rdkafka::consumer::{BaseConsumer, Consumer, ConsumerContext};
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
    apply_total_cap, clamp_offset, effective_max_messages_per_partition, newest_first_start_offset, partition_limits,
};

const METADATA_TIMEOUT: Duration = Duration::from_secs(5);
const TCP_PING_TIMEOUT: Duration = Duration::from_secs(3);

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

    /// Backs the tree's "Brokers" sub-list once a cluster is connected.
    async fn list_brokers(&self, connection: &Connection) -> Result<Vec<BrokerSummary>, AppError>;

    /// Backs the tree's "Topics" sub-list once a cluster is connected.
    async fn list_topics(&self, connection: &Connection) -> Result<Vec<TopicSummary>, AppError>;

    /// Backs the tree's "Consumers" sub-list once a cluster is connected.
    async fn list_consumer_groups(&self, connection: &Connection) -> Result<Vec<ConsumerGroupSummary>, AppError>;

    /// Sums (high watermark - low watermark) across every partition of the
    /// topic. Backs the topic detail panel's Properties > Messages section,
    /// which fetches this lazily only when its Refresh button is clicked —
    /// never on tab open, since this can be an expensive per-partition call
    /// on a topic with many partitions.
    async fn count_topic_messages(&self, connection: &Connection, topic: &str) -> Result<u64, AppError>;

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
    /// `Vec` — this lets a caller (the Tauri command layer) stream results
    /// to the UI incrementally instead of waiting for the whole fetch to
    /// finish. The channel is purely a progress feed: its receiver going
    /// away (e.g. the caller stopped listening) does not affect the fetch,
    /// which still runs to completion and returns the full result.
    async fn fetch_messages(
        &self,
        connection: &Connection,
        topic: &str,
        filter: &MessageFilter,
        on_message: Option<mpsc::UnboundedSender<TopicMessage>>,
    ) -> Result<Vec<TopicMessage>, AppError>;

    /// Backs the topic detail panel's Partitions tab: id, leader, replicas,
    /// ISR, and low/high offsets for every partition.
    async fn list_partitions(&self, connection: &Connection, topic: &str) -> Result<Vec<PartitionSummary>, AppError>;

    /// Backs the topic detail panel's Config tab, via librdkafka's
    /// DescribeConfigs admin API.
    async fn describe_topic_config(
        &self,
        connection: &Connection,
        topic: &str,
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
#[derive(Clone, Default)]
struct ProbeContext {
    last_error: Arc<Mutex<Option<String>>>,
}

impl ClientContext for ProbeContext {
    fn error(&self, _error: rdkafka::error::KafkaError, reason: &str) {
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = Some(reason.to_string());
        }
    }
}

impl ConsumerContext for ProbeContext {}

async fn run_probe(config: ClientConfig) -> Result<ConnectionStatus, AppError> {
    tokio::task::spawn_blocking(move || {
        let context = ProbeContext::default();
        let consumer: BaseConsumer<ProbeContext> = match config.create_with_context(context.clone()) {
            Ok(consumer) => consumer,
            Err(create_err) => {
                // `create_err.to_string()` carries librdkafka's actual reason
                // (e.g. "Invalid sasl.username: not set") — attaching only
                // the generic "failed to create kafka consumer" string here
                // (the previous behavior) meant that specific reason never
                // reached the user, no matter how informative it was.
                let message = create_err.to_string();
                return Err(error_stack::Report::new(AppError::Kafka).attach_printable(message));
            }
        };

        match consumer.fetch_metadata(None, Duration::from_secs(3)) {
            Ok(_) => Ok(ConnectionStatus::Reachable),
            Err(fetch_err) => {
                let reason = context
                    .last_error
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone())
                    .unwrap_or_else(|| fetch_err.to_string());
                Err(error_stack::Report::new(AppError::Kafka).attach_printable(reason))
            }
        }
    })
    .await
    .change_context(AppError::Kafka)
    .attach_printable("status check task panicked")?
}

pub struct RdKafkaClient;

#[async_trait]
impl KafkaClient for RdKafkaClient {
    async fn check_status(&self, connection: &Connection) -> Result<ConnectionStatus, AppError> {
        self.ping_bootstrap(&connection.bootstrap_servers).await
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

    async fn list_brokers(&self, connection: &Connection) -> Result<Vec<BrokerSummary>, AppError> {
        let config = client_config(connection);
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let metadata = consumer
                .fetch_metadata(None, METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable("failed to fetch broker metadata")?;

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

    async fn list_topics(&self, connection: &Connection) -> Result<Vec<TopicSummary>, AppError> {
        let config = client_config(connection);
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let metadata = consumer
                .fetch_metadata(None, METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable("failed to fetch topic metadata")?;

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

    async fn list_consumer_groups(&self, connection: &Connection) -> Result<Vec<ConsumerGroupSummary>, AppError> {
        let config = client_config(connection);
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let groups = consumer
                .fetch_group_list(None, METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable("failed to fetch consumer group list")?;

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

    async fn count_topic_messages(&self, connection: &Connection, topic: &str) -> Result<u64, AppError> {
        let config = client_config(connection);
        let topic = topic.to_string();
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let metadata = consumer.fetch_metadata(Some(&topic), METADATA_TIMEOUT).map_err(|err| {
                // `.change_context(AppError::Kafka)` alone would demote this
                // `KafkaError` to a non-`Printable` context frame that
                // `format_report` (src-tauri/src/commands/connections.rs)
                // never surfaces to the user — capturing `.to_string()`
                // explicitly is the only way the real reason (e.g. "Local:
                // Broker transport failure", "Local: Timed out") reaches
                // them instead of just the generic wrapper text below.
                let reason = err.to_string();
                error_stack::Report::new(AppError::Kafka)
                    .attach_printable(format!("failed to fetch metadata for topic {topic}: {reason}"))
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
                    .fetch_watermarks(&topic, partition.id(), METADATA_TIMEOUT)
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
    ) -> Result<Vec<TopicMessage>, AppError> {
        let mut config = client_config(connection);
        config.set("group.id", "kafkaoxide-message-browser");
        config.set("enable.auto.commit", "false");
        let topic = topic.to_string();
        let filter = filter.clone();

        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;

            let metadata = consumer.fetch_metadata(Some(&topic), METADATA_TIMEOUT).map_err(|err| {
                // `.change_context(AppError::Kafka)` alone would demote this
                // `KafkaError` to a non-`Printable` context frame that
                // `format_report` (src-tauri/src/commands/connections.rs)
                // never surfaces to the user — capturing `.to_string()`
                // explicitly is the only way the real reason (e.g. "Local:
                // Broker transport failure", "Local: Timed out") reaches
                // them instead of just the generic wrapper text below.
                let reason = err.to_string();
                error_stack::Report::new(AppError::Kafka)
                    .attach_printable(format!("failed to fetch metadata for topic {topic}: {reason}"))
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

            let watermarks = |partition: i32| -> Result<(i64, i64), AppError> {
                consumer
                    .fetch_watermarks(&topic, partition, METADATA_TIMEOUT)
                    .change_context(AppError::Kafka)
                    .attach_printable_lazy(|| format!("failed to fetch watermarks for {topic}:{partition}"))
            };

            let start_offsets: BTreeMap<i32, i64> = if let Some(offset) = filter.offset {
                target_partitions
                    .iter()
                    .map(|&p| watermarks(p).map(|(low, high)| (p, clamp_offset(offset, low, high))))
                    .collect::<Result<_, _>>()?
            } else if let Some(from_ms) = filter.from_timestamp_ms {
                resolve_offsets_by_timestamp(&consumer, &topic, &target_partitions, from_ms, |p| {
                    watermarks(p).map(|(low, _)| low)
                })?
            } else {
                let cap = i64::from(effective_max_messages_per_partition(filter.max_messages_per_partition));
                target_partitions
                    .iter()
                    .map(|&p| watermarks(p).map(|(low, high)| (p, newest_first_start_offset(low, high, cap))))
                    .collect::<Result<_, _>>()?
            };

            let end_offsets: BTreeMap<i32, i64> = if let Some(to_ms) = filter.to_timestamp_ms {
                resolve_offsets_by_timestamp(&consumer, &topic, &target_partitions, to_ms, |p| {
                    watermarks(p).map(|(_, high)| high)
                })?
            } else {
                target_partitions
                    .iter()
                    .map(|&p| watermarks(p).map(|(_, high)| (p, high)))
                    .collect::<Result<_, _>>()?
            };

            // `partition_limits` treats `None` as "uncapped" — correct for
            // it as a generic utility, but wrong for this caller: an
            // offset- or timestamp-filtered fetch with no explicit count
            // set must still fall back to a sane per-partition cap (the
            // unfiltered/newest-first branch above already gets this via
            // `effective_max_messages_per_partition`, since its start
            // offset is derived from the same cap — this is that same
            // fallback applied for every other branch too, or an explicit
            // offset/timestamp filter would try to pull every message from
            // its start point to the end of the partition).
            let limits = partition_limits(
                &start_offsets,
                &end_offsets,
                Some(effective_max_messages_per_partition(filter.max_messages_per_partition)),
            );
            let limits = apply_total_cap(&limits, filter.max_total_messages);

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
                    Some(Err(_)) | None => {
                        idle_elapsed += POLL_TIMEOUT;
                    }
                }
            }

            Ok(collected)
        })
        .await
        .change_context(AppError::Kafka)
        .attach_printable("fetch_messages task panicked")?
    }

    async fn list_partitions(&self, connection: &Connection, topic: &str) -> Result<Vec<PartitionSummary>, AppError> {
        let config = client_config(connection);
        let topic = topic.to_string();
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let metadata = consumer.fetch_metadata(Some(&topic), METADATA_TIMEOUT).map_err(|err| {
                // `.change_context(AppError::Kafka)` alone would demote this
                // `KafkaError` to a non-`Printable` context frame that
                // `format_report` (src-tauri/src/commands/connections.rs)
                // never surfaces to the user — capturing `.to_string()`
                // explicitly is the only way the real reason (e.g. "Local:
                // Broker transport failure", "Local: Timed out") reaches
                // them instead of just the generic wrapper text below.
                let reason = err.to_string();
                error_stack::Report::new(AppError::Kafka)
                    .attach_printable(format!("failed to fetch metadata for topic {topic}: {reason}"))
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
                        .fetch_watermarks(&topic, partition.id(), METADATA_TIMEOUT)
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

    async fn describe_topic_config(&self, connection: &Connection, topic: &str) -> Result<Vec<ConfigEntry>, AppError> {
        let config = client_config(connection);
        let admin: AdminClient<DefaultClientContext> = config
            .create()
            .change_context(AppError::Kafka)
            .attach_printable("failed to create kafka admin client")?;

        let specifier = ResourceSpecifier::Topic(topic);
        let options = AdminOptions::new().request_timeout(Some(METADATA_TIMEOUT));
        let results = admin
            .describe_configs([&specifier], &options)
            .await
            .change_context(AppError::Kafka)
            .attach_printable_lazy(|| format!("failed to describe config for topic {topic}"))?;

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
    ) -> Result<ConsumerGroupLag, AppError> {
        let config = client_config(connection);
        let mut group_config = client_config(connection);
        let group_id = group_id.to_string();
        tokio::task::spawn_blocking(move || {
            let consumer: BaseConsumer = config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create kafka consumer")?;
            let groups = consumer
                .fetch_group_list(Some(&group_id), METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable_lazy(|| format!("failed to fetch group list for {group_id}"))?;
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
            let group_consumer: BaseConsumer = group_config
                .create()
                .change_context(AppError::Kafka)
                .attach_printable("failed to create group-scoped kafka consumer")?;
            let committed = group_consumer
                .committed_offsets(tpl, METADATA_TIMEOUT)
                .change_context(AppError::Kafka)
                .attach_printable_lazy(|| format!("failed to fetch committed offsets for {group_id}"))?;

            let mut partitions = Vec::new();
            for element in committed.elements() {
                let topic = element.topic().to_string();
                let partition = element.partition();
                let current_offset = element.offset().to_raw().filter(|&o| o >= 0);

                let (_low, high) = consumer
                    .fetch_watermarks(&topic, partition, METADATA_TIMEOUT)
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

/// Resolves each target partition's offset at `timestamp_ms` via
/// `offsets_for_times`, falling back to `fallback` (a watermark lookup) for
/// any partition librdkafka couldn't resolve to a concrete offset (e.g. the
/// timestamp is after every message in the partition).
fn resolve_offsets_by_timestamp(
    consumer: &BaseConsumer,
    topic: &str,
    partitions: &[i32],
    timestamp_ms: i64,
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
        .offsets_for_times(request, METADATA_TIMEOUT)
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
        let client = RdKafkaClient;
        let status = client.check_status(&sample_connection()).await.unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    #[tokio::test]
    async fn ping_bootstrap_reports_unreachable_for_a_closed_port() {
        let client = RdKafkaClient;
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

        let client = RdKafkaClient;
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

        let client = RdKafkaClient;
        // First entry (port 1) is closed; second is the live listener above.
        let status = client
            .ping_bootstrap(&format!("127.0.0.1:1,127.0.0.1:{port}"))
            .await
            .unwrap();
        assert_eq!(status, ConnectionStatus::Reachable);
    }

    #[tokio::test]
    async fn ping_bootstrap_reports_unreachable_for_an_unresolvable_host() {
        let client = RdKafkaClient;
        let status = client
            .ping_bootstrap("this-host-does-not-resolve.invalid:9092")
            .await
            .unwrap();
        assert_eq!(status, ConnectionStatus::Unreachable);
    }

    #[tokio::test]
    async fn test_connection_reports_a_real_error_for_a_closed_port() {
        let client = RdKafkaClient;
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
        let client = RdKafkaClient;
        let result = client.list_brokers(&sample_connection()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_topics_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client.list_topics(&sample_connection()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_consumer_groups_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client.list_consumer_groups(&sample_connection()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn count_topic_messages_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client
            .count_topic_messages(&sample_connection(), "orders")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_messages_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), None)
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
        let client = RdKafkaClient;
        let report = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), None)
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
        let client = RdKafkaClient;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let result = client
            .fetch_messages(&sample_connection(), "orders", &MessageFilter::default(), Some(tx))
            .await;
        assert!(result.is_err());
        assert!(rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn list_partitions_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client.list_partitions(&sample_connection(), "orders").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn describe_topic_config_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client.describe_topic_config(&sample_connection(), "orders").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_consumer_group_lag_errors_for_a_closed_port() {
        let client = RdKafkaClient;
        let result = client
            .fetch_consumer_group_lag(&sample_connection(), "billing-service")
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
        let client = RdKafkaClient;
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
        let client = RdKafkaClient;
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

