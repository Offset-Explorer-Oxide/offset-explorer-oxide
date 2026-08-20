import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { PartitionPropertiesTab } from "./PartitionPropertiesTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartitionPropertiesTab", () => {
  it("shows General (Id, Leader) and Offsets (Start, End, Size) for the selected partition", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [
        { id: 0, leader: 1, replicas: [1, 2], isr: [1, 2], lowOffset: 100, highOffset: 450 },
        { id: 1, leader: 2, replicas: [2, 3], isr: [2, 3], lowOffset: 0, highOffset: 10 },
      ],
    });
    renderWithClient(<PartitionPropertiesTab connectionId="1" topicName="orders" partitionId={0} />);

    expect(await screen.findByLabelText("Id")).toHaveValue("0");
    expect(screen.getByLabelText("Leader")).toHaveValue("1");
    expect(screen.getByLabelText("Start")).toHaveValue("100");
    expect(screen.getByLabelText("End")).toHaveValue("450");
    expect(screen.getByLabelText("Size")).toHaveValue("350");
  });

  it("shows the correct partition when more than one exists", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [
        { id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 },
        { id: 1, leader: 2, replicas: [2], isr: [2], lowOffset: 5, highOffset: 20 },
      ],
    });
    renderWithClient(<PartitionPropertiesTab connectionId="1" topicName="orders" partitionId={1} />);

    expect(await screen.findByLabelText("Id")).toHaveValue("1");
    expect(screen.getByLabelText("Leader")).toHaveValue("2");
  });

  it("disables every field for editing", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [{ id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 }],
    });
    renderWithClient(<PartitionPropertiesTab connectionId="1" topicName="orders" partitionId={0} />);

    expect(await screen.findByLabelText("Id")).toBeDisabled();
    expect(screen.getByLabelText("Leader")).toBeDisabled();
    expect(screen.getByLabelText("Start")).toBeDisabled();
    expect(screen.getByLabelText("End")).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
  });

  it("shows a not-found message when the partition doesn't exist in the fetched list", async () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionPropertiesTab connectionId="1" topicName="orders" partitionId={0} />);

    expect(await screen.findByText("Partition not found.")).toBeInTheDocument();
  });
});
