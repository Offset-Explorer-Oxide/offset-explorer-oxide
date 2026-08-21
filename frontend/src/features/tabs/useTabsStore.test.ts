import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useTabsStore } from "./useTabsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
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
    setInvokeHandlers({ tab_delete: () => undefined });
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
    setInvokeHandlers({ tab_delete: () => undefined });
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
    setInvokeHandlers({ tab_delete: () => undefined });
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
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().activeTabId).toBeNull();
  });

  it("leaves activeTabId unchanged when closing a non-active tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
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
