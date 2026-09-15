import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { PartitionDetailPanel } from "./PartitionDetailPanel";
import { usePartitionPanelTabStore } from "./usePartitionPanelTabStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// The active sub-tab now lives in a store (so the tree's "Publish messages…"
// can open this panel onto Publish), which means it survives between tests
// unless reset.
beforeEach(() => {
  usePartitionPanelTabStore.setState({ activeByTab: {} });
});

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

  it("renders Properties, Data, Replicas and Publish tabs, with Publish last", () => {
    setInvokeHandlers({ connection_list_partitions: () => [] });
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    // Order matters: Publish is the only tab that writes to the cluster, and it
    // is kept at the far end, away from Data — the tab this panel opens on.
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Properties",
      "Data",
      "Replicas",
      "Publish",
    ]);
  });

  it("switches to the Publish tab when clicked", async () => {
    setInvokeHandlers({
      connection_list_partitions: () => [],
      connection_list: () => [],
      connection_is_connected: () => false,
      connection_write_denied_reason: () => null,
    });
    const user = userEvent.setup();
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    await user.click(screen.getByRole("tab", { name: "Publish" }));

    expect(screen.getByRole("tab", { name: "Publish" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens straight onto Publish when the store already says so", async () => {
    // What the tree's right-click "Publish messages…" does: set the sub-tab,
    // then select the partition. The panel has to honour it on first render.
    usePartitionPanelTabStore.getState().set("no-tab", "publish");
    setInvokeHandlers({
      connection_list_partitions: () => [],
      connection_list: () => [],
      connection_is_connected: () => false,
      connection_write_denied_reason: () => null,
    });
    renderWithClient(<PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />);

    expect(screen.getByRole("tab", { name: "Publish" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the chosen sub-tab when the selected partition changes", async () => {
    // Previously local `useState`, so switching partitions silently threw the
    // choice away and dropped the user back on Data.
    setInvokeHandlers({
      connection_list_partitions: () => [{ id: 0, leader: 1, replicas: [1], isr: [1], lowOffset: 0, highOffset: 0 }],
    });
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PartitionDetailPanel connectionId="1" topicName="orders" partitionId={0} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "Replicas" }));
    rerender(
      <QueryClientProvider client={client}>
        <PartitionDetailPanel connectionId="1" topicName="orders" partitionId={1} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Replicas" })).toHaveAttribute("aria-selected", "true");
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
