import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ClusterDetailPanel } from "./ClusterDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function sampleConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "1",
    name: "Local Kafka",
    bootstrapServers: "localhost:9092",
    kafkaVersion: "3.7",
    zookeeperEnabled: false,
    zookeeperHost: null,
    zookeeperPort: null,
    zookeeperChrootPath: null,
    securityProtocol: "PLAINTEXT",
    saslMechanism: null,
    saslOauthUrl: null,
    schemaRegistryEndpoint: null,
    schemaRegistryTrustStoreLocation: null,
    schemaRegistryKeystoreLocation: null,
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClusterDetailPanel", () => {
  it("shows the connection's name pre-filled in the Cluster name field", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
    });
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    expect(await screen.findByLabelText("Cluster name")).toHaveValue("Local Kafka");
  });

  it("shows Reconnect, Disconnect, and Update buttons", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
    });
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    await screen.findByLabelText("Cluster name");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("starts with the Update button disabled", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
    });
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    await screen.findByLabelText("Cluster name");
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("enables Update once a field is changed, and disables it again if reverted", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    const nameInput = await screen.findByLabelText("Cluster name");
    await user.type(nameInput, "!");
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();

    await user.type(nameInput, "{Backspace}");
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("leaves fields enabled while not connected", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
    });
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    await screen.findByLabelText("Cluster name");
    expect(screen.getByLabelText("Bootstrap servers")).toBeEnabled();
  });

  it("disables every field except Cluster name while connected", async () => {
    const isConnected = vi.fn(() => true);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: isConnected,
    });
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    await screen.findByLabelText("Cluster name");
    await waitFor(() => expect(isConnected).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText("Bootstrap servers")).toBeDisabled());
    expect(screen.getByLabelText("Cluster name")).toBeEnabled();
  });

  it("calls connection_connect with the id when Reconnect is clicked", async () => {
    const connect = vi.fn(() => "REACHABLE");
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
      connection_connect: connect,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterDetailPanel connectionId="1" />);
    await screen.findByLabelText("Cluster name");

    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith({ id: "1" }));
  });

  it("calls connection_disconnect with the id when Disconnect is clicked", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
      connection_disconnect: disconnect,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterDetailPanel connectionId="1" />);
    await screen.findByLabelText("Cluster name");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ id: "1" }));
  });

  it("calls connection_update with the id and updated fields when Update is clicked, then disables Update again", async () => {
    const updated = sampleConnection({ name: "Renamed" });
    const update = vi.fn((_args: { id: string }) => updated);
    setInvokeHandlers({
      connection_list: () => [sampleConnection()],
      connection_is_connected: () => false,
      connection_update: update,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    const nameInput = await screen.findByLabelText("Cluster name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ id: "1" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Update" })).toBeDisabled());
  });

  it("does not report the SASL password as touched when only an unrelated field is edited", async () => {
    // Regression test: secret fields always render blank on load, matching
    // the blank field in the loaded snapshot — editing some other field and
    // clicking Update must not touch (and so must not wipe) the SASL
    // password already stored in the OS keychain.
    const updated = sampleConnection({ name: "Renamed", securityProtocol: "SASL_SSL", saslMechanism: "PLAIN" });
    const update = vi.fn((_args: { id: string }) => updated);
    setInvokeHandlers({
      connection_list: () => [sampleConnection({ securityProtocol: "SASL_SSL", saslMechanism: "PLAIN" })],
      connection_is_connected: () => false,
      connection_update: update,
    });
    const user = userEvent.setup();
    renderWithClient(<ClusterDetailPanel connectionId="1" />);

    const nameInput = await screen.findByLabelText("Cluster name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ id: "1", touchedSecrets: [] });
  });
});
