import { useState } from "react";
import { ConfigTab } from "./ConfigTab";
import { DataTab } from "./DataTab";
import { PartitionsTab } from "./PartitionsTab";
import { TopicPropertiesTab } from "./TopicPropertiesTab";
import { TopicSchemaTab } from "./TopicSchemaTab";

export interface TopicDetailPanelProps {
  connectionId: string;
  topicName: string;
}

type TopicTabId = "properties" | "data" | "partitions" | "config" | "schema";

const TOPIC_TABS: { id: TopicTabId; label: string }[] = [
  { id: "properties", label: "Properties" },
  { id: "data", label: "Data" },
  { id: "partitions", label: "Partitions" },
  { id: "config", label: "Config" },
  { id: "schema", label: "Schema" },
];

export function TopicDetailPanel({ connectionId, topicName }: TopicDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TopicTabId>("data");

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header">
        <h2>{topicName}</h2>
      </header>

      <div className="connection-modal-tabs" role="tablist">
        {TOPIC_TABS.map((tab) => (
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
          <TopicPropertiesTab connectionId={connectionId} topicName={topicName} />
        )}
        {activeTab === "data" && <DataTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "partitions" && <PartitionsTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "config" && <ConfigTab connectionId={connectionId} topicName={topicName} />}
        {activeTab === "schema" && <TopicSchemaTab connectionId={connectionId} topicName={topicName} />}
      </div>
    </div>
  );
}
