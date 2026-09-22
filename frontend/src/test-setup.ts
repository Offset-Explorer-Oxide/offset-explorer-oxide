import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom implements no layout and no `ResizeObserver`, and `react-window`
 * constructs one unconditionally for any list whose size isn't pinned by an
 * explicit pixel height in `style` — which the virtualized JSON tree's isn't,
 * because in the app it fills whatever the pane leaves it.
 *
 * A stub that never fires is the right shape here rather than a fake that
 * reports sizes: with no callback, each list keeps its `defaultHeight`, so a
 * test sees a fixed, predictable window of rows instead of a number that
 * depends on a simulated layout nobody wrote.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

afterEach(() => {
  cleanup();
});
