import { LogsPanel } from "./LogsPanel";
import { useLogsListener } from "./useLogsListener";
import { useLogsStore } from "./useLogsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, EMPTY_TAB_MESSAGES, tabDataKey, useTabDataStore } from "../workspace/useTabDataStore";

/** Formats a byte count (a JSON-serialized-size estimate, not an exact figure) as megabytes for display. */
export function formatTabMemory(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BottomPanel() {
  useLogsListener();
  const isExpanded = useLogsStore((s) => s.isExpanded);
  const toggleExpanded = useLogsStore((s) => s.toggleExpanded);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const selection = useWorkspaceSelectionStore((s) => s.selection);
  const tabKey =
    selection?.type === "topic"
      ? dataTabCacheKey(activeTabId, selection.connectionId, selection.topicName)
      : selection?.type === "partition"
        ? dataTabCacheKey(activeTabId, selection.connectionId, selection.topicName, selection.partitionId)
        : tabDataKey(activeTabId);

  // "Tab memory" is everything the active top-level tab has cached — its
  // fetched Data tab rows plus any payload loaded into the right pane's
  // message viewer — not anything scoped to the left sidebar's tree.
  const cachedMessages = useTabDataStore((s) => s.messagesByTab[tabKey] ?? EMPTY_TAB_MESSAGES);
  const viewedMessage = useMessageViewerStore((s) => (activeTabId ? s.byTab[activeTabId] : undefined) ?? null);
  const bytesUsed = JSON.stringify(cachedMessages).length + JSON.stringify(viewedMessage).length;

  const clearSelectionMemory = useWorkspaceSelectionStore((s) => s.clearTabMemory);
  const clearMessageMemory = useMessageViewerStore((s) => s.clearTabMemory);
  const clearTabData = useTabDataStore((s) => s.clearTabMessages);

  function handleClearMemory() {
    clearSelectionMemory();
    clearMessageMemory();
    clearTabData(tabKey);
  }

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-status-strip">
        <button
          type="button"
          aria-label="Toggle logs panel"
          aria-expanded={isExpanded}
          className="bottom-panel-toggle"
          onClick={toggleExpanded}
        >
          {isExpanded ? "▾" : "▸"} Logs
        </button>
        <div className="bottom-panel-memory">
          <span className="bottom-panel-memory-label">Tab memory: {formatTabMemory(bytesUsed)}</span>
          <button type="button" aria-label="Clear tab memory" onClick={handleClearMemory}>
            Clear memory
          </button>
        </div>
      </div>
      {isExpanded && <div className="bottom-panel-content">{<LogsPanel />}</div>}
    </div>
  );
}
