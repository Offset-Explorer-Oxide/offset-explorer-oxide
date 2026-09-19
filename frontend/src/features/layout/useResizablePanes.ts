import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

export interface UseResizablePanesOptions {
  /** localStorage key the widths are persisted under. */
  storageKey: string;
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
 * Drives the app shell's draggable left/right pane dividers. Width math is
 * pure clientX-delta arithmetic (no container measurement), so it's fully
 * unit-testable with synthetic PointerEvents. Widths persist to
 * localStorage on release and are restored on mount.
 */
export function useResizablePanes({
  storageKey,
  defaultLeft = 260,
  defaultRight = 320,
  minLeft = 180,
  maxLeft = 560,
  minRight = 240,
  maxRight = 640,
  defaultBottom = 300,
  minBottom = 140,
  maxBottom = 900,
}: UseResizablePanesOptions): UseResizablePanesResult {
  const stored = useRef(readStoredWidths(storageKey)).current;
  const [leftWidth, setLeftWidth] = useState(() => clamp(stored.left ?? defaultLeft, minLeft, maxLeft));
  const [rightWidth, setRightWidth] = useState(() => clamp(stored.right ?? defaultRight, minRight, maxRight));
  const [bottomHeight, setBottomHeight] = useState(() => clamp(stored.bottom ?? defaultBottom, minBottom, maxBottom));

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
        setLeftWidth(clamp(drag.startSize + (e.clientX - drag.startClient), minLeft, maxLeft));
      } else if (drag.pane === "right") {
        // Negated: the right pane grows as the divider moves left.
        setRightWidth(clamp(drag.startSize - (e.clientX - drag.startClient), minRight, maxRight));
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
  }, [minLeft, maxLeft, minRight, maxRight, minBottom, maxBottom, persist]);

  const startResizingLeft = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "left", startClient: e.clientX, startSize: leftWidth };
    },
    [leftWidth],
  );

  const startResizingRight = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "right", startClient: e.clientX, startSize: rightWidth };
    },
    [rightWidth],
  );

  const startResizingBottom = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "bottom", startClient: e.clientY, startSize: bottomHeight };
    },
    [bottomHeight],
  );

  return { leftWidth, rightWidth, bottomHeight, startResizingLeft, startResizingRight, startResizingBottom };
}
