import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { TabBar } from "./features/tabs/TabBar";
import { useTabsStore } from "./features/tabs/useTabsStore";
import { useJsonViewerTabsStore } from "./features/tabs/useJsonViewerTabsStore";
import { JsonViewerTabPanel } from "./features/tabs/JsonViewerTabPanel";
import { ConnectionTree } from "./features/connections/ConnectionTree";
import { ConnectionModal } from "./features/connections/modal/ConnectionModal";
import { ConnectionDraft, connectionToDraft } from "./features/connections/modal/draft";
import { Connection } from "./lib/tauri";
import { ClusterDetailPanel } from "./features/connections/ClusterDetailPanel";
import { BrokerDetailPanel } from "./features/connections/BrokerDetailPanel";
import { TopicDetailPanel } from "./features/connections/TopicDetailPanel";
import { PartitionDetailPanel } from "./features/connections/PartitionDetailPanel";
import { MessagePayloadViewer } from "./features/connections/MessagePayloadViewer";
import { ConsumerGroupDetailPanel } from "./features/connections/ConsumerGroupDetailPanel";
import { useCreateConnection, useExportConnections, useImportConnections } from "./features/connections/useConnections";
import { BottomPanel } from "./features/bottom-panel/BottomPanel";
import { ResizableShell } from "./features/layout/ResizableShell";
import { useWorkspaceSelectionStore } from "./features/workspace/useWorkspaceSelectionStore";
import { PreferencesProvider } from "./features/settings/PreferencesProvider";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { useSettingsPanelStore } from "./features/settings/useSettingsPanelStore";
import { useMessageViewerStore } from "./features/workspace/useMessageViewerStore";
import "./styles/themes.css";
import "./styles/global.css";

const queryClient = new QueryClient();

function AppShell() {
  const [showModal, setShowModal] = useState(false);
  const [cloneDraft, setCloneDraft] = useState<ConnectionDraft | null>(null);
  const createConnection = useCreateConnection();
  const exportConnections = useExportConnections();
  const importConnections = useImportConnections();

  function handleClone(connection: Connection) {
    setCloneDraft({ ...connectionToDraft(connection), name: `${connection.name} (Copy)` });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setCloneDraft(null);
  }

  async function handleExportAll() {
    const path = await save({
      defaultPath: "kafkaoxide-connections.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path) {
      exportConnections.mutate({ ids: null, path });
    }
  }

  async function handleImport() {
    const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
    if (path) {
      const { imported, skipped } = await importConnections.mutateAsync(path);
      window.alert(`Imported ${imported} connection${imported === 1 ? "" : "s"}, skipped ${skipped}.`);
    }
  }
  const loadTabs = useTabsStore((s) => s.loadTabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activeJsonTab = useJsonViewerTabsStore((s) => s.tabs.find((tab) => tab.id === activeTabId));
  const selection = useWorkspaceSelectionStore((s) => s.selection);
  const setSelectionActiveTab = useWorkspaceSelectionStore((s) => s.setActiveTab);
  const settingsOpen = useSettingsPanelStore((s) => s.isOpen);
  const openSettings = useSettingsPanelStore((s) => s.open);
  const hasSelectedMessage = useMessageViewerStore((s) => s.message !== null);
  const setMessageViewerActiveTab = useMessageViewerStore((s) => s.setActiveTab);

  useEffect(() => {
    loadTabs();
  }, [loadTabs]);

  // Each tab keeps its own workspace selection/message-viewer state — the
  // global connection list (which clusters exist/are connected) still comes
  // straight from the backend and isn't tab-scoped.
  useEffect(() => {
    setSelectionActiveTab(activeTabId);
    setMessageViewerActiveTab(activeTabId);
  }, [activeTabId, setSelectionActiveTab, setMessageViewerActiveTab]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <TabBar />
        <button type="button" aria-label="Open settings" className="settings-gear" onClick={openSettings}>
          ⚙
        </button>
      </header>
      <div className="app-body">
        <ResizableShell
          left={
            <aside className="app-sidebar">
              <div className="app-sidebar-actions">
                <button type="button" onClick={() => setShowModal(true)}>
                  + Add Cluster
                </button>
                <button type="button" onClick={handleExportAll}>
                  Export All
                </button>
                <button type="button" onClick={handleImport}>
                  Import
                </button>
              </div>
              {showModal && (
                <ConnectionModal
                  initialDraft={cloneDraft ?? undefined}
                  onAdd={async (connection) => {
                    await createConnection.mutateAsync(connection);
                    closeModal();
                  }}
                  onCancel={closeModal}
                />
              )}
              <ConnectionTree onClone={handleClone} />
            </aside>
          }
          leftHidden={Boolean(activeJsonTab) && !settingsOpen}
          middle={
            settingsOpen ? (
              <main className="app-main">
                <SettingsPanel />
              </main>
            ) : (
              <main className="app-main" key={activeTabId ?? "no-tab"}>
                {activeJsonTab ? (
                  <JsonViewerTabPanel tab={activeJsonTab} />
                ) : (
                  <>
                    {selection?.type === "connection" && <ClusterDetailPanel connectionId={selection.id} />}
                    {selection?.type === "broker" && (
                      <BrokerDetailPanel connectionId={selection.connectionId} brokerId={selection.brokerId} />
                    )}
                    {selection?.type === "topic" && (
                      <TopicDetailPanel connectionId={selection.connectionId} topicName={selection.topicName} />
                    )}
                    {selection?.type === "partition" && (
                      <PartitionDetailPanel
                        connectionId={selection.connectionId}
                        topicName={selection.topicName}
                        partitionId={selection.partitionId}
                      />
                    )}
                    {selection?.type === "consumerGroup" && (
                      <ConsumerGroupDetailPanel connectionId={selection.connectionId} groupId={selection.groupId} />
                    )}
                    {!selection && <p className="app-main-placeholder">Select a cluster, broker, or topic.</p>}
                  </>
                )}
              </main>
            )
          }
          right={hasSelectedMessage ? <MessagePayloadViewer key={activeTabId ?? "no-tab"} /> : undefined}
        />
      </div>
      <BottomPanel />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PreferencesProvider>
          <AppShell />
        </PreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
