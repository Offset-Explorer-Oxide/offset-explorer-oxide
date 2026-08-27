import { MouseEvent as ReactMouseEvent, useRef } from "react";
import { TopicSummary } from "../../lib/tauri";
import { CategoryLoadWarning, CategoryWarningMarker } from "./CategoryLoadWarning";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { usePartitions } from "./useClusterResources";
import { treeKey, useTreeUiStore } from "./useTreeUiStore";

export interface TopicCategoryProps {
  connectionId: string;
  topics: TopicSummary[] | undefined;
  isLoading: boolean;
  /** The topic listing's failure, if it failed — reported on this category rather than as a failure of the whole connection. See `CategoryLoadWarning`. */
  error?: Error | null;
  /** Called exactly once, the first time this category is expanded — triggers the lazy fetch. */
  onExpand: () => void;
  isSelected: (topic: TopicSummary) => boolean;
  onSelect: (topic: TopicSummary) => void;
}

/**
 * The tree's "Topics" sub-list. Unlike Brokers/Consumers (plain
 * ResourceCategory), each topic row can itself expand to lazily fetch and
 * show its partitions, so this gets its own component rather than forcing
 * a per-item-expand concept onto the generic ResourceCategory.
 */
export function TopicCategory({ connectionId, topics, isLoading, error, onExpand, isSelected, onSelect }: TopicCategoryProps) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const key = treeKey(activeTabId, connectionId, "Topics");
  const expanded = useTreeUiStore((s) => s.expanded[key] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const query = useTreeUiStore((s) => s.searchText[key] ?? "");
  const setSearchText = useTreeUiStore((s) => s.setSearchText);
  const hasExpandedBefore = useRef(false);

  function toggle() {
    if (!hasExpandedBefore.current) {
      hasExpandedBefore.current = true;
      onExpand();
    }
    toggleExpanded(key);
  }

  const filtered = (topics ?? []).filter((topic) => topic.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <li className="resource-category">
      <div
        className={`resource-category-header${expanded ? " resource-category-header--expanded" : ""}`}
        data-testid="category-Topics"
        onClick={toggle}
      >
        <span className="tree-caret" aria-hidden="true" />
        Topics
        {error && <CategoryWarningMarker label="Topics" error={error} />}
      </div>
      {expanded && (
        <div className="resource-category-body">
          <input
            className="resource-category-search"
            aria-label="Search Topics"
            placeholder="Search topics…"
            value={query}
            onChange={(e) => setSearchText(key, e.target.value)}
          />
          {error && <CategoryLoadWarning label="Topics" error={error} />}
          {isLoading && <p>Loading…</p>}
          <ul className="resource-item-list">
            {filtered.map((topic) => (
              <TopicRow
                key={topic.name}
                connectionId={connectionId}
                topic={topic}
                isSelected={isSelected(topic)}
                onSelect={() => onSelect(topic)}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

interface TopicRowProps {
  connectionId: string;
  topic: TopicSummary;
  isSelected: boolean;
  onSelect: () => void;
}

function TopicRow({ connectionId, topic, isSelected, onSelect }: TopicRowProps) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const key = treeKey(activeTabId, connectionId, "topic", topic.name);
  const expanded = useTreeUiStore((s) => s.expanded[key] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const partitions = usePartitions(connectionId, topic.name, expanded);
  const selection = useWorkspaceSelectionStore((s) => s.selection);
  const selectPartition = useWorkspaceSelectionStore((s) => s.selectPartition);

  function toggleExpand(e: ReactMouseEvent) {
    e.stopPropagation();
    toggleExpanded(key);
  }

  function isPartitionSelected(partitionId: number) {
    return (
      selection?.type === "partition" &&
      selection.connectionId === connectionId &&
      selection.topicName === topic.name &&
      selection.partitionId === partitionId
    );
  }

  return (
    <li data-testid={`resource-item-${topic.name}`}>
      <div className={`resource-item${isSelected ? " resource-item--selected" : ""}`} onClick={onSelect}>
        <button
          type="button"
          className={`tree-caret-button${expanded ? " tree-caret-button--expanded" : ""}`}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${topic.name}`}
          onClick={toggleExpand}
        >
          <span className="tree-caret" aria-hidden="true" />
        </button>
        {topic.name}
      </div>
      {expanded && (
        <ul className="topic-partition-list" data-testid={`partitions-${topic.name}`}>
          {partitions.isLoading && <li className="topic-partition-empty">Loading partitions…</li>}
          {!partitions.isLoading && (partitions.data?.length ?? 0) === 0 && (
            <li className="topic-partition-empty">No partitions found.</li>
          )}
          {partitions.data?.map((partition) => (
            <li
              key={partition.id}
              data-testid={`resource-item-partition-${topic.name}-${partition.id}`}
              className={`topic-partition-item${isPartitionSelected(partition.id) ? " topic-partition-item--selected" : ""}`}
              onClick={() => selectPartition(connectionId, topic.name, partition.id)}
            >
              Partition {partition.id}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
