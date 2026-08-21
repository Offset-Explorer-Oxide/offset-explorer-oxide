import { invoke as tauriInvoke } from "@tauri-apps/api/core";

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
}

export interface MessageHeader {
  key: string;
  value: string | null;
}

export interface TopicMessage {
  partition: number;
  offset: number;
  timestampMs: number | null;
  key: string | null;
  /** null unless the fetch's `includePayload` filter was set. */
  payloadBase64: string | null;
  /** Always populated regardless of `includePayload` — headers are cheap metadata, not the payload itself. */
  headers: MessageHeader[];
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
    invoke<ConnectionStatus>("connection_ping_zookeeper", { host, port }),
  testConnection: (newConnection: NewConnection) =>
    invoke<ConnectionStatus>("connection_test", { newConnection }),
  connectConnection: (id: string) => invoke<ConnectionStatus>("connection_connect", { id }),
  disconnectConnection: (id: string) => invoke<void>("connection_disconnect", { id }),
  isConnectionConnected: (id: string) => invoke<boolean>("connection_is_connected", { id }),
  listBrokers: (id: string) => invoke<BrokerSummary[]>("connection_list_brokers", { id }),
  listTopics: (id: string) => invoke<TopicSummary[]>("connection_list_topics", { id }),
  listConsumerGroups: (id: string) =>
    invoke<ConsumerGroupSummary[]>("connection_list_consumer_groups", { id }),
  countTopicMessages: (id: string, topic: string) =>
    invoke<number>("connection_count_topic_messages", { id, topic }),
  fetchMessages: (id: string, topic: string, filter: MessageFilter) =>
    invoke<TopicMessage[]>("connection_fetch_messages", { id, topic, filter }),
  listPartitions: (id: string, topic: string) =>
    invoke<PartitionSummary[]>("connection_list_partitions", { id, topic }),
  describeTopicConfig: (id: string, topic: string) =>
    invoke<ConfigEntry[]>("connection_describe_topic_config", { id, topic }),
  fetchConsumerGroupLag: (id: string, groupId: string) =>
    invoke<ConsumerGroupLag>("connection_fetch_consumer_group_lag", { id, groupId }),
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
};
