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
  clearTabMessages: (tabId: string) => void;
}

export const useTabDataStore = create<TabDataState>((set) => ({
  messagesByTab: {},
  setTabMessages: (tabId, messages) =>
    set((state) => ({ messagesByTab: { ...state.messagesByTab, [tabId]: messages } })),
  clearTabMessages: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.messagesByTab;
      return { messagesByTab: rest };
    }),
}));
