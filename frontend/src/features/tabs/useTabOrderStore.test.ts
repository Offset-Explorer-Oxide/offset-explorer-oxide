import { beforeEach, describe, expect, it } from "vitest";
import { mergeTabOrder, useTabOrderStore } from "./useTabOrderStore";

beforeEach(() => {
  useTabOrderStore.setState({ anchors: {} });
});

describe("useTabOrderStore", () => {
  it("registers a root with a null anchor, only once", () => {
    const { registerRoot } = useTabOrderStore.getState();
    registerRoot("1");
    registerRoot("1");
    expect(useTabOrderStore.getState().anchors).toEqual({ "1": null });
  });

  it("registers a tab after another, overwriting any previous anchor", () => {
    const { registerAfter } = useTabOrderStore.getState();
    registerAfter("2", "1");
    expect(useTabOrderStore.getState().anchors["2"]).toBe("1");
    registerAfter("2", "3");
    expect(useTabOrderStore.getState().anchors["2"]).toBe("3");
  });

  it("clearing an anchor makes the tab a root", () => {
    const { registerAfter, clearAnchor } = useTabOrderStore.getState();
    registerAfter("2", "1");
    clearAnchor("2");
    expect(useTabOrderStore.getState().anchors["2"]).toBeNull();
  });

  it("removes a tab's entry entirely", () => {
    const { registerRoot, remove } = useTabOrderStore.getState();
    registerRoot("1");
    remove("1");
    expect(useTabOrderStore.getState().anchors).toEqual({});
  });
});

describe("mergeTabOrder", () => {
  it("returns the root order as-is when there are no anchored tabs", () => {
    const result = mergeTabOrder(["1", "2"], [], {}, new Set(["1", "2"]));
    expect(result).toEqual(["1", "2"]);
  });

  it("splices an anchored tab right after its anchor", () => {
    const result = mergeTabOrder(["1", "2"], ["json-1"], { "json-1": "1" }, new Set(["1", "2", "json-1"]));
    expect(result).toEqual(["1", "json-1", "2"]);
  });

  it("appends an anchored tab at the end when its anchor is null", () => {
    const result = mergeTabOrder(["1", "2"], ["json-1"], { "json-1": null }, new Set(["1", "2", "json-1"]));
    expect(result).toEqual(["1", "2", "json-1"]);
  });

  it("appends an anchored tab at the end when its anchor is gone", () => {
    const result = mergeTabOrder(["1", "2"], ["json-1"], { "json-1": "deleted" }, new Set(["1", "2", "json-1"]));
    expect(result).toEqual(["1", "2", "json-1"]);
  });

  it("resolves a chain of anchors in the order they're passed", () => {
    const anchors = { "json-1": "1", "json-2": "json-1" };
    const result = mergeTabOrder(["1", "2"], ["json-1", "json-2"], anchors, new Set(["1", "2", "json-1", "json-2"]));
    expect(result).toEqual(["1", "json-1", "json-2", "2"]);
  });

  it("filters out ids that aren't live", () => {
    const result = mergeTabOrder(["1", "2"], ["json-1"], { "json-1": "1" }, new Set(["1", "json-1"]));
    expect(result).toEqual(["1", "json-1"]);
  });
});
