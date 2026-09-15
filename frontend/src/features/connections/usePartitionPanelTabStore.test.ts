import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PARTITION_TAB, usePartitionPanelTabStore } from "./usePartitionPanelTabStore";

beforeEach(() => {
  usePartitionPanelTabStore.setState({ activeByTab: {} });
});

describe("usePartitionPanelTabStore", () => {
  it("opens a partition on Data, not on Publish", () => {
    // The tab that writes to the cluster must never be the one a panel opens on.
    expect(DEFAULT_PARTITION_TAB).toBe("data");
    expect(usePartitionPanelTabStore.getState().get("tab-1")).toBe("data");
  });

  it("remembers the chosen tab per top-level tab", () => {
    const { set, get } = usePartitionPanelTabStore.getState();
    set("tab-1", "publish");
    set("tab-2", "replicas");

    expect(usePartitionPanelTabStore.getState().get("tab-1")).toBe("publish");
    expect(usePartitionPanelTabStore.getState().get("tab-2")).toBe("replicas");
    expect(get("tab-3")).toBe("data");
  });

  it("handles a null tab id, which is the state before tabs have loaded", () => {
    const { set } = usePartitionPanelTabStore.getState();
    expect(usePartitionPanelTabStore.getState().get(null)).toBe("data");
    set(null, "publish");
    expect(usePartitionPanelTabStore.getState().get(null)).toBe("publish");
  });

  it("does not confuse a null tab id with a tab literally named no-tab", () => {
    // Documents the collision the key function allows. Harmless because tab ids
    // are uuids, but worth pinning so a future id scheme does not quietly make
    // two tabs share one setting.
    const { set } = usePartitionPanelTabStore.getState();
    set(null, "publish");
    expect(usePartitionPanelTabStore.getState().get("no-tab")).toBe("publish");
  });

  it("switching a tab's choice replaces it rather than accumulating", () => {
    const { set } = usePartitionPanelTabStore.getState();
    set("tab-1", "publish");
    set("tab-1", "properties");
    expect(usePartitionPanelTabStore.getState().activeByTab).toEqual({ "tab-1": "properties" });
  });
});
