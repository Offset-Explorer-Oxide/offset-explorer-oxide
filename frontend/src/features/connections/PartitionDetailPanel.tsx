import { PartitionPropertiesTab } from "./PartitionPropertiesTab";
import { PublishTab } from "./PublishTab";
import { PartitionTabId, usePartitionPanelTabStore } from "./usePartitionPanelTabStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { DataTab, PartitionReplicasTab } from "./gridTabs";

export interface PartitionDetailPanelProps {
  connectionId: string;
  topicName: string;
  partitionId: number;
}

/**
 * Publish comes last, deliberately. It is the only tab here that writes to the
 * cluster, and putting it at the far end keeps it away from Data — the tab this
 * panel opens on, and so the one a misplaced click lands near.
 */
const PARTITION_TABS: { id: PartitionTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "data", label: "Data" },
  { id: "replicas", label: "Replicas" },
  { id: "publish", label: "Publish" },
];

export function PartitionDetailPanel({ connectionId, topicName, partitionId }: PartitionDetailPanelProps) {
  // Held per top-level tab rather than in local state, so the tree's right-click
  // "Publish messages…" can open this panel straight onto its Publish tab, and
  // so selecting another partition does not silently reset the choice.
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activeTab = usePartitionPanelTabStore((s) => s.activeByTab[activeTabId ?? "no-tab"] ?? "data");
  const setActiveTab = usePartitionPanelTabStore((s) => s.set);

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header">
        <h2>
          {topicName} · Partition {partitionId}
        </h2>
      </header>

      <div className="connection-modal-tabs" role="tablist">
        {PARTITION_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`connection-modal-tab${activeTab === tab.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => setActiveTab(activeTabId, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="connection-modal-body">
        {activeTab === "properties" && (
          <PartitionPropertiesTab connectionId={connectionId} topicName={topicName} partitionId={partitionId} />
        )}
        {activeTab === "data" && (
          <DataTab connectionId={connectionId} topicName={topicName} partitionId={partitionId} />
        )}
        {activeTab === "replicas" && (
          <PartitionReplicasTab connectionId={connectionId} topicName={topicName} partitionId={partitionId} />
        )}
        {activeTab === "publish" && (
          <PublishTab connectionId={connectionId} topicName={topicName} partitionId={partitionId} />
        )}
      </div>
    </div>
  );
}
