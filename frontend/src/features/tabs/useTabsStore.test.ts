import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useTabsStore } from "./useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, useTabDataStore } from "../workspace/useTabDataStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
  useWorkspaceSelectionStore.setState({ selection: null, activeTabId: null, byTab: {} });
  useMessageViewerStore.setState({
    message: null,
    connectionId: null,
    topic: null,
    partitionId: undefined,
    activeTabId: null,
    byTab: {},
  });
  useTabDataStore.setState({ messagesByTab: {}, totalMatchingByTab: {} });
});

describe("useTabsStore loadTabs", () => {
  it("auto-creates a default first tab when none exist yet", async () => {
    const tabList = vi.fn(() => []);
    const tabCreate = vi.fn(() => ({ id: "default-1", name: "Tab 1", position: 0 }));
    setInvokeHandlers({ tab_list: tabList, tab_create: tabCreate });

    await useTabsStore.getState().loadTabs();

    expect(tabCreate).toHaveBeenCalledWith({ name: "Tab 1" });
    expect(useTabsStore.getState().tabs).toEqual([{ id: "default-1", name: "Tab 1", position: 0 }]);
    expect(useTabsStore.getState().activeTabId).toBe("default-1");
  });

  it("does not create a default tab when tabs already exist", async () => {
    const tabCreate = vi.fn();
    setInvokeHandlers({
      tab_list: () => [{ id: "1", name: "Alpha", position: 0 }],
      tab_create: tabCreate,
    });

    await useTabsStore.getState().loadTabs();

    expect(tabCreate).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toEqual([{ id: "1", name: "Alpha", position: 0 }]);
    expect(useTabsStore.getState().activeTabId).toBe("1");
  });

  it("sets an error and does not create a default tab when listing fails", async () => {
    const tabCreate = vi.fn();
    setInvokeHandlers({
      tab_list: () => {
        throw new Error("list failed");
      },
      tab_create: tabCreate,
    });

    await useTabsStore.getState().loadTabs();

    expect(tabCreate).not.toHaveBeenCalled();
    expect(useTabsStore.getState().error).toBe("list failed");
    expect(useTabsStore.getState().tabs).toEqual([]);
  });
});

describe("useTabsStore deleteTab", () => {
  it("removes the tab from state and calls tab_delete", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["1"]);
    expect(invoke).toHaveBeenCalledWith("tab_delete", { id: "2" });
  });

  it("falls back activeTabId to the previous tab when the active tab is closed", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
        { id: "3", name: "Gamma", position: 2 },
      ],
      activeTabId: "2",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().activeTabId).toBe("1");
  });

  it("falls back activeTabId to the next tab when closing the first (active) tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().activeTabId).toBe("2");
  });

  it("sets activeTabId to null when closing the last remaining tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().activeTabId).toBeNull();
  });

  it("leaves activeTabId unchanged when closing a non-active tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().activeTabId).toBe("1");
  });

  it("sets an error and leaves state unchanged when the backend call fails", async () => {
    setInvokeHandlers({
      tab_delete: () => {
        throw new Error("delete failed");
      },
    });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().error).toBe("delete failed");
  });

  it("clears the closed tab's cached Data tab rows, same as the bottom panel's Clear memory", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });
    const cached = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] }];
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("2", "1", "orders"), cached);
    useTabDataStore.getState().setTabTotalMatching(dataTabCacheKey("2", "1", "orders"), 5);

    await useTabsStore.getState().deleteTab("2");

    expect(useTabDataStore.getState().messagesByTab[dataTabCacheKey("2", "1", "orders")]).toBeUndefined();
    expect(useTabDataStore.getState().totalMatchingByTab[dataTabCacheKey("2", "1", "orders")]).toBeUndefined();
  });

  it("does not touch another (still-open) tab's cached Data tab rows when closing a tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });
    const cached = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] }];
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("1", "1", "orders"), cached);

    await useTabsStore.getState().deleteTab("2");

    expect(useTabDataStore.getState().messagesByTab[dataTabCacheKey("1", "1", "orders")]).toEqual(cached);
  });

  it("clears the closed tab's workspace selection and viewed message", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });
    useWorkspaceSelectionStore.setState({
      byTab: { "2": { type: "topic", connectionId: "1", topicName: "orders" } },
    });
    useMessageViewerStore.setState({
      byTab: {
        "2": {
          message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] },
          connectionId: "1",
          topic: "orders",
        },
      },
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useWorkspaceSelectionStore.getState().byTab["2"]).toBeNull();
    expect(useMessageViewerStore.getState().byTab["2"]).toBeNull();
  });

  it("asks the backend to trim the OS-visible working set after closing a tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined, trim_process_memory: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(invoke).toHaveBeenCalledWith("trim_process_memory", undefined);
  });

  it("does not clear any tab's memory when the backend delete call fails", async () => {
    setInvokeHandlers({
      tab_delete: () => {
        throw new Error("delete failed");
      },
    });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });
    const cached = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] }];
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("1", "1", "orders"), cached);

    await useTabsStore.getState().deleteTab("1");

    expect(useTabDataStore.getState().messagesByTab[dataTabCacheKey("1", "1", "orders")]).toEqual(cached);
  });
});

describe("useTabsStore moveTab", () => {
  it("moves the dragged tab to sit where the target tab currently is, local-only", () => {
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
        { id: "3", name: "Gamma", position: 2 },
      ],
      activeTabId: "1",
    });

    useTabsStore.getState().moveTab("1", "3");

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["2", "3", "1"]);
    expect(invoke).not.toHaveBeenCalledWith("tab_reorder", expect.anything());
  });

  it("is a no-op when dragging a tab onto itself", () => {
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    useTabsStore.getState().moveTab("1", "1");

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["1", "2"]);
  });
});

describe("useTabsStore commitTabOrder", () => {
  it("persists the current tab order via tab_reorder", async () => {
    setInvokeHandlers({ tab_reorder: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "2", name: "Beta", position: 0 },
        { id: "1", name: "Alpha", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().commitTabOrder();

    expect(invoke).toHaveBeenCalledWith("tab_reorder", { ids: ["2", "1"] });
  });

  it("sets an error when the backend call fails", async () => {
    setInvokeHandlers({
      tab_reorder: () => {
        throw new Error("reorder failed");
      },
    });
    useTabsStore.setState({ tabs: [{ id: "1", name: "Alpha", position: 0 }], activeTabId: "1" });

    await useTabsStore.getState().commitTabOrder();

    expect(useTabsStore.getState().error).toBe("reorder failed");
  });
});
