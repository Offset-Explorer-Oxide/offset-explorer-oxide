import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../src/App";
import { useTabDataStore } from "../src/features/workspace/useTabDataStore";
import { useDataTabGridStateStore } from "../src/features/connections/useDataTabGridStateStore";
import { useDataTabFiltersStore } from "../src/features/connections/useDataTabFiltersStore";
import { useTabsStore } from "../src/features/tabs/useTabsStore";
import { useMessageViewerStore } from "../src/features/workspace/useMessageViewerStore";

const conn = {
  id: "conn-1",
  name: "local",
  bootstrapServers: "localhost:9092",
  kafkaVersion: "3.7",
  zookeeperEnabled: false,
  zookeeperHost: null, zookeeperPort: null, zookeeperChrootPath: null,
  securityProtocol: "PLAINTEXT",
  saslMechanism: null, saslUsername: null, saslPassword: null, saslOauthUrl: null,
  schemaRegistryEndpoint: null, schemaRegistryBasicAuthCredentials: null,
  schemaRegistryTrustStoreLocation: null, schemaRegistryTrustStorePassword: null,
  schemaRegistryKeystoreLocation: null, schemaRegistryKeystorePassword: null,
  schemaRegistryKeystoreKeyPassword: null,
  sslTruststoreLocation: null, sslTruststorePassword: null,
  sslKeystoreLocation: null, sslKeystorePassword: null, sslKeystoreKeyPassword: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

const tabs = [
  { id: "tab-1", name: "Tab 1", position: 0 },
  { id: "tab-2", name: "Tab 2", position: 1 },
];

const w = window as never as {
  __handlers: Record<string, (a: Record<string, unknown>) => unknown>;
  __emit: (e: string, p: unknown) => void;
  __fetchLog: unknown[];
};
w.__fetchLog = [];
(window as never as { __stores: () => unknown }).__stores = () => {
  const d = useTabDataStore.getState();
  return {
    activeTabId: useTabsStore.getState().activeTabId,
    rows: Object.fromEntries(Object.entries(d.messagesByTab).map(([k, v]) => [k, v.length])),
    payloadBytes: d.payloadBytesByTab,
    totalMatching: d.totalMatchingByTab,
    gridState: useDataTabGridStateStore.getState().stateByTab,
    forms: Object.fromEntries(Object.entries(useDataTabFiltersStore.getState().formByTab).map(([k, v]) => [k, v.includePayload])),
    viewer: { active: useMessageViewerStore.getState().activeTabId, byTab: Object.fromEntries(Object.entries(useMessageViewerStore.getState().byTab).map(([k, v]) => [k, v ? v.partitionId + "|" + v.topic + "|" + v.message.partition + ":" + v.message.offset : null])) },
    fetchLog: (window as never as { __fetchLog: unknown[] }).__fetchLog,
  };
};

const PAYLOAD_B64 = "QQ".repeat(2000); // 4000 chars ~ 3KB decoded

Object.assign(w.__handlers, {
  connection_list: () => [conn],
  connection_check_status: () => "REACHABLE",
  connection_is_connected: () => true,
  connection_connect: () => null,
  connection_disconnect: () => null,
  connection_auth_block_reason: () => null,
  tab_list: () => tabs,
  tab_create: (a: Record<string, unknown>) => ({ id: "tab-new", name: a.name, position: 9 }),
  tab_delete: () => null,
  tab_rename: () => null,
  tab_reorder: () => null,
  trim_process_memory: () => null,
  connection_list_topics: () => [
    { name: "orders", partitionCount: 2 },
    { name: "payments", partitionCount: 2 },
  ],
  connection_list_brokers: () => [{ id: 1, host: "localhost", port: 9092 }],
  connection_list_consumer_groups: () => [],
  connection_list_partitions: () => [
    { id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 100 },
    { id: 1, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 100 },
  ],
  connection_count_topic_messages: () => 200,
  connection_describe_topic_config: () => [],
  topic_schema_get: () => null,
  connection_fetch_messages: async (a: Record<string, unknown>) => {
    const filter = a.filter as { includePayload: boolean };
    const requestId = a.requestId as string;
    w.__fetchLog.push({ topic: a.topic, includePayload: filter.includePayload, requestId });
    const messages = [];
    for (let i = 0; i < 200; i++) {
      messages.push({
        partition: i % 2,
        offset: 1000 + i,
        timestampMs: 1700000000000 + i * 1000,
        keyBase64: btoa("key-" + i),
        payloadBase64: filter.includePayload ? PAYLOAD_B64 : null,
        payloadSizeBytes: 30000,
        headers: [],
      });
    }
    for (const m of messages) w.__emit("messages-batch", { requestId, message: m });
    await new Promise((r) => setTimeout(r, 400));
    return { messages, totalMatching: 200, payloadBytesRead: filter.includePayload ? 200 * 3000 : 0 };
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
