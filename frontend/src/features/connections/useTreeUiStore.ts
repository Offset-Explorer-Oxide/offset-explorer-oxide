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
  /**
   * Forgets every tree row belonging to one connection, in every tab —
   * collapsing its Brokers/Topics/Consumers categories, each expanded topic
   * under them, and the connection row itself, and dropping the category
   * search boxes with them.
   *
   * Called when a cluster disconnects. The rows below a connection only
   * render while it is connected, so leaving them marked expanded meant a
   * cluster reconnected later sprang open on whatever had been showing
   * before it dropped — including topics that may no longer exist — and
   * immediately refetched all of it.
   */
  collapseConnection: (connectionId: string) => void;
}

/**
 * Which connection a tree key belongs to, or `undefined` for a key that
 * names no connection.
 *
 * Every key is built by `treeKey` as `<tab>:<parts...>`, and the connection
 * appears in one of exactly two shapes: the connection row itself is
 * `<tab>:connection:<id>`, and everything under it is `<tab>:<id>:...`. A
 * topic name can contain colons, but only ever from the fourth segment on,
 * so reading segment 1 (or 2) is unambiguous.
 */
export function connectionIdOfTreeKey(key: string): string | undefined {
  const [, second, third] = key.split(":");
  return second === "connection" ? third : second;
}

/** Drops every entry of a tree-state record whose key belongs to `connectionId`. */
function withoutConnection<T>(record: Record<string, T>, connectionId: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => connectionIdOfTreeKey(key) !== connectionId),
  );
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
  collapseConnection: (connectionId) =>
    set((state) => ({
      expanded: withoutConnection(state.expanded, connectionId),
      searchText: withoutConnection(state.searchText, connectionId),
      hideEmptyConsumerGroups: withoutConnection(state.hideEmptyConsumerGroups, connectionId),
    })),
}));

/** Builds a tab-scoped key for `useTreeUiStore` — every tree UI element's key starts with the top-level tab id, so a new tab never collides with (or inherits) another tab's expand/search state. */
export function treeKey(activeTabId: string | null, ...parts: string[]): string {
  return [activeTabId ?? "no-tab", ...parts].join(":");
}
