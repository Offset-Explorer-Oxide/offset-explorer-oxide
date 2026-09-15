import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../src/features/theme/ThemeProvider";
import { PartitionDetailPanel } from "../src/features/connections/PartitionDetailPanel";
import { useTabsStore } from "../src/features/tabs/useTabsStore";
import "../src/styles/themes.css";
import "../src/styles/global.css";

/**
 * Standalone harness for the partition Publish tab.
 *
 * `src-tauri` cannot be built in every environment (it needs a desktop
 * toolchain), so this renders the real `PartitionDetailPanel` against the
 * `@tauri-apps/api` stubs in this folder — enough to drive the publish flow in a
 * browser and see what a user sees. The stubbed backend is scripted from the
 * test, which pokes `window.__handlers`.
 *
 * Must stay wrapped in `ThemeProvider`: `themes.css` scopes every `--color-*`
 * var to `:root[data-theme=…]`, so without it the whole panel renders unstyled.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

useTabsStore.setState({
  tabs: [{ id: "tab-1", name: "Tab 1", position: 0 }] as never,
  activeTabId: "tab-1",
});

function Harness() {
  const [partition, setPartition] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div>
        <button data-testid="partition-toggle" onClick={() => setPartition((p) => (p === 0 ? 2 : 0))}>
          partition: {partition}
        </button>
      </div>
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <PartitionDetailPanel connectionId="conn-1" topicName="orders" partitionId={partition} />
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
