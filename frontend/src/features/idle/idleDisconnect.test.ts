import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { disconnectAllConnections } from "./idleDisconnect";
import { useLogsStore } from "../bottom-panel/useLogsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function sampleConnection(id: string, name: string) {
  return {
    id,
    name,
    bootstrapServers: "localhost:9092",
    kafkaVersion: "3.7",
    zookeeperEnabled: false,
    zookeeperHost: null,
    zookeeperPort: null,
    zookeeperChrootPath: null,
    securityProtocol: "PLAINTEXT",
    saslMechanism: null,
    saslUsername: null,
    saslPassword: null,
    saslOauthUrl: null,
    schemaRegistryEndpoint: null,
    schemaRegistryBasicAuthCredentials: null,
    schemaRegistryTrustStoreLocation: null,
    schemaRegistryTrustStorePassword: null,
    schemaRegistryKeystoreLocation: null,
    schemaRegistryKeystorePassword: null,
    schemaRegistryKeystoreKeyPassword: null,
    sslTruststoreLocation: null,
    sslTruststorePassword: null,
    sslKeystoreLocation: null,
    sslKeystorePassword: null,
    sslKeystoreKeyPassword: null,
    createdAt: "now",
    updatedAt: "now",
  };
}

beforeEach(() => {
  useLogsStore.setState({ entries: [] });
});

describe("disconnectAllConnections", () => {
  it("disconnects every connection currently reported as connected", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [sampleConnection("1", "prod"), sampleConnection("2", "staging")],
      connection_is_connected: ({ id }) => id === "1",
      connection_disconnect: disconnect,
    });
    const queryClient = new QueryClient();

    await disconnectAllConnections(queryClient);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith({ id: "1" });
  });

  it("does nothing when no connection is currently connected", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [sampleConnection("1", "prod")],
      connection_is_connected: () => false,
      connection_disconnect: disconnect,
    });
    const queryClient = new QueryClient();

    await disconnectAllConnections(queryClient);

    expect(disconnect).not.toHaveBeenCalled();
    expect(useLogsStore.getState().entries).toHaveLength(0);
  });

  it("invalidates the connected/status queries for each disconnected connection", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection("1", "prod")],
      connection_is_connected: () => true,
      connection_disconnect: () => undefined,
    });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await disconnectAllConnections(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["connection-connected", "1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["connection-status", "1"] });
  });

  it("logs a user-visible entry naming every connection it disconnected", async () => {
    setInvokeHandlers({
      connection_list: () => [sampleConnection("1", "prod"), sampleConnection("2", "staging")],
      connection_is_connected: () => true,
      connection_disconnect: () => undefined,
    });
    const queryClient = new QueryClient();

    await disconnectAllConnections(queryClient);

    expect(useLogsStore.getState().entries).toHaveLength(1);
    expect(useLogsStore.getState().entries[0].message).toContain("prod, staging");
    expect(useLogsStore.getState().entries[0].message).toContain("120 minutes");
  });
});
