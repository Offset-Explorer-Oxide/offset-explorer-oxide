import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ConnectionTree } from "./ConnectionTree";
import { connectMutationKey } from "./useConnections";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useTreeUiStore } from "./useTreeUiStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...args: unknown[]) => save(...args) }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function sampleConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "1",
    name: "Local Kafka",
    bootstrapServers: "localhost:9092",
    securityProtocol: "PLAINTEXT",
    saslMechanism: null,
    saslUsername: null,
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceSelectionStore.setState({ selection: null });
  useTreeUiStore.setState({ expanded: {}, searchText: {}, hideEmptyConsumerGroups: {} });
});

describe("ConnectionTree", () => {
  it("shows an empty state when there are no connections", async () => {
    setInvokeHandlers({ connection_list: () => [] });
    renderWithClient(<ConnectionTree />);

    expect(await screen.findByText("No connections yet. Add one to get started.")).toBeInTheDocument();
  });

  it("renders a green status dot only when reachable AND explicitly connected", async () => {
    const checkStatus = vi.fn(() => "REACHABLE");
    const isConnected = vi.fn(() => true);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: checkStatus,
      connection_is_connected: isConnected,
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Local Kafka");
    await waitFor(() => expect(checkStatus).toHaveBeenCalled());
    await waitFor(() => expect(isConnected).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("status-1").className).toContain("status-dot--green");
    });
  });

  it("marks a connection whose credentials the broker rejected with a red dot, whatever the TCP status poll says", async () => {
    // The port is open — the credentials are the problem — so the plain
    // reachability poll would otherwise leave this row looking healthy.
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: () => false,
      connection_auth_block_reason: () => "Invalid username or password",
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Local Kafka");
    await waitFor(() => {
      expect(screen.getByTestId("status-1").className).toContain("status-dot--red");
    });
  });

  it("explains what the broker said when a connection is blocked on authentication", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: () => false,
      connection_auth_block_reason: () => "Invalid username or password",
    });
    renderWithClient(<ConnectionTree />);

    const message = await screen.findByText(/Authentication failed/);
    expect(message).toHaveTextContent("Invalid username or password");
  });

  it("says nothing about authentication for a connection that is not blocked", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: () => true,
      connection_auth_block_reason: () => null,
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Local Kafka");
    expect(screen.queryByText(/Authentication failed/)).not.toBeInTheDocument();
  });

  it("renders a gray status dot when reachable but not yet connected", async () => {
    const checkStatus = vi.fn(() => "REACHABLE");
    const isConnected = vi.fn(() => false);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: checkStatus,
      connection_is_connected: isConnected,
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Local Kafka");
    await waitFor(() => expect(checkStatus).toHaveBeenCalled());
    await waitFor(() => expect(isConnected).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("status-1").className).toContain("status-dot--gray");
    });
    expect(screen.getByTestId("status-1").className).not.toContain("status-dot--green");
  });

  it("renders a red status dot for an unreachable connection, regardless of connected state", async () => {
    const checkStatus = vi.fn(() => "UNREACHABLE");
    setInvokeHandlers({
      connection_list: () => [sampleConnection({ id: "2", name: "Broken Kafka" })],
      connection_check_status: checkStatus,
      connection_is_connected: () => true,
    });
    renderWithClient(<ConnectionTree />);

    await screen.findByText("Broken Kafka");
    await waitFor(() => expect(checkStatus).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("status-2").className).toContain("status-dot--red");
    });
  });

  it("selects the connection in the workspace store when clicked", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "UNKNOWN",
      connection_is_connected: () => false,
    });
    const user = userEvent.setup();
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");

    await user.click(screen.getByTestId("connection-row-1"));

    expect(useWorkspaceSelectionStore.getState().selection).toEqual({
      type: "connection",
      id: "1",
      name: "Local Kafka",
    });
  });

  it("marks the selected connection row visually", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "UNKNOWN",
      connection_is_connected: () => false,
    });
    const user = userEvent.setup();
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");

    await user.click(screen.getByTestId("connection-row-1"));

    expect(screen.getByTestId("connection-row-1")).toHaveClass("connection-row--selected");
  });

  it("does not show an expand toggle for a connection that isn't connected", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "UNKNOWN",
      connection_is_connected: () => false,
    });
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");

    expect(screen.queryByRole("button", { name: "Expand Local Kafka" })).not.toBeInTheDocument();
  });

  it("shows an expand toggle once connected, and expanding it reveals the resource tree", async () => {
    const isConnected = vi.fn(() => true);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: isConnected,
    });
    const user = userEvent.setup();
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");
    await waitFor(() => expect(isConnected).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: "Expand Local Kafka" }));

    expect(screen.getByTestId("resource-tree-1")).toBeVisible();
    expect(screen.getByTestId("category-Brokers")).toBeInTheDocument();
  });

  it("eagerly loads Brokers/Topics/Consumers data as soon as connected, before the row is ever expanded", async () => {
    const isConnected = vi.fn(() => true);
    const listBrokers = vi.fn(() => []);
    const listTopics = vi.fn(() => []);
    const listConsumerGroups = vi.fn(() => []);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: isConnected,
      connection_list_brokers: listBrokers,
      connection_list_topics: listTopics,
      connection_list_consumer_groups: listConsumerGroups,
    });
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");

    await waitFor(() => expect(listBrokers).toHaveBeenCalled());
    await waitFor(() => expect(listTopics).toHaveBeenCalled());
    await waitFor(() => expect(listConsumerGroups).toHaveBeenCalled());
  });

  it("keeps the resource tree hidden (but mounted, already loading) until the row is expanded", async () => {
    const isConnected = vi.fn(() => true);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: isConnected,
      connection_list_brokers: () => [],
      connection_list_topics: () => [],
      connection_list_consumer_groups: () => [],
    });
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");
    await waitFor(() => expect(isConnected).toHaveBeenCalled());

    expect(await screen.findByTestId("resource-tree-1")).not.toBeVisible();
  });

  it("clicking the expand toggle does not change the workspace selection", async () => {
    const isConnected = vi.fn(() => true);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "REACHABLE",
      connection_is_connected: isConnected,
    });
    const user = userEvent.setup();
    renderWithClient(<ConnectionTree />);
    await screen.findByText("Local Kafka");
    await waitFor(() => expect(isConnected).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: "Expand Local Kafka" }));

    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  it("shows a connecting spinner next to the cluster name while a connect mutation for it is in flight", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_check_status: () => "UNKNOWN",
      connection_is_connected: () => false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ConnectionTree />
      </QueryClientProvider>,
    );
    await screen.findByText("Local Kafka");
    expect(screen.queryByRole("status", { name: "Connecting" })).not.toBeInTheDocument();

    let resolveConnect: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    act(() => {
      client
        .getMutationCache()
        .build(client, { mutationKey: connectMutationKey("1"), mutationFn: () => pending })
        .execute(undefined);
    });

    expect(await screen.findByRole("status", { name: "Connecting" })).toBeInTheDocument();

    await act(async () => {
      resolveConnect();
      await pending;
    });

    await waitFor(() => expect(screen.queryByRole("status", { name: "Connecting" })).not.toBeInTheDocument());
  });

  describe("right-click context menu", () => {
    beforeEach(() => {
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
      });
    });

    async function openMenu() {
      const user = userEvent.setup();
      renderWithClient(<ConnectionTree />);
      await screen.findByText("Local Kafka");
      await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("connection-row-1") });
      return user;
    }

    it("shows Reconnect, Disconnect, Clone Connection, Export Connection, and Delete Connection", async () => {
      await openMenu();

      expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Clone Connection" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Export Connection" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete Connection" })).toBeInTheDocument();
    });

    it("does not change the workspace selection when right-clicked", async () => {
      await openMenu();
      expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
    });

    it("calls connection_connect when Reconnect is clicked", async () => {
      const connect = vi.fn(() => "REACHABLE");
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connection_connect: connect,
      });
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Reconnect" }));

      await waitFor(() => expect(connect).toHaveBeenCalledWith({ id: "1" }));
    });

    it("calls connection_disconnect when Disconnect is clicked", async () => {
      const disconnect = vi.fn();
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connection_disconnect: disconnect,
      });
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));

      await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ id: "1" }));
    });

    it("calls onClone with the full connection when Clone Connection is clicked", async () => {
      const onClone = vi.fn();
      const user = userEvent.setup();
      renderWithClient(<ConnectionTree onClone={onClone} />);
      await screen.findByText("Local Kafka");
      await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("connection-row-1") });

      await user.click(screen.getByRole("menuitem", { name: "Clone Connection" }));

      expect(onClone).toHaveBeenCalledWith(expect.objectContaining({ id: "1", name: "Local Kafka" }));
    });

    it("shows a save dialog defaulting to the connection's name and exports it when Export Connection is clicked", async () => {
      const exportFn = vi.fn();
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connections_export: exportFn,
      });
      save.mockResolvedValue("/tmp/Local Kafka.json");
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Export Connection" }));

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: "Local Kafka.json", filters: [{ name: "JSON", extensions: ["json"] }] }),
      );
      await waitFor(() => expect(exportFn).toHaveBeenCalledWith({ ids: ["1"], path: "/tmp/Local Kafka.json" }));
    });

    it("does not export when the save dialog is cancelled", async () => {
      const exportFn = vi.fn();
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connections_export: exportFn,
      });
      save.mockResolvedValue(null);
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Export Connection" }));

      expect(exportFn).not.toHaveBeenCalled();
    });

    it("asks for confirmation and calls connection_delete when Delete Connection is confirmed", async () => {
      const del = vi.fn();
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connection_delete: del,
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Delete Connection" }));

      expect(window.confirm).toHaveBeenCalled();
      await waitFor(() => expect(del).toHaveBeenCalledWith({ id: "1" }));
    });

    it("does not call connection_delete when the confirmation is dismissed", async () => {
      const del = vi.fn();
      setInvokeHandlers({
        connection_list: () => [sampleConnection()],
        connection_check_status: () => "UNKNOWN",
        connection_is_connected: () => false,
        connection_delete: del,
      });
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const user = await openMenu();

      await user.click(screen.getByRole("menuitem", { name: "Delete Connection" }));

      expect(del).not.toHaveBeenCalled();
    });

    it("closes the menu when Escape is pressed", async () => {
      const user = await openMenu();
      expect(screen.getByRole("menu")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
