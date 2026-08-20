import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

export interface DraggableModalOffset {
  x: number;
  y: number;
}

export interface UseDraggableModalResult {
  offset: DraggableModalOffset;
  startDragging: (e: ReactPointerEvent) => void;
}

/**
 * Delta-based drag tracking for the New Connection modal's header, mirroring
 * useResizablePanes' pointer-event pattern. The modal stays centered by CSS
 * flexbox; this only ever supplies an additive `transform: translate()`
 * offset on top of that, starting fresh at (0, 0) on every mount (the modal
 * unmounts on close, so there's nothing to reset explicitly).
 */
export function useDraggableModal(): UseDraggableModalResult {
  const [offset, setOffset] = useState<DraggableModalOffset>({ x: 0, y: 0 });

  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffset: DraggableModalOffset;
  } | null>(null);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset({
        x: drag.startOffset.x + (e.clientX - drag.startClientX),
        y: drag.startOffset.y + (e.clientY - drag.startClientY),
      });
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const startDragging = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startOffset: offset };
    },
    [offset],
  );

  return { offset, startDragging };
}
