import { beforeEach, describe, expect, it } from "vitest";
import { treeKey, useTreeUiStore } from "./useTreeUiStore";

beforeEach(() => {
  useTreeUiStore.setState({ expanded: {}, searchText: {}, hideEmptyConsumerGroups: {} });
});

describe("treeKey", () => {
  it("joins the tab id and parts with a colon", () => {
    expect(treeKey("tab-1", "connection", "1")).toBe("tab-1:connection:1");
  });

  it("falls back to a stable placeholder when there is no active tab", () => {
    expect(treeKey(null, "connection", "1")).toBe("no-tab:connection:1");
  });

  it("differs for different tabs given the same parts", () => {
    expect(treeKey("tab-1", "connection", "1")).not.toBe(treeKey("tab-2", "connection", "1"));
  });
});

describe("useTreeUiStore", () => {
  it("starts collapsed with no search text for any key", () => {
    expect(useTreeUiStore.getState().expanded["tab-1:connection:1"]).toBeUndefined();
    expect(useTreeUiStore.getState().searchText["tab-1:connection:1"]).toBeUndefined();
  });

  it("toggles a key's expanded state on and off", () => {
    useTreeUiStore.getState().toggleExpanded("tab-1:connection:1");
    expect(useTreeUiStore.getState().expanded["tab-1:connection:1"]).toBe(true);

    useTreeUiStore.getState().toggleExpanded("tab-1:connection:1");
    expect(useTreeUiStore.getState().expanded["tab-1:connection:1"]).toBe(false);
  });

  it("keeps different keys' expanded state independent", () => {
    useTreeUiStore.getState().toggleExpanded("tab-1:connection:1");

    expect(useTreeUiStore.getState().expanded["tab-1:connection:1"]).toBe(true);
    expect(useTreeUiStore.getState().expanded["tab-2:connection:1"]).toBeUndefined();
  });

  it("sets a key's search text independently of other keys", () => {
    useTreeUiStore.getState().setSearchText("tab-1:1:Topics", "orders");

    expect(useTreeUiStore.getState().searchText["tab-1:1:Topics"]).toBe("orders");
    expect(useTreeUiStore.getState().searchText["tab-2:1:Topics"]).toBeUndefined();
  });

  it("toggles a key's hideEmptyConsumerGroups state on and off, independent of other keys", () => {
    useTreeUiStore.getState().toggleHideEmptyConsumerGroups("tab-1:1:Consumers");

    expect(useTreeUiStore.getState().hideEmptyConsumerGroups["tab-1:1:Consumers"]).toBe(true);
    expect(useTreeUiStore.getState().hideEmptyConsumerGroups["tab-2:1:Consumers"]).toBeUndefined();

    useTreeUiStore.getState().toggleHideEmptyConsumerGroups("tab-1:1:Consumers");
    expect(useTreeUiStore.getState().hideEmptyConsumerGroups["tab-1:1:Consumers"]).toBe(false);
  });
});
