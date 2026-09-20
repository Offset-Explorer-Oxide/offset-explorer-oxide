import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

export interface UseResizablePanesOptions {
  /** localStorage key the widths are persisted under. */
  storageKey: string;
  /**
   * Whether each side pane is on screen, so the other one's range can use
   * the width it isn't taking. `ResizableShell` hides the left pane (keeping
   * it mounted) and docks the right one under the middle pane, and in both
   * cases the remaining pane can be dragged that much wider.
   */
  leftPaneVisible?: boolean;
  rightPaneVisible?: boolean;
  /** The width the middle pane keeps whatever the side panes are dragged to. */
  minMiddle?: number;
  defaultLeft?: number;
  defaultRight?: number;
  minLeft?: number;
  maxLeft?: number;
  minRight?: number;
  maxRight?: number;
  defaultBottom?: number;
  minBottom?: number;
  maxBottom?: number;
}

export interface UseResizablePanesResult {
  leftWidth: number;
  rightWidth: number;
  /** The payload pane's height while it is docked under the middle pane instead of beside it. */
  bottomHeight: number;
  startResizingLeft: (e: ReactPointerEvent) => void;
  startResizingRight: (e: ReactPointerEvent) => void;
  startResizingBottom: (e: ReactPointerEvent) => void;
}

interface StoredWidths {
  left?: number;
  right?: number;
  /**
   * Kept separately from `right` rather than reusing it: the same pane is
   * being sized, but a comfortable *width* beside the grid and a comfortable
   * *height* under it are unrelated numbers, and sharing one would resize the
   * pane to a nonsense value every time the user flipped the layout.
   */
  bottom?: number;
}

function readStoredWidths(storageKey: string): StoredWidths {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as StoredWidths) : {};
  } catch {
    return {};
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The width the middle pane is guaranteed whatever the side panes are dragged
 * to.
 *
 * The side ranges below are deliberately generous — wide enough to read a
 * long topic name or a whole payload without squinting — and on a 1280px
 * window two panes at their maximum would add up to more than the window,
 * leaving the grid at nothing (`.resizable-pane--middle` is `min-width: 0`,
 * so flex will happily collapse it). Every maximum is therefore also capped
 * against the *window*, which is what keeps the static bounds free to be
 * about comfort rather than about the smallest screen anyone might run on.
 */
export const MIN_MIDDLE_WIDTH = 320;

/**
 * The window's width, re-read as it changes.
 *
 * The drag maths stays pure clientX arithmetic — this is only the ceiling
 * that arithmetic is clamped against. Infinity when there is no `window`
 * (SSR), which makes the cap a no-op rather than a crash.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth,
  );
  useEffect(() => {
    function handleResize() {
      setWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return width;
}

/**
 * Drives the app shell's draggable left/right pane dividers. Width math is
 * pure clientX-delta arithmetic (no container measurement), so it's fully
 * unit-testable with synthetic PointerEvents. Widths persist to
 * localStorage on release and are restored on mount.
 */
export function useResizablePanes({
  storageKey,
  defaultLeft = 260,
  defaultRight = 320,
  minLeft = 140,
  maxLeft = 1000,
  minRight = 200,
  maxRight = 1100,
  defaultBottom = 300,
  minBottom = 140,
  maxBottom = 900,
  leftPaneVisible = true,
  rightPaneVisible = true,
  minMiddle = MIN_MIDDLE_WIDTH,
}: UseResizablePanesOptions): UseResizablePanesResult {
  const stored = useRef(readStoredWidths(storageKey)).current;
  const [leftWidth, setLeftWidth] = useState(() => clamp(stored.left ?? defaultLeft, minLeft, maxLeft));
  const [rightWidth, setRightWidth] = useState(() => clamp(stored.right ?? defaultRight, minRight, maxRight));
  const [bottomHeight, setBottomHeight] = useState(() => clamp(stored.bottom ?? defaultBottom, minBottom, maxBottom));

  /**
   * What each pane may actually be dragged to right now, as opposed to what
   * its configured maximum says.
   *
   * Asymmetric on purpose, and that asymmetry is what stops the two caps
   * being circular: the left pane's ceiling reserves only the right pane's
   * *minimum*, while the right pane's reserves the left pane's *current*
   * width. Left + right can therefore never exceed the space outside the
   * middle pane, and neither cap has to know its own result to compute the
   * other's.
   */
  const viewportWidth = useViewportWidth();
  const forSidePanes = viewportWidth - minMiddle;
  const effectiveMaxLeft = Math.max(
    minLeft,
    Math.min(maxLeft, forSidePanes - (rightPaneVisible ? minRight : 0)),
  );
  // Clamped again at render, not only while dragging: a width restored from
  // localStorage (or one the user set before shrinking the window) has never
  // been through the cap.
  const effectiveLeft = clamp(leftWidth, minLeft, effectiveMaxLeft);
  const effectiveMaxRight = Math.max(
    minRight,
    Math.min(maxRight, forSidePanes - (leftPaneVisible ? effectiveLeft : 0)),
  );
  const effectiveRight = clamp(rightWidth, minRight, effectiveMaxRight);

  const dragRef = useRef<{
    pane: "left" | "right" | "bottom";
    /** The pointer coordinate along the axis being dragged — clientX for the vertical dividers, clientY for the horizontal one. */
    startClient: number;
    startSize: number;
  } | null>(null);

  const persist = useCallback(
    (widths: StoredWidths) => {
      try {
        const current = readStoredWidths(storageKey);
        localStorage.setItem(storageKey, JSON.stringify({ ...current, ...widths }));
      } catch {
        // localStorage unavailable (e.g. private browsing) — resizing still works, just doesn't persist.
      }
    },
    [storageKey],
  );

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.pane === "left") {
        setLeftWidth(clamp(drag.startSize + (e.clientX - drag.startClient), minLeft, effectiveMaxLeft));
      } else if (drag.pane === "right") {
        // Negated: the right pane grows as the divider moves left.
        setRightWidth(clamp(drag.startSize - (e.clientX - drag.startClient), minRight, effectiveMaxRight));
      } else {
        // Same reasoning one axis over — the bottom pane grows as its
        // divider moves up.
        setBottomHeight(clamp(drag.startSize - (e.clientY - drag.startClient), minBottom, maxBottom));
      }
    }

    function handlePointerUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.pane === "left") {
        setLeftWidth((current) => {
          persist({ left: current });
          return current;
        });
      } else if (drag.pane === "right") {
        setRightWidth((current) => {
          persist({ right: current });
          return current;
        });
      } else {
        setBottomHeight((current) => {
          persist({ bottom: current });
          return current;
        });
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [minLeft, effectiveMaxLeft, minRight, effectiveMaxRight, minBottom, maxBottom, persist]);

  const startResizingLeft = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "left", startClient: e.clientX, startSize: effectiveLeft };
    },
    [effectiveLeft],
  );

  const startResizingRight = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "right", startClient: e.clientX, startSize: effectiveRight };
    },
    [effectiveRight],
  );

  const startResizingBottom = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "bottom", startClient: e.clientY, startSize: bottomHeight };
    },
    [bottomHeight],
  );

  return { leftWidth: effectiveLeft, rightWidth: effectiveRight, bottomHeight, startResizingLeft, startResizingRight, startResizingBottom };
}
