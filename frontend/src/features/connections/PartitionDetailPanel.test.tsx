import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { PartitionDetailPanel } from "./PartitionDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("PartitionDetailPanel", () => {
  it("shows the topic name and partition id in the header", () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={2} />);

    expect(screen.getByRole("heading", { name: "orders · Partition 2" })).toBeInTheDocument();
  });

  it("opens on the Data tab by default, pre-filling and disabling the partition filter", () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={2} />);

    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Partition filter")).toHaveValue("2");
    expect(screen.getByLabelText("Partition filter")).toBeDisabled();
  });

  it("renders Properties, Data, and Replicas tabs", () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    expect(screen.getByRole("tab", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Replicas" })).toBeInTheDocument();
  });

  it("switches to the Properties tab when clicked", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [{ id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 }],
    });
    const user = userEvent.setup();
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(screen.getByRole("tab", { name: "Properties" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Id")).toHaveValue("0");
  });

  it("updates the Data tab's partition filter when switching to a different partition while already on Data", () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Partition filter")).toHaveValue("0");

    rerender(
      <QueryClientProvider client={client}>
        <PartitionDetailPanel connectionId="1" topicName="orders" partitionId={1} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Partition filter")).toHaveValue("1");
  });

  it("switches to the Replicas tab when clicked", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [{ id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 }],
    });
    const user = userEvent.setup();
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    await user.click(screen.getByRole("tab", { name: "Replicas" }));

    expect(screen.getByRole("tab", { name: "Replicas" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("replicas-grid")).toBeInTheDocument();
  });
});
