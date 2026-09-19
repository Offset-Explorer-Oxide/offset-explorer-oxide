import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useResizablePanes } from "./useResizablePanes";

// jsdom has no PointerEvent constructor, so a plain Event is dispatched with
// a `clientX` property attached — the hook only reads `.clientX` off it.
function pointerEventAt(type: string, clientX: number): Event {
  const event = new Event(type);
  Object.defineProperty(event, "clientX", { value: clientX });
  return event;
}

function drag(startClientX: number, endClientX: number, start: (e: ReactPointerEvent) => void) {
  act(() => {
    start({ clientX: startClientX, pointerId: 1 } as unknown as ReactPointerEvent);
  });
  act(() => {
    window.dispatchEvent(pointerEventAt("pointermove", endClientX));
  });
}

function pointerEventAtY(type: string, clientY: number): Event {
  const event = new Event(type);
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

function dragVertically(startClientY: number, endClientY: number, start: (e: ReactPointerEvent) => void) {
  act(() => {
    start({ clientY: startClientY, pointerId: 1 } as unknown as ReactPointerEvent);
  });
  act(() => {
    window.dispatchEvent(pointerEventAtY("pointermove", endClientY));
  });
}

function release() {
  act(() => {
    window.dispatchEvent(new Event("pointerup"));
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("useResizablePanes", () => {
  it("defaults to the provided default widths", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-defaults", defaultLeft: 260, defaultRight: 320 }),
    );
    expect(result.current.leftWidth).toBe(260);
    expect(result.current.rightWidth).toBe(320);
  });

  it("increases left width when the left handle is dragged right", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-left-grow", defaultLeft: 260, defaultRight: 320 }),
    );

    drag(100, 150, result.current.startResizingLeft);

    expect(result.current.leftWidth).toBe(310);
  });

  it("decreases left width when the left handle is dragged left", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-left-shrink", defaultLeft: 260, defaultRight: 320 }),
    );

    drag(100, 60, result.current.startResizingLeft);

    expect(result.current.leftWidth).toBe(220);
  });

  it("clamps left width to the configured minimum", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-left-min", defaultLeft: 260, minLeft: 180 }),
    );

    drag(100, -1000, result.current.startResizingLeft);

    expect(result.current.leftWidth).toBe(180);
  });

  it("clamps left width to the configured maximum", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-left-max", defaultLeft: 260, maxLeft: 480 }),
    );

    drag(100, 5000, result.current.startResizingLeft);

    expect(result.current.leftWidth).toBe(480);
  });

  it("increases right width when the right handle is dragged left", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-right-grow", defaultLeft: 260, defaultRight: 320 }),
    );

    drag(500, 450, result.current.startResizingRight);

    expect(result.current.rightWidth).toBe(370);
  });

  it("clamps right width to the configured minimum", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-right-min", defaultRight: 320, minRight: 240 }),
    );

    drag(500, 5000, result.current.startResizingRight);

    expect(result.current.rightWidth).toBe(240);
  });

  it("stops updating width after pointerup", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-release", defaultLeft: 260 }),
    );

    drag(100, 150, result.current.startResizingLeft);
    release();
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 400));
    });

    expect(result.current.leftWidth).toBe(310);
  });

  it("persists the width to localStorage after a drag", () => {
    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-persist", defaultLeft: 260, defaultRight: 320 }),
    );

    drag(100, 150, result.current.startResizingLeft);
    release();

    const stored = JSON.parse(localStorage.getItem("test-persist") ?? "{}");
    expect(stored.left).toBe(310);
  });

  it("restores persisted widths on mount", () => {
    localStorage.setItem("test-restore", JSON.stringify({ left: 300, right: 280 }));

    const { result } = renderHook(() =>
      useResizablePanes({ storageKey: "test-restore", defaultLeft: 260, defaultRight: 320 }),
    );

    expect(result.current.leftWidth).toBe(300);
    expect(result.current.rightWidth).toBe(280);
  });
});

describe("useResizablePanes bottom height", () => {
  it("starts at the default height", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-1" }));

    expect(result.current.bottomHeight).toBe(300);
  });

  // Dragging the divider up makes the pane taller — the opposite sign to the
  // pointer delta, same as the right pane one axis over.
  it("grows the pane as the divider is dragged upwards", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-2" }));

    dragVertically(500, 440, result.current.startResizingBottom);

    expect(result.current.bottomHeight).toBe(360);
  });

  it("shrinks the pane as the divider is dragged downwards", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-2b" }));

    dragVertically(500, 560, result.current.startResizingBottom);

    expect(result.current.bottomHeight).toBe(240);
  });

  it("clamps the height to its bounds", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-3" }));

    dragVertically(500, 5000, result.current.startResizingBottom);

    expect(result.current.bottomHeight).toBe(140);
  });

  it("persists the height on release and restores it on mount", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-4" }));

    dragVertically(500, 460, result.current.startResizingBottom);
    release();

    const { result: remounted } = renderHook(() => useResizablePanes({ storageKey: "bottom-4" }));
    expect(remounted.current.bottomHeight).toBe(340);
  });

  // A comfortable width beside the grid and a comfortable height under it are
  // unrelated numbers; sharing one would resize the pane to nonsense every
  // time the user flipped the layout.
  it("keeps the bottom height and the right width as separate stored values", () => {
    const { result } = renderHook(() => useResizablePanes({ storageKey: "bottom-5" }));

    dragVertically(500, 460, result.current.startResizingBottom);
    release();

    expect(JSON.parse(localStorage.getItem("bottom-5") ?? "{}")).toEqual({ bottom: 340 });
  });

});
