import { describe, expect, it } from "vitest";
import {
  INITIAL_EXPANSION,
  JsonTreeExpansionState,
  MAX_RENDER_DEPTH,
  flattenJsonTree,
  isNodeExpanded,
} from "./jsonTreeLines";

function expansion(partial: Partial<JsonTreeExpansionState> = {}): JsonTreeExpansionState {
  return { ...INITIAL_EXPANSION, ...partial };
}

/** The rows as `kind@path`, which is what the ordering assertions are about. */
function shape(value: unknown, state = expansion()): string[] {
  return flattenJsonTree(value, state).lines.map((line) => `${line.kind}@${line.path}`);
}

describe("flattenJsonTree", () => {
  it("renders a primitive as a single row", () => {
    const { lines } = flattenJsonTree(42, expansion());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "primitive", depth: 0, label: null, value: 42 });
  });

  it("brackets an expanded container with an open and a close row", () => {
    expect(shape({ a: 1 })).toEqual(["open@", "primitive@/a", "close@"]);
  });

  it("gives a collapsed container an open row and nothing else", () => {
    const state = expansion({ overrides: new Map([["", false]]) });

    expect(shape({ a: 1, b: 2 }, state)).toEqual(["open@"]);
  });

  it("numbers array entries as labels and marks the rows as an array's", () => {
    const { lines } = flattenJsonTree(["x", "y"], expansion());

    expect(lines.map((l) => l.label)).toEqual([null, "0", "1", null]);
    expect(lines[0].isArray).toBe(true);
    expect(lines[3].isArray).toBe(true);
  });

  it("counts every collapsed container, at any depth", () => {
    // Two heavy arrays, each over the auto-expand budget, one inside the other's sibling.
    const heavy = () => Array.from({ length: 400 }, (_, i) => ({ id: i, sku: `s-${i}`, note: "n" }));

    const { collapsedCount } = flattenJsonTree({ first: heavy(), second: { inner: heavy() } }, expansion());

    expect(collapsedCount).toBe(2);
  });

  it("reports nothing collapsed once everything is expanded", () => {
    const heavy = Array.from({ length: 400 }, (_, i) => ({ id: i, sku: `s-${i}`, note: "n" }));

    const { collapsedCount } = flattenJsonTree({ events: heavy }, expansion({ expandAll: true }));

    expect(collapsedCount).toBe(0);
  });

  /**
   * Keys are user data and `/` is the path separator, so without escaping
   * `{ "a/b": … }` and `{ a: { b: … } }` would address the same node and
   * collapsing one would collapse the other.
   */
  it("keeps a key containing a slash on its own path", () => {
    const slashed = shape({ "a/b": { c: 1 } });
    const nested = shape({ a: { b: { c: 1 } } });

    expect(slashed).not.toEqual(nested);
    expect(slashed).toContain("open@/a~1b");
  });

  it("stops descending past the depth limit rather than overflowing the stack", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_RENDER_DEPTH + 50; i += 1) deep = { next: deep };

    const { lines } = flattenJsonTree(deep, expansion({ expandAll: true }));
    const deepest = Math.max(...lines.map((line) => line.depth));

    expect(deepest).toBe(MAX_RENDER_DEPTH);
    expect(lines.find((line) => line.depth === MAX_RENDER_DEPTH)).toMatchObject({ kind: "open", expanded: false });
  });

  it("measures a row's width in characters, not in nodes", () => {
    const { lines } = flattenJsonTree({ note: "abc" }, expansion());
    const row = lines.find((line) => line.label === "note");

    // `note: "abc"` — six characters of key and colon-space, five of value.
    expect(row?.weight).toBe("note: ".length + '"abc"'.length);
  });

  it("hands back the widest rows for the caller to size the document by", () => {
    const { widestLines } = flattenJsonTree(
      { short: "a", longest: "x".repeat(500), middling: "y".repeat(100) },
      expansion(),
    );

    expect(widestLines[0].label).toBe("longest");
  });

  it("gives a container's open and close rows distinct React keys", () => {
    const keys = flattenJsonTree({ a: { b: 1 } }, expansion()).lines.map((line) => line.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isNodeExpanded", () => {
  const heavy = Array.from({ length: 400 }, (_, i) => ({ id: i, sku: `s-${i}`, note: "n" }));

  it("falls back to the auto-expand rules when nothing else applies", () => {
    expect(isNodeExpanded(expansion(), "/events", heavy, 1)).toBe(false);
    expect(isNodeExpanded(expansion(), "/order", { id: 1 }, 1)).toBe(true);
  });

  it("opens everything once Expand all has been pressed", () => {
    expect(isNodeExpanded(expansion({ expandAll: true }), "/events", heavy, 1)).toBe(true);
  });

  /**
   * The user's own click is the last word — including after Expand all, so
   * that collapsing one node again doesn't have to fight the flag.
   */
  it("lets an explicit collapse win over Expand all", () => {
    const state = expansion({ expandAll: true, overrides: new Map([["/events", false]]) });

    expect(isNodeExpanded(state, "/events", heavy, 1)).toBe(false);
  });

  it("lets an explicit expand win over the auto-collapse rules", () => {
    const state = expansion({ overrides: new Map([["/events", true]]) });

    expect(isNodeExpanded(state, "/events", heavy, 1)).toBe(true);
  });
});
