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
}

export interface UseResizablePanesResult {
  leftWidth: number;
  rightWidth: number;
  startResizingLeft: (e: ReactPointerEvent) => void;
  startResizingRight: (e: ReactPointerEvent) => void;
}

interface StoredWidths {
  left?: number;
  right?: number;
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
}: UseResizablePanesOptions): UseResizablePanesResult {
  const stored = useRef(readStoredWidths(storageKey)).current;
  const [leftWidth, setLeftWidth] = useState(() => clamp(stored.left ?? defaultLeft, minLeft, maxLeft));
  const [rightWidth, setRightWidth] = useState(() => clamp(stored.right ?? defaultRight, minRight, maxRight));

  const dragRef = useRef<{
    pane: "left" | "right";
    startClientX: number;
    startWidth: number;
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
      const delta = e.clientX - drag.startClientX;
      if (drag.pane === "left") {
        setLeftWidth(clamp(drag.startWidth + delta, minLeft, maxLeft));
      } else {
        setRightWidth(clamp(drag.startWidth - delta, minRight, maxRight));
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
      } else {
        setRightWidth((current) => {
          persist({ right: current });
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
  }, [minLeft, maxLeft, minRight, maxRight, persist]);

  const startResizingLeft = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "left", startClientX: e.clientX, startWidth: leftWidth };
    },
    [leftWidth],
  );

  const startResizingRight = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { pane: "right", startClientX: e.clientX, startWidth: rightWidth };
    },
    [rightWidth],
  );

  return { leftWidth, rightWidth, startResizingLeft, startResizingRight };
}
