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
