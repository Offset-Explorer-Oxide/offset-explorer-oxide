import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { LogsPanel } from "./LogsPanel";
import { useLogsListener } from "./useLogsListener";
import { useLogsStore } from "./useLogsStore";
import { api } from "../../lib/tauri";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { tabDataPrefix, totalRetainedPayloadBytes, useTabDataStore } from "../workspace/useTabDataStore";
import { useGeneralSettingsStore } from "../settings/useGeneralSettingsStore";
import { retainedPayloadBytes } from "../connections/payloadDecoding";
import { MessageFetchResult } from "../../lib/tauri";

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

  // The figure the Max total fetch size ceiling is actually enforced against:
  // payload bytes retained across *every* tab, not just this one. Shown
  // beside the per-tab number because every tab shares one webview process,
  // so "how close is the app to the limit" is a different question from "what
  // is this tab holding" — and until it was displayed, neither the user nor
  // anyone tuning the limit could answer the first one.
  const payloadBytesByTab = useTabDataStore((s) => s.payloadBytesByTab);
  // The payload viewer's open message is held in React Query rather than in a
  // tab cache, and it is the one payload carried whole rather than truncated
  // — so leaving it out understated the figure by exactly the largest single
  // thing the app holds. Bounded to one entry by `useFullPayload`'s
  // `gcTime: 0`; summed rather than assumed to be one, so this stays honest
  // if that ever changes.
  //
  // Subscribed to the cache, not merely read from it: this component has no
  // query of its own, so nothing else would re-render it when a payload is
  // opened or released and the figure sat stale until something unrelated
  // happened to touch the panel. The snapshot is a number, so React only
  // re-renders when the total actually moves, and `base64DecodedLength` is
  // arithmetic on the string's length rather than a decode.
  const queryClient = useQueryClient();
  const openPayloadBytes = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () =>
      queryClient
        .getQueryCache()
        .getAll()
        .reduce(
          (total, query) =>
            query.queryKey[0] === "full-payload"
              ? total + retainedPayloadBytes((query.state.data as MessageFetchResult | undefined)?.messages ?? [])
              : total,
          0,
        ),
  );
  const retainedBytes = totalRetainedPayloadBytes(payloadBytesByTab) + openPayloadBytes;
  const retentionLimit = useGeneralSettingsStore((s) => s.maxTotalFetchBytes);
  const isNearLimit = retainedBytes > retentionLimit * 0.8;

  const clearSelectionMemory = useWorkspaceSelectionStore((s) => s.clearTabMemory);
  const clearMessageMemory = useMessageViewerStore((s) => s.clearTabMemory);
  const clearAllTabData = useTabDataStore((s) => s.clearAllMessagesForTab);

  function handleClearMemory() {
    clearSelectionMemory();
    clearMessageMemory();
    clearAllTabData(activeTabId);
    // Dropping the cached rows/selection above frees that memory correctly,
    // but neither the JS heap nor Rust's own allocator hands freed pages
    // back to the OS on their own — this asks Windows to trim the process's
    // visible working set right now instead of waiting for it to happen
    // (if it ever does). No-op on macOS/Linux — see trimProcessMemory's doc
    // comment. Fire-and-forget: nothing in the UI depends on its result.
    void api.trimProcessMemory();
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
          <span
            className={`bottom-panel-memory-label${isNearLimit ? " bottom-panel-memory-label--warning" : ""}`}
            title="Message payloads held across every tab, against Settings → General → Max total fetch size"
          >
            Payloads (all tabs): {formatTabMemory(retainedBytes)} / {formatTabMemory(retentionLimit)}
          </span>
          <button type="button" aria-label="Clear tab memory" onClick={handleClearMemory}>
            Clear memory
          </button>
        </div>
      </div>
      {isExpanded && <div className="bottom-panel-content">{<LogsPanel />}</div>}
    </div>
  );
}
