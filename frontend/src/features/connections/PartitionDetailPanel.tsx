import { useState } from "react";
import { DataTab } from "./DataTab";
import { PartitionPropertiesTab } from "./PartitionPropertiesTab";
import { PartitionReplicasTab } from "./PartitionReplicasTab";

export interface PartitionDetailPanelProps {
  connectionId: string;
  topicName: string;
  partitionId: number;
}

type PartitionTabId = "properties" | "data" | "replicas";

const PARTITION_TABS: { id: PartitionTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "data", label: "Data" },
  { id: "replicas", label: "Replicas" },
];

export function PartitionDetailPanel({ connectionId, topicName, partitionId }: PartitionDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<PartitionTabId>("data");

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
            onClick={() => setActiveTab(tab.id)}
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
      </div>
    </div>
  );
}
