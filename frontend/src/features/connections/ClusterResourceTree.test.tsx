import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ClusterResourceTree } from "./ClusterResourceTree";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceSelectionStore.setState({ selection: null });
});

describe("ClusterResourceTree", () => {
  it("renders Brokers, Topics, and Consumers category headers", () => {
    setInvokeHandlers({});
    renderWithClient(<ClusterResourceTree connectionId="1" />);

    expect(screen.getByTestId("category-Brokers")).toBeInTheDocument();
    expect(screen.getByTestId("category-Topics")).toBeInTheDocument();
    expect(screen.getByTestId("category-Consumers")).toBeInTheDocument();
  });

  it("eagerly fetches brokers, topics, and consumer groups on mount, without needing any category expanded first", async () => {
    const listBrokers = vi.fn(() => []);
    const listTopics = vi.fn(() => []);
    const listConsumerGroups = vi.fn(() => []);
    setInvokeHandlers({
      connection_list_brokers: listBrokers,
      connection_list_topics: listTopics,
      connection_list_consumer_groups: listConsumerGroups,
    });
    renderWithClient(<ClusterResourceTree connectionId="1" />);

    await waitFor(() => expect(listBrokers).toHaveBeenCalledWith({ id: "1" }));
    await waitFor(() => expect(listTopics).toHaveBeenCalledWith({ id: "1" }));
    await waitFor(() => expect(listConsumerGroups).toHaveBeenCalledWith({ id: "1" }));
  });

  it("fetches and shows brokers once Brokers is expanded", async () => {
    const listBrokers = vi.fn(() => [{ id: 1, host: "broker1", port: 9092 }]);
    setInvokeHandlers({ connection_list_brokers: listBrokers });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);

    await user.click(screen.getByTestId("category-Brokers"));

    await waitFor(() => expect(listBrokers).toHaveBeenCalledWith({ id: "1" }));
    expect(await screen.findByText("1 — broker1:9092")).toBeInTheDocument();
  });

  it("selects a broker into the workspace store when clicked", async () => {
    setInvokeHandlers({ connection_list_brokers: () => [{ id: 1, host: "broker1", port: 9092 }] });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Brokers"));
    await screen.findByText("1 — broker1:9092");

    await user.click(screen.getByText("1 — broker1:9092"));

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "broker",
      connectionId: "1",
      brokerId: 1,
    });
  });

  it("fetches and shows topics once Topics is expanded", async () => {
    const listTopics = vi.fn(() => [{ name: "orders", partitionCount: 3 }]);
    setInvokeHandlers({ connection_list_topics: listTopics });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);

    await user.click(screen.getByTestId("category-Topics"));

    await waitFor(() => expect(listTopics).toHaveBeenCalledWith({ id: "1" }));
    expect(await screen.findByText("orders")).toBeInTheDocument();
  });

  it("selects a topic into the workspace store when clicked", async () => {
    setInvokeHandlers({ connection_list_topics: () => [{ name: "orders", partitionCount: 3 }] });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");

    await user.click(screen.getByText("orders"));

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "topic",
      connectionId: "1",
      topicName: "orders",
    });
  });

  it("does not fetch a topic's partitions until it is expanded", async () => {
    const listPartitions = vi.fn(() => [{ id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 }]);
    setInvokeHandlers({
      connection_list_topics: () => [{ name: "orders", partitionCount: 3 }],
      connection_list_partitions: listPartitions,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");

    expect(listPartitions).not.toHaveBeenCalled();
  });

  it("expands a topic to show its partitions when its caret is clicked", async () => {
    setInvokeHandlers({
      connection_list_topics: () => [{ name: "orders", partitionCount: 3 }],
      connection_list_partitions: () => [
        { id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 10 },
        { id: 1, leader: 2, replicas: [2], isr: [2], lowOffset: 0, highOffset: 5 },
      ],
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");

    await user.click(screen.getByLabelText("Expand orders"));

    expect(await screen.findByText("Partition 0")).toBeInTheDocument();
    expect(screen.getByText("Partition 1")).toBeInTheDocument();
  });

  it("selects a partition into the workspace store when clicked", async () => {
    setInvokeHandlers({
      connection_list_topics: () => [{ name: "orders", partitionCount: 3 }],
      connection_list_partitions: () => [
        { id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 10 },
      ],
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");
    await user.click(screen.getByLabelText("Expand orders"));
    await screen.findByText("Partition 0");

    await user.click(screen.getByText("Partition 0"));

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "partition",
      connectionId: "1",
      topicName: "orders",
      partitionId: 0,
    });
  });

  it("marks the selected partition row visually", async () => {
    setInvokeHandlers({
      connection_list_topics: () => [{ name: "orders", partitionCount: 3 }],
      connection_list_partitions: () => [
        { id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 10 },
      ],
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");
    await user.click(screen.getByLabelText("Expand orders"));
    await screen.findByText("Partition 0");

    await user.click(screen.getByText("Partition 0"));

    expect(screen.getByTestId("resource-item-partition-orders-0").className).toContain(
      "topic-partition-item--selected",
    );
  });

  it("does not select the topic as a side effect of expanding it", async () => {
    setInvokeHandlers({
      connection_list_topics: () => [{ name: "orders", partitionCount: 3 }],
      connection_list_partitions: () => [],
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Topics"));
    await screen.findByText("orders");

    await user.click(screen.getByLabelText("Expand orders"));

    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("fetches and shows consumer groups once Consumers is expanded", async () => {
    const listGroups = vi.fn(() => [{ groupId: "billing", state: "Stable" }]);
    setInvokeHandlers({ connection_list_consumer_groups: listGroups });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);

    await user.click(screen.getByTestId("category-Consumers"));

    await waitFor(() => expect(listGroups).toHaveBeenCalledWith({ id: "1" }));
    expect(await screen.findByText("billing")).toBeInTheDocument();
  });

  it("selects a consumer group into the workspace store when clicked", async () => {
    setInvokeHandlers({ connection_list_consumer_groups: () => [{ groupId: "billing", state: "Stable" }] });
    const user = userEvent.setup();
    renderWithClient(<ClusterResourceTree connectionId="1" />);
    await user.click(screen.getByTestId("category-Consumers"));
    await screen.findByText("billing");

    await user.click(screen.getByText("billing"));

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "consumerGroup",
      connectionId: "1",
      groupId: "billing",
    });
  });
});
