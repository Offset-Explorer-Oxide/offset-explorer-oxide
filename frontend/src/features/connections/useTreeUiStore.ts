import { create } from "zustand";

/**
 * The sidebar tree's own local UI state — which connection rows and
 * Brokers/Topics/Consumers categories (and, within Topics, which
 * individual topics) are expanded, plus each category's search box text.
 * Keyed by a composite string built with `treeKey` below (always starting
 * with the top-level tab id), rather than living in each component's own
 * `useState`, so a brand new tab's tree starts fresh (no key has ever been
 * written for it) while switching back to a tab you've already expanded
 * things in shows it exactly as you left it — the tree itself is one
 * shared component instance the whole time, it just looks up a different
 * slice of this store depending on which tab is active.
 */
interface TreeUiState {
  expanded: Record<string, boolean>;
  searchText: Record<string, string>;
  /** Whether the "hide empty consumer groups" toggle is on for a given Consumers category (see `ClusterResourceTree`'s context menu). */
  hideEmptyConsumerGroups: Record<string, boolean>;
  toggleExpanded: (key: string) => void;
  setSearchText: (key: string, value: string) => void;
  toggleHideEmptyConsumerGroups: (key: string) => void;
}

export const useTreeUiStore = create<TreeUiState>((set) => ({
  expanded: {},
  searchText: {},
  hideEmptyConsumerGroups: {},
  toggleExpanded: (key) => set((state) => ({ expanded: { ...state.expanded, [key]: !state.expanded[key] } })),
  setSearchText: (key, value) => set((state) => ({ searchText: { ...state.searchText, [key]: value } })),
  toggleHideEmptyConsumerGroups: (key) =>
    set((state) => ({
      hideEmptyConsumerGroups: { ...state.hideEmptyConsumerGroups, [key]: !state.hideEmptyConsumerGroups[key] },
    })),
}));

/** Builds a tab-scoped key for `useTreeUiStore` — every tree UI element's key starts with the top-level tab id, so a new tab never collides with (or inherits) another tab's expand/search state. */
export function treeKey(activeTabId: string | null, ...parts: string[]): string {
  return [activeTabId ?? "no-tab", ...parts].join(":");
}
