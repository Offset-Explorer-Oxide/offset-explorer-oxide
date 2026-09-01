import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "kafkaoxide.logs-panel-height";

export const DEFAULT_LOGS_HEIGHT = 160;
export const MIN_LOGS_HEIGHT = 72;
export const MAX_LOGS_HEIGHT = 900;

export interface UseLogsPanelHeightResult {
  height: number;
  /** Pointer-down on the panel's top edge; dragging up grows the panel. */
  startResizing: (e: ReactPointerEvent) => void;
  /** Double-click on the same edge — back to [`DEFAULT_LOGS_HEIGHT`]. */
  resetHeight: () => void;
  isResizing: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The panel shares a fixed-height (`100vh`) flex column with the workspace,
 * whose `min-height: 0` means it will happily be squeezed to nothing. So the
 * real ceiling is a share of the window, not [`MAX_LOGS_HEIGHT`] — that stays
 * as an absolute cap for very tall displays.
 */
function maxHeightForViewport(): number {
  const viewportShare = typeof window === "undefined" ? MAX_LOGS_HEIGHT : Math.round(window.innerHeight * 0.8);
  return clamp(Math.min(MAX_LOGS_HEIGHT, viewportShare), MIN_LOGS_HEIGHT, MAX_LOGS_HEIGHT);
}

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, MIN_LOGS_HEIGHT, maxHeightForViewport()) : DEFAULT_LOGS_HEIGHT;
  } catch {
    return DEFAULT_LOGS_HEIGHT;
  }
}

function persistHeight(height: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(height));
  } catch {
    // localStorage unavailable — resizing still works, it just doesn't persist.
  }
}

/**
 * Drives the logs panel's draggable top edge. The panel used to be a fixed
 * 160px, which is a line or two of a stack trace — anything longer had to be
 * read through a scrollbar in a slot too short to hold the context around
 * it.
 *
 * Same shape as `useResizablePanes`: pure clientY-delta arithmetic (no
 * element measurement) so it is unit-testable with synthetic PointerEvents,
 * clamped to a sane band, and persisted to localStorage on release rather
 * than on every move.
 */
export function useLogsPanelHeight(): UseLogsPanelHeightResult {
  const [height, setHeight] = useState(readStoredHeight);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startClientY: number; startHeight: number } | null>(null);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      // The panel is anchored to the window's bottom edge, so dragging the
      // handle *up* (a negative delta) has to make it taller.
      const delta = drag.startClientY - e.clientY;
      setHeight(clamp(drag.startHeight + delta, MIN_LOGS_HEIGHT, maxHeightForViewport()));
    }

    function handlePointerUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsResizing(false);
      setHeight((current) => {
        persistHeight(current);
        return current;
      });
    }

    // A panel dragged tall on a maximized window must not swallow the whole
    // workspace when that window is restored to half the size.
    function handleWindowResize() {
      setHeight((current) => clamp(current, MIN_LOGS_HEIGHT, maxHeightForViewport()));
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  const startResizing = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { startClientY: e.clientY, startHeight: height };
      setIsResizing(true);
    },
    [height],
  );

  const resetHeight = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    setHeight(DEFAULT_LOGS_HEIGHT);
    persistHeight(DEFAULT_LOGS_HEIGHT);
  }, []);

  return { height, startResizing, resetHeight, isResizing };
}
