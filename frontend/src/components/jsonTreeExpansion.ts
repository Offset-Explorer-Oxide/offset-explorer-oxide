import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * How many rendered lines a container may be worth and still be expanded on
 * sight.
 *
 * This used to be a count of direct children, capped at 100, which measured
 * the wrong thing: an array of 120 integers is 120 lines and started
 * collapsed, while 80 objects of twenty fields each is over 1,600 lines and
 * started open. What actually costs layout time is the number of lines the
 * tree puts in the DOM — the view isn't virtualised, so every line of every
 * expanded node is a real element — and that is what this counts.
 *
 * 1,000 lines is roomy enough that an ordinary message opens fully read-able
 * (a few hundred lines is typical) and still an order of magnitude short of
 * the multi-megabyte payloads that froze the app when everything expanded.
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
 * bracket line plus its entries — which is exactly what `JsonNode` renders.
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
 * The Expand-all wiring, shared between a tree and a toolbar button that
 * isn't inside it.
 *
 * Two things cross that boundary. `expandAllToken` goes down: every node
 * expands when it changes, *including nodes that mount afterwards*, which is
 * what makes one click expand a tree whose deeper levels aren't rendered yet.
 * `collapsedCount` comes up: each collapsed node on screen counts itself, so
 * the button can be disabled when there is nothing left to expand — and
 * enabled again the moment the user collapses something by hand.
 *
 * Only *mounted* nodes report, which is exactly right: a node inside a
 * collapsed parent isn't on screen, and its parent is already counted.
 */
export interface JsonTreeExpansion {
  expandAllToken: number;
  reportCollapsed: (delta: number) => void;
}

export const JsonTreeExpansionContext = createContext<JsonTreeExpansion | null>(null);

export interface JsonTreeControl extends JsonTreeExpansion {
  /** How many collapsed nodes are on screen; 0 means Expand all has nothing to do. */
  collapsedCount: number;
  expandAll: () => void;
}

/**
 * @param resetKey Changes whenever the tree is showing a different document —
 * for the payload panel, the payload and the format it's being read as. A
 * fresh document must start from the auto-expand rules rather than inheriting
 * "the user pressed Expand all" from the last one, and the token is what
 * would otherwise carry that across.
 */
export function useJsonTreeControl(resetKey: unknown = null): JsonTreeControl {
  const [expandAllToken, setExpandAllToken] = useState(0);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [previousKey, setPreviousKey] = useState(resetKey);

  if (previousKey !== resetKey) {
    setPreviousKey(resetKey);
    setExpandAllToken(0);
    // `collapsedCount` is deliberately not reset with it: it is a balanced
    // counter, and the outgoing tree's nodes each report -1 as they unmount
    // *after* this render. Zeroing it here would make those cleanups drive it
    // negative and the button would go dead on the new message.
  }

  const reportCollapsed = useCallback((delta: number) => {
    setCollapsedCount((current) => current + delta);
  }, []);
  const expandAll = useCallback(() => {
    setExpandAllToken((current) => current + 1);
  }, []);

  return useMemo(
    () => ({ expandAllToken, collapsedCount, reportCollapsed, expandAll }),
    [expandAllToken, collapsedCount, reportCollapsed, expandAll],
  );
}

/** The ambient expansion wiring for a `JsonNode`; inert outside a provider. */
export function useJsonTreeExpansion(): JsonTreeExpansion | null {
  return useContext(JsonTreeExpansionContext);
}
