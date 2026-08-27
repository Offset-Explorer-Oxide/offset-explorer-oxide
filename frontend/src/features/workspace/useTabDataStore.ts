import { create } from "zustand";
import { TopicMessage } from "../../lib/tauri";

/** The store key for a Data tab rendered before any real top-level tab exists yet. */
export const UNASSIGNED_TAB_KEY = "unassigned";

/**
 * A stable "no messages cached" fallback. A selector like
 * `s.messagesByTab[tabKey] ?? []` would otherwise hand back a fresh array
 * literal on every call, which zustand's reference-equality check reads as
 * "the state changed" on every render — an infinite render loop.
 */
export const EMPTY_TAB_MESSAGES: TopicMessage[] = [];

export function tabDataKey(activeTabId: string | null): string {
  return activeTabId ?? UNASSIGNED_TAB_KEY;
}

/**
 * A Data tab's cache key, scoped by top-level tab AND by what it's showing
 * (connection/topic, and partition when viewing a single partition's Data
 * tab) — without the topic/partition component, switching from one topic
 * (or a topic's Data tab to one of its partitions') to another within the
 * same top-level tab would show the previous topic/partition's stale
 * cached rows until Fetch was clicked again.
 */
export function dataTabCacheKey(
  activeTabId: string | null,
  connectionId: string,
  topicName: string,
  partitionId?: number,
): string {
  return `${tabDataKey(activeTabId)}:${connectionId}:${topicName}:${partitionId ?? "all"}`;
}

/**
 * Every `dataTabCacheKey` minted for a given top-level tab shares this
 * prefix, regardless of which connection/topic/partition it's for — lets
 * the bottom panel total up (or clear) everything a tab has cached across
 * every topic it's ever fetched, not just whichever one happens to be
 * selected right now.
 */
export function tabDataPrefix(activeTabId: string | null): string {
  return `${tabDataKey(activeTabId)}:`;
}

interface TabDataState {
  /**
   * Per-tab cache of the Data tab's last-fetched message rows. Without
   * this, the fetched grid lived only in DataTab's local state and was
   * lost whenever the tab was switched away from and back (the middle
   * pane remounts per tab) — this is also what makes the bottom panel's
   * "Tab memory" size estimate meaningful.
   */
  messagesByTab: Record<string, TopicMessage[]>;
  /**
   * How many messages matched the last fetch's filter in total, uncapped by
   * "max messages per partition"/"total max messages" — lets the Data tab
   * show "42 loaded of 150 matching" instead of a bare loaded count, so
   * returning to a tab you've already fetched still shows whether more
   * remained beyond what was loaded. `undefined` means this tab has never
   * been fetched.
   */
  totalMatchingByTab: Record<string, number>;
  setTabMessages: (tabId: string, messages: TopicMessage[]) => void;
  /** Records the last Fetch's total-matching count separately from the row cache — a single-row payload patch (`fetchPayloadForRow`) replaces a tab's cached rows without knowing (or wanting to overwrite) the total the original Fetch found. */
  setTabTotalMatching: (tabId: string, totalMatching: number) => void;
  /** Appends one streamed message onto a tab's rows — backs the Data tab's live-streaming Fetch, which paints rows in as they arrive instead of waiting for the whole fetch to finish. */
  appendTabMessage: (tabId: string, message: TopicMessage) => void;
  /**
   * Appends a batch of streamed messages in one update.
   *
   * The Data tab buffers arrivals and flushes them on a timer rather than
   * calling `appendTabMessage` per message: every call here rebuilds the tab's
   * array and re-renders the grid, so one-at-a-time is quadratic in both.
   * Measured over 20,000 streamed messages: 20,000 store updates and ~1.15s of
   * copying, against 100 updates and ~11ms batched.
   */
  appendTabMessages: (tabId: string, messages: TopicMessage[]) => void;
  clearTabMessages: (tabId: string) => void;
  /** Clears every entry cached under a tab's prefix (every topic/partition it's ever fetched), not just one exact key — backs the bottom panel's "Clear memory", which now clears the full total it displays. */
  clearAllMessagesForTab: (activeTabId: string | null) => void;
}

export const useTabDataStore = create<TabDataState>((set) => ({
  messagesByTab: {},
  totalMatchingByTab: {},
  setTabMessages: (tabId, messages) =>
    set((state) => ({ messagesByTab: { ...state.messagesByTab, [tabId]: messages } })),
  setTabTotalMatching: (tabId, totalMatching) =>
    set((state) => ({ totalMatchingByTab: { ...state.totalMatchingByTab, [tabId]: totalMatching } })),
  appendTabMessage: (tabId, message) =>
    set((state) => ({
      messagesByTab: { ...state.messagesByTab, [tabId]: [...(state.messagesByTab[tabId] ?? []), message] },
    })),
  appendTabMessages: (tabId, messages) =>
    set((state) =>
      messages.length === 0
        ? state
        : {
            messagesByTab: {
              ...state.messagesByTab,
              [tabId]: [...(state.messagesByTab[tabId] ?? []), ...messages],
            },
          },
    ),
  clearTabMessages: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.messagesByTab;
      const { [tabId]: _removedTotal, ...restTotal } = state.totalMatchingByTab;
      return { messagesByTab: rest, totalMatchingByTab: restTotal };
    }),
  clearAllMessagesForTab: (activeTabId) =>
    set((state) => {
      const prefix = tabDataPrefix(activeTabId);
      const messagesByTab = Object.fromEntries(
        Object.entries(state.messagesByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      const totalMatchingByTab = Object.fromEntries(
        Object.entries(state.totalMatchingByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      return { messagesByTab, totalMatchingByTab };
    }),
}));
