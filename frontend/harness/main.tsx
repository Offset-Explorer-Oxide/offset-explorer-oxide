import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../src/features/theme/ThemeProvider";
import { DataTab } from "../src/features/connections/DataTab";
import { BottomPanel } from "../src/features/bottom-panel/BottomPanel";
import { useTabsStore } from "../src/features/tabs/useTabsStore";
import { useMessageViewerStore } from "../src/features/workspace/useMessageViewerStore";
import "../src/styles/themes.css";
import "../src/styles/global.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

useTabsStore.setState({
  tabs: [
    { id: "tab-1", name: "Tab 1", position: 0 },
    { id: "tab-2", name: "Tab 2", position: 1 },
  ] as never,
  activeTabId: "tab-1",
});
useMessageViewerStore.getState().setActiveTab("tab-1");

function Harness() {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const [topic, setTopic] = useState("orders");
  const [sub, setSub] = useState("data");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div>
        {tabs.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => {
              useTabsStore.setState({ activeTabId: t.id });
              useMessageViewerStore.getState().setActiveTab(t.id);
            }}
            style={{ fontWeight: activeTabId === t.id ? "bold" : "normal" }}
          >
            {t.name}
          </button>
        ))}
        <button data-testid="sub-toggle" onClick={() => setSub((s) => (s === "data" ? "props" : "data"))}>
          sub: {sub}
        </button>
        <button data-testid="topic-toggle" onClick={() => setTopic((s) => (s === "orders" ? "payments" : "orders"))}>
          topic: {topic}
        </button>
      </div>
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} key={activeTabId ?? "no-tab"}>
        {sub === "data" ? <DataTab connectionId="conn-1" topicName={topic} /> : <div>properties</div>}
      </main>
      <BottomPanel />
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
