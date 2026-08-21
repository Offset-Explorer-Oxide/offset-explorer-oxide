import { LogsPanel } from "./LogsPanel";
import { useLogsListener } from "./useLogsListener";
import { useLogsStore } from "./useLogsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { tabDataPrefix, useTabDataStore } from "../workspace/useTabDataStore";

/** Formats a byte count (a JSON-serialized-size estimate, not an exact figure) as megabytes for display. */
export function formatTabMemory(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BottomPanel() {
  useLogsListener();
  const isExpanded = useLogsStore((s) => s.isExpanded);
  const toggleExpanded = useLogsStore((s) => s.toggleExpanded);
  const activeTabId = useTabsStore((s) => s.activeTabId);

  // "Tab memory" is everything the active top-level tab has cached — every
  // topic/partition's fetched Data tab rows it holds (not just whichever
  // one happens to be selected right now), plus any payload loaded into
  // the right pane's message viewer — not anything scoped to the left
  // sidebar's tree.
  const messagesByTab = useTabDataStore((s) => s.messagesByTab);
  const tabPrefix = tabDataPrefix(activeTabId);
  const cachedBytes = Object.entries(messagesByTab).reduce(
    (total, [key, messages]) => (key.startsWith(tabPrefix) ? total + JSON.stringify(messages).length : total),
    0,
  );
  const viewedMessage = useMessageViewerStore((s) => (activeTabId ? s.byTab[activeTabId] : undefined) ?? null);
  const bytesUsed = cachedBytes + JSON.stringify(viewedMessage).length;

  const clearSelectionMemory = useWorkspaceSelectionStore((s) => s.clearTabMemory);
  const clearMessageMemory = useMessageViewerStore((s) => s.clearTabMemory);
  const clearAllTabData = useTabDataStore((s) => s.clearAllMessagesForTab);

  function handleClearMemory() {
    clearSelectionMemory();
    clearMessageMemory();
    clearAllTabData(activeTabId);
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
