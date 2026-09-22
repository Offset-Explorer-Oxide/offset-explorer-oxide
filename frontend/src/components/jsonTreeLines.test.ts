import { describe, expect, it } from "vitest";
import {
  JsonTreeOverrides,
  MAX_RENDER_DEPTH,
  NO_OVERRIDES,
  childCount,
  flattenJsonTree,
  isNodeExpanded,
} from "./jsonTreeLines";

function closed(...paths: string[]): JsonTreeOverrides {
  return new Map(paths.map((path) => [path, false]));
}

/** The rows as `kind@path`, which is what the ordering assertions are about. */
function shape(value: unknown, overrides: JsonTreeOverrides = NO_OVERRIDES): string[] {
  return flattenJsonTree(value, overrides).lines.map((line) => `${line.kind}@${line.path}`);
}

describe("childCount", () => {
  it("counts entries of arrays and objects, and nothing else", () => {
    expect(childCount([1, 2, 3])).toBe(3);
    expect(childCount({ a: 1, b: 2 })).toBe(2);
    expect(childCount("a string")).toBe(0);
    expect(childCount(null)).toBe(0);
    expect(childCount(42)).toBe(0);
  });
});

describe("flattenJsonTree", () => {
  it("renders a primitive as a single row", () => {
    const { lines } = flattenJsonTree(42, NO_OVERRIDES);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "primitive", depth: 0, label: null, value: 42 });
  });

  it("brackets an expanded container with an open and a close row", () => {
    expect(shape({ a: 1 })).toEqual(["open@", "primitive@/a", "close@"]);
  });

  it("gives a container the reader closed an open row and nothing else", () => {
    expect(shape({ a: 1, b: 2 }, closed(""))).toEqual(["open@"]);
  });

  it("numbers array entries as labels and marks the rows as an array's", () => {
    const { lines } = flattenJsonTree(["x", "y"], NO_OVERRIDES);

    expect(lines.map((l) => l.label)).toEqual([null, "0", "1", null]);
    expect(lines[0].isArray).toBe(true);
    expect(lines[3].isArray).toBe(true);
  });

  /**
   * The tree is windowed, so a big document costs rows in an array rather
   * than elements in the DOM. Nothing is held back.
   */
  it("expands a heavy document in full, with no size rule holding anything shut", () => {
    const events = Array.from({ length: 400 }, (_, i) => ({ id: i, sku: `s-${i}`, note: "n" }));

    const { lines } = flattenJsonTree({ events }, NO_OVERRIDES);

    // 2 for the root, 2 for the array, and 5 per event (open, 3 fields, close).
    expect(lines).toHaveLength(2 + 2 + 400 * 5);
    expect(lines.some((line) => line.value === "s-399")).toBe(true);
    expect(lines.every((line) => line.kind !== "open" || line.expanded)).toBe(true);
  });

  it("closes only the container the reader clicked, not its siblings", () => {
    const value = { first: { a: 1 }, second: { b: 2 } };

    expect(shape(value, closed("/first"))).toEqual([
      "open@",
      "open@/first",
      "open@/second",
      "primitive@/second/b",
      "close@/second",
      "close@",
    ]);
  });

  /**
   * Keys are user data and `/` is the path separator, so without escaping
   * `{ "a/b": ... }` and `{ a: { b: ... } }` would address the same node and
   * closing one would close the other.
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

    const { lines } = flattenJsonTree(deep, NO_OVERRIDES);
    const deepest = Math.max(...lines.map((line) => line.depth));

    expect(deepest).toBe(MAX_RENDER_DEPTH);
    expect(lines.find((line) => line.depth === MAX_RENDER_DEPTH)).toMatchObject({ kind: "open", expanded: false });
  });

  it("measures a row's width in characters, not in nodes", () => {
    const { lines } = flattenJsonTree({ note: "abc" }, NO_OVERRIDES);
    const row = lines.find((line) => line.label === "note");

    // `note: "abc"` - six characters of key and colon-space, five of value.
    expect(row?.weight).toBe("note: ".length + '"abc"'.length);
  });

  it("hands back the widest rows for the caller to size the document by", () => {
    const { widestLines } = flattenJsonTree(
      { short: "a", longest: "x".repeat(500), middling: "y".repeat(100) },
      NO_OVERRIDES,
    );

    expect(widestLines[0].label).toBe("longest");
  });

  it("gives a container's open and close rows distinct React keys", () => {
    const keys = flattenJsonTree({ a: { b: 1 } }, NO_OVERRIDES).lines.map((line) => line.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * A control character in a key once made this whole source file register as
   * binary, which grep and diff tools quietly skip.
   */
  it("builds keys out of printable characters", () => {
    for (const { key } of flattenJsonTree({ a: { b: 1 } }, NO_OVERRIDES).lines) {
      const codes = [...key].map((character) => character.charCodeAt(0));
      expect(Math.min(...codes, 32)).toBeGreaterThanOrEqual(32);
    }
  });
});

describe("isNodeExpanded", () => {
  it("opens a container nobody has touched", () => {
    expect(isNodeExpanded(NO_OVERRIDES, "/events")).toBe(true);
  });

  it("closes one the reader closed", () => {
    expect(isNodeExpanded(closed("/events"), "/events")).toBe(false);
  });

  it("opens it again once the reader reopens it", () => {
    expect(isNodeExpanded(new Map([["/events", true]]), "/events")).toBe(true);
  });
});
