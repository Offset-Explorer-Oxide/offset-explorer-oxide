import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspaceSelectionStore } from "./useWorkspaceSelectionStore";

beforeEach(() => {
  useWorkspaceSelectionStore.setState({ selection: null, activeTabId: null, byTab: {} });
});

describe("useWorkspaceSelectionStore", () => {
  it("starts with nothing selected", () => {
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("selects a connection", () => {
    useWorkspaceSelectionStore.getState().selectConnection("conn-1", "Local Kafka");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "connection",
      id: "conn-1",
      name: "Local Kafka",
    });
  });

  it("replaces the previous selection when a different connection is selected", () => {
    useWorkspaceSelectionStore.getState().selectConnection("conn-1", "Local Kafka");
    useWorkspaceSelectionStore.getState().selectConnection("conn-2", "Staging Kafka");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "connection",
      id: "conn-2",
      name: "Staging Kafka",
    });
  });

  it("clears the selection", () => {
    useWorkspaceSelectionStore.getState().selectConnection("conn-1", "Local Kafka");
    useWorkspaceSelectionStore.getState().clearSelection();
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("selects a broker", () => {
    useWorkspaceSelectionStore.getState().selectBroker("conn-1", 3);
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "broker",
      connectionId: "conn-1",
      brokerId: 3,
    });
  });

  it("selects a topic", () => {
    useWorkspaceSelectionStore.getState().selectTopic("conn-1", "orders");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-1",
      topicName: "orders",
    });
  });

  it("selects a partition", () => {
    useWorkspaceSelectionStore.getState().selectPartition("conn-1", "orders", 2);
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "partition",
      connectionId: "conn-1",
      topicName: "orders",
      partitionId: 2,
    });
  });

  it("selects a consumer group", () => {
    useWorkspaceSelectionStore.getState().selectConsumerGroup("conn-1", "billing");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "consumerGroup",
      connectionId: "conn-1",
      groupId: "billing",
    });
  });

  it("replaces a broker selection with a topic selection", () => {
    useWorkspaceSelectionStore.getState().selectBroker("conn-1", 3);
    useWorkspaceSelectionStore.getState().selectTopic("conn-1", "orders");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-1",
      topicName: "orders",
    });
  });
});

describe("useWorkspaceSelectionStore per-tab isolation", () => {
  it("keeps each tab's selection independent", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.setActiveTab("tab-1");
    store.selectTopic("conn-1", "orders");

    store.setActiveTab("tab-2");
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
    store.selectTopic("conn-1", "payments");

    store.setActiveTab("tab-1");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-1",
      topicName: "orders",
    });

    store.setActiveTab("tab-2");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-1",
      topicName: "payments",
    });
  });

  it("clearTabMemory resets the active tab's selection without touching other tabs", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.setActiveTab("tab-1");
    store.selectTopic("conn-1", "orders");
    store.setActiveTab("tab-2");
    store.selectTopic("conn-1", "payments");

    store.clearTabMemory();
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();

    store.setActiveTab("tab-1");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-1",
      topicName: "orders",
    });
  });

  it("clearTabMemory can target a specific, non-active tab", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.setActiveTab("tab-1");
    store.selectTopic("conn-1", "orders");

    store.clearTabMemory("tab-1");

    store.setActiveTab("tab-1");
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });
});

describe("useWorkspaceSelectionStore clearForConnection", () => {
  it("clears the active selection when it belongs to the deleted connection", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.selectConnection("conn-1", "Local Kafka");

    store.clearForConnection("conn-1");

    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("clears a child selection (topic/broker/etc.) belonging to the deleted connection", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.selectTopic("conn-1", "orders");

    store.clearForConnection("conn-1");

    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("leaves the selection alone when it belongs to a different connection", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.selectTopic("conn-2", "orders");

    store.clearForConnection("conn-1");

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-2",
      topicName: "orders",
    });
  });

  it("clears every tab's cached selection for the deleted connection, not just the active tab", () => {
    const store = useWorkspaceSelectionStore.getState();
    store.setActiveTab("tab-1");
    store.selectTopic("conn-1", "orders");
    store.setActiveTab("tab-2");
    store.selectTopic("conn-2", "payments");

    store.clearForConnection("conn-1");

    store.setActiveTab("tab-1");
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();

    store.setActiveTab("tab-2");
    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "conn-2",
      topicName: "payments",
    });
  });
});
