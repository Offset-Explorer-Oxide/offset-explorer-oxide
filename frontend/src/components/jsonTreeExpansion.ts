import { useCallback, useMemo, useState } from "react";
import { INITIAL_EXPANSION, JsonTreeExpansionState } from "./jsonTreeLines";

/**
 * How many rendered lines a container may be worth and still be expanded on
 * sight.
 *
 * This used to be a count of direct children, capped at 100, which measured
 * the wrong thing: an array of 120 integers is 120 lines and started
 * collapsed, while 80 objects of twenty fields each is over 1,600 lines and
 * started open. What actually costs layout time is the number of lines the
 * tree puts on screen, and that is what this counts.
 *
 * 1,000 lines is roomy enough that an ordinary message opens fully read-able
 * (a few hundred lines is typical) and still an order of magnitude short of
 * the multi-megabyte payloads this view is routinely handed.
 *
 * Note that since the tree became virtualized this is a *readability* budget
 * rather than a safety one — a wall of a hundred thousand open lines is
 * useless to read, but it no longer freezes anything. The hard limit that
 * used to live here is gone; see `flattenJsonTree`.
 */
export const AUTO_EXPAND_MAX_LINES = 1000;

/**
 * The root node's separate allowance, in direct children.
 *
 * The root is the whole document, and collapsing it renders the entire view
 * as one `{ 12 keys }` line — useless. So it opens when *either* rule passes:
 * the line budget above, or a child count small enough that opening it is
 * just the document's outline, with each heavy child left to collapse itself.
 * That second clause is what keeps a 700 KB message showing its top-level
 * shape instead of a single line.
 */
export const AUTO_EXPAND_MAX_ROOT_CHILDREN = 100;

/**
 * Where [`renderedLineCount`] stops descending.
 *
 * Measuring is recursive, and JSON nesting comes off a broker — depth is
 * whatever a producer wrote. Anything nested deeper than this is treated as
 * over budget (so: collapsed) rather than risking a stack overflow counting
 * it.
 */
const MEASURE_MAX_DEPTH = 64;

function isExpandable(value: unknown): value is unknown[] | Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Entries in an object or array; 0 for anything that isn't expandable. */
export function childCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isExpandable(value)) return Object.keys(value).length;
  return 0;
}

/**
 * How many lines this value renders as, if it and everything under it were
 * expanded.
 *
 * Stops counting as soon as it passes `limit`: the callers only ever ask
 * "is this over budget?", and a 700 KB payload must not be walked in full to
 * answer it. The return value above `limit` is therefore *a* number over the
 * limit, not the true total.
 *
 * A primitive is one line. A container is its opening line plus its closing
 * bracket line plus its entries — which is exactly what `flattenJsonTree`
 * produces.
 */
export function renderedLineCount(value: unknown, limit: number, depth = 0): number {
  if (!isExpandable(value)) return 1;
  if (depth >= MEASURE_MAX_DEPTH) return limit + 1;
  let lines = 2;
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const entry of entries) {
    if (lines > limit) return lines;
    lines += renderedLineCount(entry, limit - lines, depth + 1);
  }
  return lines;
}

/** Whether a node starts expanded, before the user has touched anything. */
export function shouldAutoExpand(value: unknown, depth: number): boolean {
  if (!isExpandable(value)) return false;
  if (renderedLineCount(value, AUTO_EXPAND_MAX_LINES) <= AUTO_EXPAND_MAX_LINES) return true;
  return depth === 0 && childCount(value) <= AUTO_EXPAND_MAX_ROOT_CHILDREN;
}

/**
 * The expansion state of one tree, plus the Expand-all wiring shared with a
 * toolbar button that isn't inside it (the payload panel's toolbar sits above
 * the tree, not in it).
 *
 * `collapsedCount` used to be tallied by each node reporting itself on mount
 * and unmount. It is now a single number the tree hands up once per flatten —
 * the same count, arrived at without a state update per node, which mattered
 * once one click could mount a hundred thousand of them.
 */
export interface JsonTreeControl {
  state: JsonTreeExpansionState;
  /** Open or close one container. */
  setNodeExpanded: (path: string, expanded: boolean) => void;
  expandAll: () => void;
  /** Collapsed containers on screen; 0 means Expand all has nothing to do. */
  collapsedCount: number;
  /** Called by the tree with what the current flatten found. */
  reportCollapsedCount: (count: number) => void;
}

/**
 * @param resetKey Changes whenever the tree is showing a different document —
 * for the payload panel, the payload and the format it's being read as. A
 * fresh document must start from the auto-expand rules rather than inheriting
 * "the user pressed Expand all", or an expanded `events` node on a message
 * with three entries would stay expanded on the next message where it holds
 * three thousand.
 */
export function useJsonTreeControl(resetKey: unknown = null): JsonTreeControl {
  const [state, setState] = useState<JsonTreeExpansionState>(INITIAL_EXPANSION);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [previousKey, setPreviousKey] = useState(resetKey);

  if (previousKey !== resetKey) {
    setPreviousKey(resetKey);
    setState(INITIAL_EXPANSION);
  }

  const setNodeExpanded = useCallback((path: string, expanded: boolean) => {
    setState((current) => {
      const overrides = new Map(current.overrides);
      overrides.set(path, expanded);
      return { ...current, overrides };
    });
  }, []);

  // Clearing the per-node overrides along with it is deliberate: a node the
  // user collapsed by hand is exactly what "expand all" is being asked to
  // undo, and leaving the override in place would make the button silently
  // skip it.
  const expandAll = useCallback(() => {
    setState({ overrides: new Map(), expandAll: true });
  }, []);

  const reportCollapsedCount = useCallback((count: number) => {
    setCollapsedCount(count);
  }, []);

  return useMemo(
    () => ({ state, setNodeExpanded, expandAll, collapsedCount, reportCollapsedCount }),
    [state, setNodeExpanded, expandAll, collapsedCount, reportCollapsedCount],
  );
}
