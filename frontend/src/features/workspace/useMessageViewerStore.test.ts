import { beforeEach, describe, expect, it } from "vitest";
import { useMessageViewerStore } from "./useMessageViewerStore";

const sample = { partition: 0, offset: 1, timestampMs: 123, keyBase64: "k", payloadBase64: "eA==", headers: [] };

beforeEach(() => {
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null, activeTabId: null, byTab: {} });
});

describe("useMessageViewerStore", () => {
  it("starts with no message selected", () => {
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();
    expect(useMessageViewerStore.getState().topic).toBeNull();
  });

  it("shows the selected message alongside the connection and topic it came from", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders");

    expect(useMessageViewerStore.getState().message).toEqual(sample);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-1");
    expect(useMessageViewerStore.getState().topic).toBe("orders");
  });

  it("clears the selection", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders");
    useMessageViewerStore.getState().clear();

    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();
    expect(useMessageViewerStore.getState().topic).toBeNull();
  });

  it("leaves partitionId undefined when a message is viewed from a topic-wide Data tab", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders");
    expect(useMessageViewerStore.getState().partitionId).toBeUndefined();
  });

  it("records partitionId when a message is viewed from a partition's own Data tab", () => {
    useMessageViewerStore.getState().viewMessage(sample, "conn-1", "orders", 2);
    expect(useMessageViewerStore.getState().partitionId).toBe(2);
  });
});

describe("useMessageViewerStore per-tab isolation", () => {
  const other = { partition: 1, offset: 9, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] };

  it("keeps each tab's viewed message independent", () => {
    const store = useMessageViewerStore.getState();
    store.setActiveTab("tab-1");
    store.viewMessage(sample, "conn-1", "orders");

    store.setActiveTab("tab-2");
    expect(useMessageViewerStore.getState().message).toBeNull();
    store.viewMessage(other, "conn-2", "payments");

    store.setActiveTab("tab-1");
    expect(useMessageViewerStore.getState().message).toEqual(sample);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-1");

    store.setActiveTab("tab-2");
    expect(useMessageViewerStore.getState().message).toEqual(other);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-2");
  });

  it("clearTabMemory resets the active tab's message without touching other tabs", () => {
    const store = useMessageViewerStore.getState();
    store.setActiveTab("tab-1");
    store.viewMessage(sample, "conn-1", "orders");
    store.setActiveTab("tab-2");
    store.viewMessage(other, "conn-2", "payments");

    store.clearTabMemory();
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();

    store.setActiveTab("tab-1");
    expect(useMessageViewerStore.getState().message).toEqual(sample);
  });
});

describe("useMessageViewerStore clearForConnection", () => {
  it("clears every tab's viewed message for the deleted connection, leaving others untouched", () => {
    const store = useMessageViewerStore.getState();
    store.setActiveTab("tab-1");
    store.viewMessage(sample, "conn-1", "orders");
    store.setActiveTab("tab-2");
    store.viewMessage(sample, "conn-2", "payments");

    store.clearForConnection("conn-1");

    store.setActiveTab("tab-1");
    expect(useMessageViewerStore.getState().message).toBeNull();
    expect(useMessageViewerStore.getState().connectionId).toBeNull();

    store.setActiveTab("tab-2");
    expect(useMessageViewerStore.getState().message).toEqual(sample);
    expect(useMessageViewerStore.getState().connectionId).toBe("conn-2");
  });
});
