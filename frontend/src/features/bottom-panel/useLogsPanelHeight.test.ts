import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DEFAULT_LOGS_HEIGHT,
  MAX_LOGS_HEIGHT,
  MIN_LOGS_HEIGHT,
  useLogsPanelHeight,
} from "./useLogsPanelHeight";

function pointerEventAt(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

beforeEach(() => {
  localStorage.clear();
});

describe("useLogsPanelHeight", () => {
  it("starts at the default height", () => {
    const { result } = renderHook(() => useLogsPanelHeight());
    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT);
  });

  it("grows when the handle is dragged upwards", () => {
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 400));
    });

    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT + 100);
  });

  it("shrinks when the handle is dragged downwards", () => {
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 540));
    });

    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT - 40);
  });

  it("clamps to the minimum and maximum heights", () => {
    // Tall enough a window that MAX_LOGS_HEIGHT, not the 80%-of-viewport
    // ceiling, is the binding limit.
    window.innerHeight = 2000;
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 5000));
    });
    expect(result.current.height).toBe(MIN_LOGS_HEIGHT);

    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", -5000));
    });
    expect(result.current.height).toBe(MAX_LOGS_HEIGHT);
    window.innerHeight = 768;
  });

  it("ignores pointer movement when no drag is in progress", () => {
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 10));
    });

    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT);
  });

  it("reports whether a drag is in progress", () => {
    const { result } = renderHook(() => useLogsPanelHeight());
    expect(result.current.isResizing).toBe(false);

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    expect(result.current.isResizing).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(result.current.isResizing).toBe(false);
  });

  it("persists the height on release and restores it on the next mount", () => {
    const first = renderHook(() => useLogsPanelHeight());

    act(() => {
      first.result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 420));
    });
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    first.unmount();

    const second = renderHook(() => useLogsPanelHeight());
    expect(second.result.current.height).toBe(DEFAULT_LOGS_HEIGHT + 80);
  });

  it("falls back to the default when the stored height is not a number", () => {
    localStorage.setItem("kafkaoxide.logs-panel-height", "tall");
    const { result } = renderHook(() => useLogsPanelHeight());
    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT);
  });

  it("clamps a stored height that is out of range", () => {
    window.innerHeight = 2000;
    localStorage.setItem("kafkaoxide.logs-panel-height", String(MAX_LOGS_HEIGHT + 1000));
    const { result } = renderHook(() => useLogsPanelHeight());
    expect(result.current.height).toBe(MAX_LOGS_HEIGHT);
    window.innerHeight = 768;
  });

  it("will not grow past 80% of the window height", () => {
    window.innerHeight = 400;
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", -1000));
    });

    expect(result.current.height).toBe(320);
    window.innerHeight = 768;
  });

  it("shrinks a too-tall panel when the window itself shrinks", () => {
    localStorage.setItem("kafkaoxide.logs-panel-height", "600");
    const { result } = renderHook(() => useLogsPanelHeight());
    expect(result.current.height).toBe(600);

    act(() => {
      window.innerHeight = 500;
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.height).toBe(400);
    window.innerHeight = 768;
  });

  it("resets to the default height and persists that", () => {
    const { result } = renderHook(() => useLogsPanelHeight());

    act(() => {
      result.current.startResizing({ clientY: 500 } as never);
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 300));
    });
    act(() => {
      result.current.resetHeight();
    });

    expect(result.current.height).toBe(DEFAULT_LOGS_HEIGHT);
    expect(localStorage.getItem("kafkaoxide.logs-panel-height")).toBe(String(DEFAULT_LOGS_HEIGHT));
  });
});
