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
  setTabMessages: (tabId: string, messages: TopicMessage[]) => void;
  /** Appends one streamed message onto a tab's rows — backs the Data tab's live-streaming Fetch, which paints rows in as they arrive instead of waiting for the whole fetch to finish. */
  appendTabMessage: (tabId: string, message: TopicMessage) => void;
  clearTabMessages: (tabId: string) => void;
  /** Clears every entry cached under a tab's prefix (every topic/partition it's ever fetched), not just one exact key — backs the bottom panel's "Clear memory", which now clears the full total it displays. */
  clearAllMessagesForTab: (activeTabId: string | null) => void;
}

export const useTabDataStore = create<TabDataState>((set) => ({
  messagesByTab: {},
  setTabMessages: (tabId, messages) =>
    set((state) => ({ messagesByTab: { ...state.messagesByTab, [tabId]: messages } })),
  appendTabMessage: (tabId, message) =>
    set((state) => ({
      messagesByTab: { ...state.messagesByTab, [tabId]: [...(state.messagesByTab[tabId] ?? []), message] },
    })),
  clearTabMessages: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.messagesByTab;
      return { messagesByTab: rest };
    }),
  clearAllMessagesForTab: (activeTabId) =>
    set((state) => {
      const prefix = tabDataPrefix(activeTabId);
      const messagesByTab = Object.fromEntries(
        Object.entries(state.messagesByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      return { messagesByTab };
    }),
}));
