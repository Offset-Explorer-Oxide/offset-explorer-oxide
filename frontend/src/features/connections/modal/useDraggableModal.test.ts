import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDraggableModal } from "./useDraggableModal";

function pointerEventAt(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type);
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

function drag(
  start: (e: ReactPointerEvent) => void,
  startAt: [number, number],
  endAt: [number, number],
) {
  act(() => {
    start({ clientX: startAt[0], clientY: startAt[1] } as unknown as ReactPointerEvent);
  });
  act(() => {
    window.dispatchEvent(pointerEventAt("pointermove", endAt[0], endAt[1]));
  });
}

function release() {
  act(() => {
    window.dispatchEvent(new Event("pointerup"));
  });
}

describe("useDraggableModal", () => {
  it("starts at a zero offset", () => {
    const { result } = renderHook(() => useDraggableModal());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  it("tracks pointer movement as an offset delta while dragging", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);

    expect(result.current.offset).toEqual({ x: 50, y: 30 });
  });

  it("stops updating the offset after pointerup", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);
    release();
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 400, 400));
    });

    expect(result.current.offset).toEqual({ x: 50, y: 30 });
  });

  it("accumulates offset across multiple drags rather than resetting", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);
    release();
    drag(result.current.startDragging, [150, 130], [120, 130]);

    expect(result.current.offset).toEqual({ x: 20, y: 30 });
  });
});
