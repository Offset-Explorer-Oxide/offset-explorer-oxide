import { RefObject, useEffect, useState } from "react";

/** Must match `.resource-item`'s rendered height — react-window positions rows by this fixed amount rather than measuring the DOM. */
export const ROW_HEIGHT_PX = 32;
/** Never shrink the virtualized viewport below this, however short the sidebar is — a two-row scroll box is worse than an overflowing one. */
export const MIN_VISIBLE_ROWS = 6;
/** Used before the sidebar has been measured (and in environments without ResizeObserver). */
export const DEFAULT_VISIBLE_ROWS = 10;
/**
 * Roughly what sits above a category's item list inside the sidebar: the
 * Add/Export/Import buttons, the cluster row, the three category headers and
 * the search box. Subtracted so the list stops at the bottom of the pane
 * instead of running past it.
 */
const CHROME_ABOVE_LIST_PX = 210;

/**
 * How many rows the virtualized item list shows before it scrolls, for a
 * sidebar of `sidebarHeight` pixels.
 *
 * The count used to be a hard-coded 10 — a 320px box regardless of whether
 * the window was 700px tall or 1400px, which on a big screen left most of
 * the sidebar empty while the topic list scrolled inside a letterbox.
 */
export function visibleRowsForSidebarHeight(sidebarHeight: number): number {
  const usable = sidebarHeight - CHROME_ABOVE_LIST_PX;
  return Math.max(MIN_VISIBLE_ROWS, Math.floor(usable / ROW_HEIGHT_PX));
}

/**
 * Tracks the sidebar's height so a long (virtualized) category list can fill
 * it. Measured off the scroll container the list lives in — `.app-sidebar` —
 * rather than the window, because the sidebar's height also moves when the
 * logs panel at the bottom of the app is resized.
 */
export function useTreeListRows(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [rows, setRows] = useState(DEFAULT_VISIBLE_ROWS);

  // `enabled` is the category's expanded flag, and it is a dependency rather
  // than a guard: the element `ref` points at only exists while the category
  // is open, so an effect that ran once on mount would measure a null ref,
  // bail out, and never look again — leaving the list on its default row
  // count for the rest of the session.
  useEffect(() => {
    const sidebar = enabled ? ref.current?.closest(".app-sidebar") : null;
    if (!sidebar || typeof ResizeObserver === "undefined") return;

    function update() {
      setRows(visibleRowsForSidebarHeight((sidebar as HTMLElement).clientHeight));
    }

    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    // Observing already schedules a first callback in a real browser; this
    // measures now so the list is the right size on its very first paint.
    update();
    return () => observer.disconnect();
  }, [ref, enabled]);

  return rows;
}
