import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useGeneralSettingsStore } from "../features/settings/useGeneralSettingsStore";

/**
 * Tauri's `invoke` rejects with whatever the Rust command's `Err` payload
 * deserializes to — for this app's `CommandError { message: String }`,
 * that's a plain object `{ message: "..." }`, not a JS `Error` instance.
 * Every catch block across this app that checks `err instanceof Error` (to
 * show the real backend error message instead of a generic fallback) was
 * silently failing that check and falling back to the generic text, no
 * matter how informative the actual Rust-side error was. Normalizing once
 * here means every `invoke<T>(...)` call below keeps its existing call
 * signature, and every caller's `instanceof Error` check now actually works.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (err) {
    if (err instanceof Error) throw err;
    const message =
      typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
    throw new Error(message);
  }
}

export type SecurityProtocol = "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
export type SaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
export type ConnectionStatus = "UNKNOWN" | "REACHABLE" | "UNREACHABLE";

/** Values for the General section's "Kafka cluster version" dropdown. */
export const KAFKA_VERSIONS = [
  "0.11",
  "1.0",
  "1.1",
  "2.0",
  "2.1",
  "2.2",
  "2.3",
  "2.4",
  "2.5",
  "2.6",
  "2.7",
  "2.8",
  "2.9",
  "3.0",
  "3.1",
  "3.2",
  "3.3",
  "3.4",
  "3.5",
  "3.6",
  "3.7",
] as const;

export type SchemaFormat = "avro" | "protobuf";

