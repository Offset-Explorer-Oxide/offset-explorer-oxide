import { BrokerSummary, ConsumerGroupSummary } from "../../lib/tauri";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { ResourceCategory } from "./ResourceCategory";
import { TopicCategory } from "./TopicCategory";
import { useBrokers, useConsumerGroups, useTopics } from "./useClusterResources";

export interface ClusterResourceTreeProps {
  connectionId: string;
}

function noop() {}

/**
 * The three searchable sub-lists shown once a cluster is connected. Data is
 * fetched eagerly as soon as this mounts (i.e. as soon as the cluster is
 * connected — the parent ConnectionTree mounts this before the tree row is
 * ever expanded, only hiding it visually via CSS), so expanding a category
 * is instant instead of showing a spinner.
 */
export function ClusterResourceTree({ connectionId }: ClusterResourceTreeProps) {
  const brokers = useBrokers(connectionId, true);
  const topics = useTopics(connectionId, true);
  const groups = useConsumerGroups(connectionId, true);

  const selection = useWorkspaceSelectionStore((s) => s.selection);
  const selectBroker = useWorkspaceSelectionStore((s) => s.selectBroker);
  const selectTopic = useWorkspaceSelectionStore((s) => s.selectTopic);
  const selectConsumerGroup = useWorkspaceSelectionStore((s) => s.selectConsumerGroup);

  return (
    <ul className="resource-tree" data-testid={`resource-tree-${connectionId}`}>
      <ResourceCategory<BrokerSummary>
        label="Brokers"
        items={brokers.data}
        isLoading={brokers.isLoading}
        onExpand={noop}
        getKey={(broker) => String(broker.id)}
        getLabel={(broker) => `${broker.id} — ${broker.host}:${broker.port}`}
        matchesSearch={(broker, query) =>
          `${broker.id} ${broker.host}`.toLowerCase().includes(query.toLowerCase())
        }
        isSelected={(broker) =>
          selection?.type === "broker" &&
          selection.connectionId === connectionId &&
          selection.brokerId === broker.id
        }
        onSelect={(broker) => selectBroker(connectionId, broker.id)}
      />
      <TopicCategory
        connectionId={connectionId}
        topics={topics.data}
        isLoading={topics.isLoading}
        onExpand={noop}
        isSelected={(topic) =>
          selection?.type === "topic" &&
          selection.connectionId === connectionId &&
          selection.topicName === topic.name
        }
        onSelect={(topic) => selectTopic(connectionId, topic.name)}
      />
      <ResourceCategory<ConsumerGroupSummary>
        label="Consumers"
        items={groups.data}
        isLoading={groups.isLoading}
        onExpand={noop}
        getKey={(group) => group.groupId}
        getLabel={(group) => group.groupId}
        matchesSearch={(group, query) => group.groupId.toLowerCase().includes(query.toLowerCase())}
        isSelected={(group) =>
          selection?.type === "consumerGroup" &&
          selection.connectionId === connectionId &&
          selection.groupId === group.groupId
        }
        onSelect={(group) => selectConsumerGroup(connectionId, group.groupId)}
      />
    </ul>
  );
}
