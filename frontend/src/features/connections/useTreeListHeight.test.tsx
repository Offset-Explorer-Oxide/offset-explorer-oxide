import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  DEFAULT_VISIBLE_ROWS,
  MIN_VISIBLE_ROWS,
  ROW_HEIGHT_PX,
  useTreeListRows,
  visibleRowsForSidebarHeight,
} from "./useTreeListHeight";

describe("visibleRowsForSidebarHeight", () => {
  it("fills a tall sidebar with more rows than a short one", () => {
    expect(visibleRowsForSidebarHeight(1400)).toBeGreaterThan(visibleRowsForSidebarHeight(700));
  });

  it("never drops below the minimum, however short the sidebar", () => {
    expect(visibleRowsForSidebarHeight(120)).toBe(MIN_VISIBLE_ROWS);
    expect(visibleRowsForSidebarHeight(0)).toBe(MIN_VISIBLE_ROWS);
  });

  it("leaves room for the chrome above the list rather than claiming the whole height", () => {
    const rows = visibleRowsForSidebarHeight(1000);
    expect(rows * ROW_HEIGHT_PX).toBeLessThan(1000);
    expect(rows).toBe(Math.floor((1000 - 210) / ROW_HEIGHT_PX));
  });
});

describe("useTreeListRows", () => {
  function Probe({ enabled = true }: { enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const rows = useTreeListRows(ref, enabled);
    return (
      <div className="app-sidebar" style={{ height: 900 }}>
        <div ref={ref} data-testid="rows">
          {rows}
        </div>
      </div>
    );
  }

  it("falls back to the default count when ResizeObserver is unavailable", () => {
    const original = globalThis.ResizeObserver;
    // @ts-expect-error — deleting a global for the duration of this case.
    delete globalThis.ResizeObserver;
    render(<Probe />);
    expect(screen.getByTestId("rows")).toHaveTextContent(String(DEFAULT_VISIBLE_ROWS));
    globalThis.ResizeObserver = original;
  });

  it("sizes the list from the sidebar it is inside, and re-measures when that resizes", () => {
    const observers: { callback: () => void }[] = [];
    let sidebarHeight = 900;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push(this);
      }
      observe(element: Element) {
        // jsdom lays nothing out, so the height has to be supplied.
        Object.defineProperty(element, "clientHeight", { get: () => sidebarHeight, configurable: true });
      }
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    render(<Probe />);
    expect(screen.getByTestId("rows")).toHaveTextContent(String(visibleRowsForSidebarHeight(900)));

    act(() => {
      sidebarHeight = 400;
      observers.forEach((observer) => observer.callback());
    });
    expect(screen.getByTestId("rows")).toHaveTextContent(String(visibleRowsForSidebarHeight(400)));

    globalThis.ResizeObserver = original;
  });

  it("measures once the category opens, not only on mount", () => {
    let sidebarHeight = 1200;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(public callback: () => void) {}
      observe(element: Element) {
        Object.defineProperty(element, "clientHeight", { get: () => sidebarHeight, configurable: true });
      }
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    // Collapsed: the element the hook measures does not exist yet.
    const { rerender } = render(<Probe enabled={false} />);
    expect(screen.getByTestId("rows")).toHaveTextContent(String(DEFAULT_VISIBLE_ROWS));

    rerender(<Probe enabled />);
    expect(screen.getByTestId("rows")).toHaveTextContent(String(visibleRowsForSidebarHeight(1200)));

    sidebarHeight = 0;
    globalThis.ResizeObserver = original;
  });
});
