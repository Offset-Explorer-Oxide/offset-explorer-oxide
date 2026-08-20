import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { PartitionReplicasTab } from "./PartitionReplicasTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let lastGridProps: { rowData: unknown[] } | null = null;
vi.mock("ag-grid-react", () => ({
  AgGridReact: (props: { rowData: unknown[] }) => {
    lastGridProps = props;
    return null;
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  lastGridProps = null;
});

describe("PartitionReplicasTab", () => {
  it("shows the partition's replicas as id/node rows in the grid", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [{ id: 0, leader: 1, replicas: [1, 2, 3], isr: [1, 2, 3], lowOffset: 0, highOffset: 0 }],
    });
    renderWithClient(<PartitionReplicasTab connectionId="1" topicName="orders" partitionId={0} />);

    await screen.findByTestId("replicas-grid");
    expect(lastGridProps?.rowData).toEqual([
      { id: 0, node: 1 },
      { id: 1, node: 2 },
      { id: 2, node: 3 },
    ]);
  });

  it("shows a not-found message when the partition doesn't exist in the fetched list", async () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionReplicasTab connectionId="1" topicName="orders" partitionId={0} />);

    expect(await screen.findByText("Partition not found.")).toBeInTheDocument();
  });
});
