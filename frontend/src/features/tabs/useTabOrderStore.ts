import { create } from "zustand";

/**
 * Tracks where each tab (workspace or ephemeral JSON) should render relative
 * to the others, merging useTabsStore's and useJsonViewerTabsStore's
 * separate arrays into one visual order without either store knowing about
 * the other.
 *
 * A tab with `anchorId === null` is a "root" — its position comes from its
 * natural place in useTabsStore's (drag-reorderable) `tabs` array. A tab
 * with a non-null anchor renders immediately after whichever tab was active
 * when it was created, wherever that tab currently sits — so opening a JSON
 * tab while "Tab 2" is active, then clicking "+", lands the new tab right
 * after that JSON tab, not back at the end of the plain workspace-tab group.
 * Dragging a tab clears its anchor: manual placement always wins over the
 * anchor once the user has explicitly repositioned it.
 */
interface TabOrderState {
  anchors: Record<string, string | null>;
  registerRoot: (id: string) => void;
  registerAfter: (id: string, anchorId: string | null) => void;
  clearAnchor: (id: string) => void;
  remove: (id: string) => void;
}

export const useTabOrderStore = create<TabOrderState>((set) => ({
  anchors: {},
  registerRoot: (id) =>
    set((state) => (id in state.anchors ? state : { anchors: { ...state.anchors, [id]: null } })),
  registerAfter: (id, anchorId) =>
    set((state) => ({ anchors: { ...state.anchors, [id]: anchorId } })),
  clearAnchor: (id) => set((state) => ({ anchors: { ...state.anchors, [id]: null } })),
  remove: (id) =>
    set((state) => {
      const anchors = { ...state.anchors };
      delete anchors[id];
      return { anchors };
    }),
}));

/**
 * Merges `rootOrder` (workspace tab ids, in their live drag-reorderable
 * order) with every other live tab id, splicing each anchored id in right
 * after its anchor's current position. Anchored ids are processed in the
 * order they're passed so chains (an anchor pointing at another anchored
 * tab) resolve correctly. An anchor that's gone (closed, or not live) falls
 * back to the end.
 */
export function mergeTabOrder(
  rootOrder: string[],
  anchoredIds: string[],
  anchors: Record<string, string | null>,
  liveIds: Set<string>,
): string[] {
  const result = rootOrder.filter((id) => liveIds.has(id));
  for (const id of anchoredIds) {
    if (!liveIds.has(id) || result.includes(id)) continue;
    const anchorId = anchors[id] ?? null;
    const anchorIndex = anchorId ? result.indexOf(anchorId) : -1;
    result.splice(anchorIndex === -1 ? result.length : anchorIndex + 1, 0, id);
  }
  return result;
}
