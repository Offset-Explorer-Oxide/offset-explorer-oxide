import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setInvokeHandlers } from "../../lib/testInvoke";
import {
  useConnect,
  useConnectionConnected,
  useConnectionsQuery,
  useDeleteConnection,
  useDisconnect,
  useExportConnections,
  useImportConnections,
  useUpdateConnection,
} from "./useConnections";
import { sampleNewConnection } from "./connectionTestFixtures";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const newConnection = sampleNewConnection();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateConnection", () => {
  it("calls connection_update with the id and updated fields", async () => {
    const updated = { id: "1", ...newConnection, createdAt: "now", updatedAt: "now" };
    const connectionUpdate = vi.fn(() => updated);
    setInvokeHandlers({ connection_update: connectionUpdate });

    const { result } = renderHook(() => useUpdateConnection(), { wrapper: createWrapper() });

    result.current.mutate({ id: "1", connection: newConnection, touchedSecrets: ["sasl_password"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionUpdate).toHaveBeenCalledWith({
      id: "1",
      newConnection,
      touchedSecrets: ["sasl_password"],
    });
  });
});

describe("useConnectionConnected", () => {
  it("reflects the connection_is_connected result", async () => {
    setInvokeHandlers({ connection_is_connected: () => true });

    const { result } = renderHook(() => useConnectionConnected("1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("defaults to false before the query resolves", () => {
    setInvokeHandlers({ connection_is_connected: () => true });
    const { result } = renderHook(() => useConnectionConnected("1"), { wrapper: createWrapper() });
    expect(result.current.data).toBe(false);
  });
});

describe("useConnect", () => {
  it("calls connection_connect with the id and returns the resulting status", async () => {
    const connectionConnect = vi.fn(() => "REACHABLE");
    setInvokeHandlers({ connection_connect: connectionConnect });

    const { result } = renderHook(() => useConnect("1"), { wrapper: createWrapper() });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionConnect).toHaveBeenCalledWith({ id: "1" });
    expect(result.current.data).toBe("REACHABLE");
  });
});

describe("useDisconnect", () => {
  it("calls connection_disconnect with the id", async () => {
    const connectionDisconnect = vi.fn(() => undefined);
    setInvokeHandlers({ connection_disconnect: connectionDisconnect });

    const { result } = renderHook(() => useDisconnect(), { wrapper: createWrapper() });
    result.current.mutate("1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionDisconnect).toHaveBeenCalledWith({ id: "1" });
  });
});

describe("useDeleteConnection", () => {
  it("clears the deleted connection's selection and viewed message from the workspace", async () => {
    const connectionDelete = vi.fn(() => undefined);
    setInvokeHandlers({ connection_delete: connectionDelete });
    const clearSelectionForConnection = vi.spyOn(useWorkspaceSelectionStore.getState(), "clearForConnection");
    const clearMessageForConnection = vi.spyOn(useMessageViewerStore.getState(), "clearForConnection");

    const { result } = renderHook(() => useDeleteConnection(), { wrapper: createWrapper() });
    result.current.mutate("conn-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clearSelectionForConnection).toHaveBeenCalledWith("conn-1");
    expect(clearMessageForConnection).toHaveBeenCalledWith("conn-1");
  });
});

describe("useExportConnections", () => {
  it("calls connections_export with the given ids and path", async () => {
    const connectionsExport = vi.fn(() => undefined);
    setInvokeHandlers({ connections_export: connectionsExport });

    const { result } = renderHook(() => useExportConnections(), { wrapper: createWrapper() });
    result.current.mutate({ ids: ["1"], path: "/tmp/export.json" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionsExport).toHaveBeenCalledWith({ ids: ["1"], path: "/tmp/export.json" });
  });

  it("passes null ids through for an export-all", async () => {
    const connectionsExport = vi.fn(() => undefined);
    setInvokeHandlers({ connections_export: connectionsExport });

    const { result } = renderHook(() => useExportConnections(), { wrapper: createWrapper() });
    result.current.mutate({ ids: null, path: "/tmp/all.json" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionsExport).toHaveBeenCalledWith({ ids: null, path: "/tmp/all.json" });
  });
});

describe("useImportConnections", () => {
  it("calls connections_import with the path and returns the summary", async () => {
    const connectionsImport = vi.fn(() => ({ imported: 2, skipped: 1 }));
    setInvokeHandlers({ connections_import: connectionsImport });

    const { result } = renderHook(() => useImportConnections(), { wrapper: createWrapper() });
    result.current.mutate("/tmp/import.json");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(connectionsImport).toHaveBeenCalledWith({ path: "/tmp/import.json" });
    expect(result.current.data).toEqual({ imported: 2, skipped: 1 });
  });

  it("invalidates the connections list on success", async () => {
    const connectionList = vi.fn(() => []);
    setInvokeHandlers({ connection_list: connectionList, connections_import: () => ({ imported: 1, skipped: 0 }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result: listResult } = renderHook(() => useConnectionsQuery(), { wrapper });
    await waitFor(() => expect(listResult.current.isSuccess).toBe(true));
    expect(connectionList).toHaveBeenCalledTimes(1);

    const { result: importResult } = renderHook(() => useImportConnections(), { wrapper });
    importResult.current.mutate("/tmp/import.json");
    await waitFor(() => expect(importResult.current.isSuccess).toBe(true));

    await waitFor(() => expect(connectionList).toHaveBeenCalledTimes(2));
  });
});
