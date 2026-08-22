import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLogsStore } from "./useLogsStore";
import { BottomPanel, formatTabMemory } from "./BottomPanel";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, useTabDataStore } from "../workspace/useTabDataStore";

let capturedHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: (event: { payload: unknown }) => void) => {
    capturedHandler = handler;
    return Promise.resolve(() => {});
  }),
}));

beforeEach(() => {
  localStorage.clear();
  useLogsStore.setState({ entries: [], isExpanded: false });
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
  useWorkspaceSelectionStore.setState({ selection: null, activeTabId: null, byTab: {} });
  useMessageViewerStore.setState({ message: null, activeTabId: null, byTab: {} });
  useTabDataStore.setState({ messagesByTab: {}, totalMatchingByTab: {} });
  capturedHandler = null;
});

describe("BottomPanel logs tool", () => {
  it("is collapsed by default", () => {
    render(<BottomPanel />);
    expect(screen.queryByText("No log entries yet.")).not.toBeInTheDocument();
  });

  it("expands when the toggle icon is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Toggle logs panel"));

    expect(screen.getByText("No log entries yet.")).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Toggle logs panel"));
    await user.click(screen.getByLabelText("Toggle logs panel"));

    expect(screen.queryByText("No log entries yet.")).not.toBeInTheDocument();
  });

  it("renders a log entry pushed over the tauri event channel once expanded", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);
    await user.click(screen.getByLabelText("Toggle logs panel"));

    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());
    capturedHandler!({
      payload: {
        timestamp: "2026-08-18T00:00:00Z",
        level: "info",
        message: 'Created connection "Local Kafka"',
      },
    });

    expect(await screen.findByText('Created connection "Local Kafka"')).toBeInTheDocument();
  });
});

describe("formatTabMemory", () => {
  it("formats a byte count as megabytes with two decimal places", () => {
    expect(formatTabMemory(0)).toBe("0.00 MB");
    expect(formatTabMemory(1024 * 1024)).toBe("1.00 MB");
    expect(formatTabMemory(512 * 1024)).toBe("0.50 MB");
  });
});

describe("BottomPanel tab memory", () => {
  it("shows 0.00 MB when the active tab has nothing cached", () => {
    render(<BottomPanel />);
    expect(screen.getByText("Tab memory: 0.00 MB")).toBeInTheDocument();
  });

  it("reflects the active tab's cached Data tab rows as a byte-size estimate", () => {
    const cached = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    useTabsStore.setState({ activeTabId: "tab-1" });
    useTabDataStore.setState({ messagesByTab: { [dataTabCacheKey("tab-1", "1", "orders")]: cached } });

    render(<BottomPanel />);

    const expectedBytes = JSON.stringify(cached).length + JSON.stringify(null).length;
    expect(screen.getByText(`Tab memory: ${formatTabMemory(expectedBytes)}`)).toBeInTheDocument();
  });

  it("sums every topic (and partition) the active tab has ever fetched, regardless of which one is currently selected", () => {
    useTabsStore.setState({ activeTabId: "tab-1" });
    useWorkspaceSelectionStore.setState({
      selection: { type: "topic", connectionId: "1", topicName: "orders" },
    });
    const orders = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    const payments = [
      { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
      { partition: 0, offset: 2, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
    ];
    const partitionZero = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    useTabDataStore.setState({
      messagesByTab: {
        [dataTabCacheKey("tab-1", "1", "orders")]: orders,
        [dataTabCacheKey("tab-1", "1", "payments")]: payments,
        [dataTabCacheKey("tab-1", "1", "orders", 0)]: partitionZero,
      },
    });

    render(<BottomPanel />);

    const expectedBytes =
      JSON.stringify(orders).length +
      JSON.stringify(payments).length +
      JSON.stringify(partitionZero).length +
      JSON.stringify(null).length;
    expect(screen.getByText(`Tab memory: ${formatTabMemory(expectedBytes)}`)).toBeInTheDocument();
  });

  it("does not switch to 0.00 MB when navigating away from the topic that was viewed when it was fetched", () => {
    useTabsStore.setState({ activeTabId: "tab-1" });
    const cached = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    useTabDataStore.setState({ messagesByTab: { [dataTabCacheKey("tab-1", "1", "orders")]: cached } });
    // No selection at all — as if the user switched to a different topic
    // (or nothing) after fetching "orders". The old, per-selection
    // implementation would show 0.00 MB here; the fix must not.
    useWorkspaceSelectionStore.setState({ selection: null });

    render(<BottomPanel />);

    const expectedBytes = JSON.stringify(cached).length + JSON.stringify(null).length;
    expect(screen.getByText(`Tab memory: ${formatTabMemory(expectedBytes)}`)).toBeInTheDocument();
  });

  it("only reflects the active tab's own cached data, not another tab's", () => {
    useTabsStore.setState({ activeTabId: "tab-1" });
    useTabDataStore.setState({
      messagesByTab: {
        [dataTabCacheKey("tab-2", "1", "orders")]: [
          { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
        ],
      },
    });

    render(<BottomPanel />);

    expect(screen.getByText("Tab memory: 0.00 MB")).toBeInTheDocument();
  });

  it("clears every cached topic/partition for the active tab, plus its selection and message viewer, when Clear memory is clicked", async () => {
    useTabsStore.setState({ activeTabId: "tab-1" });
    useWorkspaceSelectionStore.setState({
      activeTabId: "tab-1",
      selection: { type: "topic", connectionId: "1", topicName: "orders" },
      byTab: { "tab-1": { type: "topic", connectionId: "1", topicName: "orders" } },
    });
    useMessageViewerStore.setState({
      activeTabId: "tab-1",
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
      byTab: {
        "tab-1": {
          message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
          connectionId: "1",
          topic: "orders",
        },
      },
    });
    const ordersKey = dataTabCacheKey("tab-1", "1", "orders");
    const paymentsKey = dataTabCacheKey("tab-1", "1", "payments");
    const otherTabKey = dataTabCacheKey("tab-2", "1", "orders");
    useTabDataStore.setState({
      messagesByTab: {
        [ordersKey]: [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }],
        [paymentsKey]: [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }],
        [otherTabKey]: [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }],
      },
    });
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Clear tab memory"));

    expect(screen.getByText("Tab memory: 0.00 MB")).toBeInTheDocument();
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useTabDataStore.getState().messagesByTab[ordersKey]).toBeUndefined();
    expect(useTabDataStore.getState().messagesByTab[paymentsKey]).toBeUndefined();
    expect(useTabDataStore.getState().messagesByTab[otherTabKey]).toBeDefined();
  });

  it("asks the backend to trim the OS-visible working set when Clear memory is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Clear tab memory"));

    expect(invoke).toHaveBeenCalledWith("trim_process_memory", undefined);
  });
});
