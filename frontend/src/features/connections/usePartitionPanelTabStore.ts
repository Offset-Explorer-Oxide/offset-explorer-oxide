import { create } from "zustand";

export type PartitionTabId = "properties" | "data" | "replicas" | "publish";

/**
 * Which sub-tab the partition detail panel is showing, per top-level tab.
 *
 * Two reasons this is a store rather than `useState` inside
 * `PartitionDetailPanel`:
 *
 * 1. The tree's right-click "Publish messages…" has to select a partition *and*
 *    open its Publish tab. With the active sub-tab held locally, the menu item
 *    could only do the first half.
 * 2. Selecting another partition unmounts and remounts the panel, so a local
 *    `useState` reset the sub-tab every time — the same problem the Data tab's
 *    filters and grid state already solved by moving into per-tab stores.
 */
interface PartitionPanelTabState {
  /** Keyed by top-level tab id (`null` before tabs have loaded, hence the string key). */
  activeByTab: Record<string, PartitionTabId>;
  get: (tabId: string | null) => PartitionTabId;
  set: (tabId: string | null, tab: PartitionTabId) => void;
}

/** What a partition opens on: the tab someone browsing a partition wants first. */
export const DEFAULT_PARTITION_TAB: PartitionTabId = "data";

function key(tabId: string | null): string {
  return tabId ?? "no-tab";
}

export const usePartitionPanelTabStore = create<PartitionPanelTabState>((set, get) => ({
  activeByTab: {},
  get: (tabId) => get().activeByTab[key(tabId)] ?? DEFAULT_PARTITION_TAB,
  set: (tabId, tab) => set((state) => ({ activeByTab: { ...state.activeByTab, [key(tabId)]: tab } })),
}));