export interface Connection {
  id: string;
  name: string;
  bootstrapServers: string;
  kafkaVersion: string;
  zookeeperEnabled: boolean;
  zookeeperHost: string | null;
  zookeeperPort: number | null;
  zookeeperChrootPath: string | null;
  securityProtocol: SecurityProtocol;
  saslMechanism: SaslMechanism | null;
  saslUsername: string | null;
  saslPassword: string | null;
  saslOauthUrl: string | null;
  schemaRegistryEndpoint: string | null;
  schemaRegistryBasicAuthCredentials: string | null;
  schemaRegistryTrustStoreLocation: string | null;
  schemaRegistryTrustStorePassword: string | null;
  schemaRegistryKeystoreLocation: string | null;
  schemaRegistryKeystorePassword: string | null;
  schemaRegistryKeystoreKeyPassword: string | null;
  sslTruststoreLocation: string | null;
  sslTruststorePassword: string | null;
  sslKeystoreLocation: string | null;
  sslKeystorePassword: string | null;
  sslKeystoreKeyPassword: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewConnection {
  name: string;
  bootstrapServers: string;
  kafkaVersion: string;
  zookeeperEnabled: boolean;
  zookeeperHost: string | null;
  zookeeperPort: number | null;
  zookeeperChrootPath: string | null;
  securityProtocol: SecurityProtocol;
  saslMechanism: SaslMechanism | null;
  saslUsername: string | null;
  saslPassword: string | null;
  saslOauthUrl: string | null;
  schemaRegistryEndpoint: string | null;
  schemaRegistryBasicAuthCredentials: string | null;
  schemaRegistryTrustStoreLocation: string | null;
  schemaRegistryTrustStorePassword: string | null;
  schemaRegistryKeystoreLocation: string | null;
  schemaRegistryKeystorePassword: string | null;
  schemaRegistryKeystoreKeyPassword: string | null;
  sslTruststoreLocation: string | null;
  sslTruststorePassword: string | null;
  sslKeystoreLocation: string | null;
  sslKeystorePassword: string | null;
  sslKeystoreKeyPassword: string | null;
}

export interface Tab {
  id: string;
  name: string;
  position: number;
}

export interface BrokerSummary {
  id: number;
  host: string;
  port: number;
}

export interface TopicSummary {
  name: string;
  partitionCount: number;
}

export interface ConsumerGroupSummary {
  groupId: string;
  state: string;
}

export interface PartitionSummary {
  id: number;
  leader: number;
  replicas: number[];
  isr: number[];
  lowOffset: number;
  highOffset: number;
}

export interface ConfigEntry {
  name: string;
  value: string | null;
}

export interface PartitionLag {
  topic: string;
  partition: number;
  currentOffset: number | null;
  logEndOffset: number;
  lag: number | null;
  clientId: string | null;
  clientHost: string | null;
}

export interface ConsumerGroupLag {
  state: string;
  partitions: PartitionLag[];
}

/** All filter fields optional — an all-undefined filter pulls every message. `includePayload` defaults to false (metadata-only). */
export interface MessageFilter {
  partitions: number[] | null;
  maxMessagesPerPartition: number | null;
  maxTotalMessages: number | null;
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  offset: number | null;
  includePayload: boolean;
  /**
   * How many payload bytes to carry back per message; `null` means the whole
   * payload.
   *
   * The Data tab's grid fetch always sets this to `VALUE_PREVIEW_BYTES` — it
   * renders one line per row and searches only that much of a value, so
   * shipping whole payloads for it cost ~4 GB of base64 on a 1,000-row fetch
   * of 3 MB records (once streamed, once in the result) to display a few
   * hundred KB of text, and the webview died holding it. Only the
   * single-message fetch behind the payload viewer passes `null`.
   */
  maxPayloadPreviewBytes: number | null;
}

export interface MessageHeader {
  key: string;
  /** Base64-encoded — a header value is an arbitrary Kafka byte string, not guaranteed text. Decode with `base64ToBytes`/`bytesToText` from `payloadDecoding.ts` to display. */
  valueBase64: string | null;
}

export interface TopicMessage {
  partition: number;
  offset: number;
  timestampMs: number | null;
  /** Base64-encoded — a Kafka message key is an arbitrary byte string, not guaranteed text. Decode with `base64ToBytes`/`bytesToText` from `payloadDecoding.ts` to display. */
  keyBase64: string | null;
  /** null unless the fetch's `includePayload` filter was set, and truncated to its `maxPayloadPreviewBytes` when that was set — use `isPayloadTruncated` before treating this as the whole message. */
  payloadBase64: string | null;
  /** The payload's true size in bytes, however much of it `payloadBase64` carries. Populated whenever the message has a payload, even on a metadata-only fetch. */
  payloadSizeBytes: number | null;
  /** Always populated regardless of `includePayload` — headers are cheap metadata, not the payload itself. */
  headers: MessageHeader[];
}

/** Payload of the `"messages-batch"` event, emitted once per message as `connection_fetch_messages` streams results. `requestId` must be checked against the id passed into that call — a stale fetch (superseded by a newer one, or one the user hit Stop on) keeps emitting until its backend task finishes, so a listener must ignore events for any other request. */
/**
 * A batch of streamed rows from an in-flight fetch.
 *
 * One event carries many messages: it used to carry exactly one, which cost a
 * separate IPC hop and a separate serialization per row for a listener that
 * buffers them and repaints ten times a second anyway.
 */
export interface MessagesBatchEvent {
  requestId: string;
  messages: TopicMessage[];
}

/** `totalMatching` is how many messages satisfy the fetch's partition/offset/timestamp filter in total, uncapped by "max messages per partition"/"total max messages" — `messages.length` can be smaller than this when those caps trimmed the result, telling the Data tab more remain beyond what was actually loaded. */
export interface MessageFetchResult {
  messages: TopicMessage[];
  totalMatching: number;
  pollError?: string | null;
  /** True when the fetch stopped because it had read `maxTotalFetchBytes` of message payloads rather than because it satisfied the filter — the row count alone can't distinguish the two, and on a topic of large messages this is the cap that actually bites. */
  stoppedAtByteBudget?: boolean;
  /** Payload bytes read from the broker during this fetch, before any preview truncation. */
  payloadBytesRead?: number;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
}

export const api = {
  listConnections: () => invoke<Connection[]>("connection_list"),
  createConnection: (newConnection: NewConnection) =>
    invoke<Connection>("connection_create", { newConnection }),
  updateConnection: (id: string, newConnection: NewConnection) =>
    invoke<Connection>("connection_update", { id, newConnection }),
  deleteConnection: (id: string) => invoke<void>("connection_delete", { id }),
  /** `ids: null` exports every connection; a specific list exports just those. */
  exportConnections: (ids: string[] | null, path: string) =>
    invoke<void>("connections_export", { ids, path }),
  importConnections: (path: string) => invoke<ImportSummary>("connections_import", { path }),
  checkConnectionStatus: (id: string) =>
    invoke<ConnectionStatus>("connection_check_status", { id }),
  pingBootstrapServers: (bootstrapServers: string) =>
    invoke<ConnectionStatus>("connection_ping_bootstrap", { bootstrapServers }),
  pingZookeeper: (host: string, port: number) =>
    invoke<ConnectionStatus>("connection_ping_zookeeper", {
      host,
      port,
      timeoutMs: useGeneralSettingsStore.getState().zookeeperTimeoutMs,
    }),
  testConnection: (newConnection: NewConnection) =>
    invoke<ConnectionStatus>("connection_test", { newConnection }),
  connectConnection: (id: string) => invoke<ConnectionStatus>("connection_connect", { id }),
  disconnectConnection: (id: string) => invoke<void>("connection_disconnect", { id }),
  isConnectionConnected: (id: string) => invoke<boolean>("connection_is_connected", { id }),
  /** Why the backend is refusing this connection's requests without dialling the broker, or null if it isn't. */
  connectionAuthBlockReason: (id: string) => invoke<string | null>("connection_auth_block_reason", { id }),
  listBrokers: (id: string) =>
    invoke<BrokerSummary[]>("connection_list_brokers", {
      id,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  listTopics: (id: string) =>
    invoke<TopicSummary[]>("connection_list_topics", {
      id,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  listConsumerGroups: (id: string) =>
    invoke<ConsumerGroupSummary[]>("connection_list_consumer_groups", {
      id,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  countTopicMessages: (id: string, topic: string) =>
    invoke<number>("connection_count_topic_messages", {
      id,
      topic,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  /**
   * `streamUpdates` decides how the messages come back, and every caller has
   * to choose:
   *
   * - `true` — rows arrive as `"messages-batch"` events while the fetch runs,
   *   and `MessageFetchResult.messages` carries only what the stream did not
   *   deliver (normally nothing). For the Data tab's Fetch, which paints rows
   *   as they land; without it every message crossed the IPC boundary twice.
   * - `false` — nothing is streamed and the result carries the messages. For
   *   the single-message fetches, whose events no listener wants.
   */
  fetchMessages: (
    id: string,
    topic: string,
    filter: MessageFilter,
    requestId: string,
    streamUpdates: boolean,
  ) =>
    invoke<MessageFetchResult>("connection_fetch_messages", {
      id,
      topic,
      filter,
      requestId,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
      maxMessageSizeBytes: useGeneralSettingsStore.getState().maxMessageSizeBytes,
      maxTotalPayloadBytes: useGeneralSettingsStore.getState().maxTotalFetchBytes,
      streamUpdates,
    }),
  /** Interrupts a fetch already in flight — the Data tab's Stop button, and switching topics mid-fetch. A no-op if the request already finished. */
  cancelFetch: (requestId: string) => invoke<void>("connection_cancel_fetch", { requestId }),
  listPartitions: (id: string, topic: string) =>
    invoke<PartitionSummary[]>("connection_list_partitions", {
      id,
      topic,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  describeTopicConfig: (id: string, topic: string) =>
    invoke<ConfigEntry[]>("connection_describe_topic_config", {
      id,
      topic,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  fetchConsumerGroupLag: (id: string, groupId: string) =>
    invoke<ConsumerGroupLag>("connection_fetch_consumer_group_lag", {
      id,
      groupId,
      readTimeoutMs: useGeneralSettingsStore.getState().brokerReadTimeoutMs,
    }),
  getTopicSchema: (connectionId: string, topic: string, format: SchemaFormat) =>
    invoke<string | null>("topic_schema_get", { connectionId, topic, format }),
  setTopicSchema: (connectionId: string, topic: string, format: SchemaFormat, schemaText: string) =>
    invoke<void>("topic_schema_set", { connectionId, topic, format, schemaText }),
  deleteTopicSchema: (connectionId: string, topic: string, format: SchemaFormat) =>
    invoke<void>("topic_schema_delete", { connectionId, topic, format }),
  decodeAvro: (connectionId: string, topic: string, payloadBase64: string) =>
    invoke<unknown>("connection_decode_avro", { id: connectionId, topic, payloadBase64 }),
  listTabs: () => invoke<Tab[]>("tab_list"),
  createTab: (name: string) => invoke<Tab>("tab_create", { name }),
  renameTab: (id: string, name: string) => invoke<void>("tab_rename", { id, name }),
  deleteTab: (id: string) => invoke<void>("tab_delete", { id }),
  reorderTabs: (ids: string[]) => invoke<void>("tab_reorder", { ids }),
  /** Trims the OS-visible working set on Windows (a no-op elsewhere) — see `commands::system::trim_process_memory`'s doc comment for why clearing app-level data alone doesn't shrink what Task Manager reports. */
  trimProcessMemory: () => invoke<void>("trim_process_memory"),
};
