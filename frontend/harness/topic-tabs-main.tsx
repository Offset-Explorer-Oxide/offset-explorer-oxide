import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopicDetailPanel } from "../src/features/connections/TopicDetailPanel";
import { ThemeProvider } from "../src/features/theme/ThemeProvider";
import "../src/styles/themes.css";
import "../src/styles/global.css";

const handlers = (window as unknown as { __handlers: Record<string, unknown> }).__handlers;
handlers.connection_list_partitions = () => [
  { partition: 0, leader: 1, replicas: [1, 2], inSyncReplicas: [1, 2], earliestOffset: 0, latestOffset: 120 },
];
handlers.connection_count_topic_messages = () => 120;
handlers.topic_schema_get = () => null;
handlers.connection_describe_topic_config = () => [
  { name: "cleanup.policy", value: "delete" },
  { name: "retention.ms", value: "604800000" },
  { name: "min.insync.replicas", value: "2" },
  { name: "compression.type", value: null },
];
handlers.connection_fetch_messages = () => ({ messages: [], totalMatching: 0, bytesFetched: 0 });

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
          <TopicDetailPanel connectionId="1" topicName="orders" />
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
