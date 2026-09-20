import { describe, expect, it } from "vitest";
import {
  AUTO_EXPAND_MAX_LINES,
  AUTO_EXPAND_MAX_ROOT_CHILDREN,
  childCount,
  renderedLineCount,
  shouldAutoExpand,
} from "./jsonTreeExpansion";

describe("renderedLineCount", () => {
  it("counts a primitive as one line", () => {
    expect(renderedLineCount(42, 100)).toBe(1);
    expect(renderedLineCount("a string", 100)).toBe(1);
    expect(renderedLineCount(null, 100)).toBe(1);
  });

  // The opening line, a line per entry, and the closing bracket's own line —
  // which is what `JsonNode` renders.
  it("counts a container's brackets as well as its entries", () => {
    expect(renderedLineCount({ a: 1, b: 2 }, 100)).toBe(4);
    expect(renderedLineCount([1, 2, 3], 100)).toBe(5);
  });

  it("counts nested containers through to their leaves", () => {
    expect(renderedLineCount({ order: { id: "a-1" } }, 100)).toBe(5);
  });

  /**
   * A 700 KB payload must not be walked in full just to answer "is this over
   * budget?" — the answer is known long before the end.
   */
  it("stops counting once it is over the limit", () => {
    const huge = Array.from({ length: 100_000 }, (_, i) => i);

    const counted = renderedLineCount(huge, 50);

    expect(counted).toBeGreaterThan(50);
    expect(counted).toBeLessThan(100);
  });

  /**
   * Nesting depth comes off a broker, so it is whatever a producer wrote.
   * Deeper than the measuring cap counts as over budget rather than
   * overflowing the stack.
   */
  it("treats nesting deeper than it will walk as over the limit", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i += 1) deep = { nested: deep };

    expect(renderedLineCount(deep, AUTO_EXPAND_MAX_LINES)).toBeGreaterThan(AUTO_EXPAND_MAX_LINES);
  });
});

describe("childCount", () => {
  it("counts entries of arrays and objects, and nothing else", () => {
    expect(childCount([1, 2, 3])).toBe(3);
    expect(childCount({ a: 1, b: 2 })).toBe(2);
    expect(childCount("a string")).toBe(0);
    expect(childCount(null)).toBe(0);
  });
});

describe("shouldAutoExpand", () => {
  it("expands an ordinary container", () => {
    expect(shouldAutoExpand({ order: { id: "a-1" } }, 1)).toBe(true);
  });

  it("never expands a primitive — there is nothing to expand", () => {
    expect(shouldAutoExpand("a string", 1)).toBe(false);
  });

  /**
   * The old rule counted entries and capped them at 100, which measured the
   * wrong thing in both directions: this list is one line per entry and cheap,
   * and it used to start collapsed.
   */
  it("expands a long list of primitives", () => {
    const items = Array.from({ length: 500 }, (_, i) => `item-${i}`);

    expect(shouldAutoExpand(items, 1)).toBe(true);
  });

  /** ...and this one is far heavier on 80 entries, and used to start open. */
  it("collapses a shorter list of fat objects", () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: `item-${i}`,
      ...Object.fromEntries(Array.from({ length: 20 }, (_, f) => [`field${f}`, f])),
    }));

    expect(shouldAutoExpand(items, 1)).toBe(false);
  });

  /**
   * Collapsing the root renders the whole view as a single `{ 12 keys }`
   * line. The outline stays open on any document; the weight inside it is
   * what collapses.
   */
  it("keeps a root of few children open however big the document under it is", () => {
    const heavy = Array.from({ length: 5_000 }, (_, i) => ({ id: i, note: "n" }));

    expect(shouldAutoExpand({ orderId: "a-1", events: heavy }, 0)).toBe(true);
    expect(shouldAutoExpand({ orderId: "a-1", events: heavy }, 1)).toBe(false);
  });

  /**
   * The root's two clauses are an OR, so it takes both a child count past the
   * outline allowance *and* a line count past the budget to close it — at
   * which point even the outline is more than the DOM should take in one go.
   */
  it("collapses even a root once its outline alone is too big", () => {
    const wide = Object.fromEntries(
      Array.from({ length: AUTO_EXPAND_MAX_ROOT_CHILDREN * 4 }, (_, i) => [`key${i}`, { a: 1, b: 2 }]),
    );

    expect(childCount(wide)).toBeGreaterThan(AUTO_EXPAND_MAX_ROOT_CHILDREN);
    expect(renderedLineCount(wide, AUTO_EXPAND_MAX_LINES)).toBeGreaterThan(AUTO_EXPAND_MAX_LINES);
    expect(shouldAutoExpand(wide, 0)).toBe(false);
  });
});
