import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useLogsStore } from "../bottom-panel/useLogsStore";
import { useTreeUiStore } from "./useTreeUiStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import {
  UNREACHABLE_POLLS_BEFORE_DISCONNECT,
  useClusterDisconnectCleanup,
  useUnreachableDisconnect,
} from "./useClusterDisconnect";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useTreeUiStore.setState({ expanded: {}, searchText: {}, hideEmptyConsumerGroups: {} });
  useWorkspaceSelectionStore.setState({ activeTabId: "tab-1", selection: null, byTab: {} });
  useLogsStore.setState({ entries: [] });
});

describe("useClusterDisconnectCleanup", () => {
  function seedExpandedTree() {
    useTreeUiStore.setState({ expanded: { "tab-1:connection:c1": true, "tab-1:c1:Topics": true } });
    useWorkspaceSelectionStore.setState({
      activeTabId: "tab-1",
      selection: { type: "topic", connectionId: "c1", topicName: "orders" },
      byTab: { "tab-1": { type: "topic", connectionId: "c1", topicName: "orders" } },
    });
  }

  it("does nothing while the connection stays connected", () => {
    seedExpandedTree();
    const { rerender } = renderHook(({ up }) => useClusterDisconnectCleanup("c1", up), {
      wrapper,
      initialProps: { up: true },
    });

    rerender({ up: true });

    expect(useTreeUiStore.getState().expanded["tab-1:c1:Topics"]).toBe(true);
    expect(useWorkspaceSelectionStore.getState().selection).not.toBeNull();
  });

  it("clears the cluster's state the moment the backend stops reporting it connected", () => {
    seedExpandedTree();
    const { rerender } = renderHook(({ up }) => useClusterDisconnectCleanup("c1", up), {
      wrapper,
      initialProps: { up: true },
    });

    rerender({ up: false });

    expect(useTreeUiStore.getState().expanded).toEqual({});
    expect(useWorkspaceSelectionStore.getState().selection).toBeNull();
  });

  // Whatever disconnected it — the button, the idle timer, the auth breaker,
  // an unreachable cluster — reaches this hook as the same transition, so it
  // must not fire for a connection that was never up in the first place.
  it("does not fire for a connection that starts out disconnected", () => {
    seedExpandedTree();

    renderHook(() => useClusterDisconnectCleanup("c1", false), { wrapper });

    expect(useTreeUiStore.getState().expanded["tab-1:c1:Topics"]).toBe(true);
  });

  it("does not clear again on later renders once it has fired", () => {
    seedExpandedTree();
    const { rerender } = renderHook(({ up }) => useClusterDisconnectCleanup("c1", up), {
      wrapper,
      initialProps: { up: true },
    });
    rerender({ up: false });
    useTreeUiStore.setState({ expanded: { "tab-1:c1:Topics": true } });

    rerender({ up: false });

    expect(useTreeUiStore.getState().expanded["tab-1:c1:Topics"]).toBe(true);
  });

  // A row re-keyed onto another connection must not read the previous one's
  // connectedness as this one's history.
  it("does not treat a switch to a different connection as that connection disconnecting", () => {
    useTreeUiStore.setState({ expanded: { "tab-1:c2:Topics": true } });
    const { rerender } = renderHook(({ id, up }) => useClusterDisconnectCleanup(id, up), {
      wrapper,
      initialProps: { id: "c1", up: true },
    });

    rerender({ id: "c2", up: false });

    expect(useTreeUiStore.getState().expanded["tab-1:c2:Topics"]).toBe(true);
  });
});

describe("useUnreachableDisconnect", () => {
  const args = (status: string, at: number, connected = true) =>
    ({ status, at, connected }) as { status: never; at: number; connected: boolean };

  it("does not disconnect on a single unreachable poll", async () => {
    const disconnect = vi.fn();
    setInvokeHandlers({ connection_disconnect: disconnect });
    renderHook(
      ({ status, at, connected }) => useUnreachableDisconnect("c1", connected, status, at, "prod"),
      { wrapper, initialProps: args("UNREACHABLE", 1) },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("disconnects after consecutive unreachable polls", async () => {
    const disconnect = vi.fn();
    setInvokeHandlers({ connection_disconnect: disconnect });
    const { rerender } = renderHook(
      ({ status, at, connected }) => useUnreachableDisconnect("c1", connected, status, at, "prod"),
      { wrapper, initialProps: args("UNREACHABLE", 1) },
    );

    // Each poll reports the same value, so only the timestamp moves.
    for (let poll = 2; poll <= UNREACHABLE_POLLS_BEFORE_DISCONNECT; poll++) {
      rerender(args("UNREACHABLE", poll));
    }

    await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ id: "c1" }));
  });

  it("says in the log why everything was cleared", async () => {
    setInvokeHandlers({ connection_disconnect: vi.fn() });
    const { rerender } = renderHook(
      ({ status, at, connected }) => useUnreachableDisconnect("c1", connected, status, at, "prod"),
      { wrapper, initialProps: args("UNREACHABLE", 1) },
    );

    rerender(args("UNREACHABLE", 2));

    await waitFor(() =>
      expect(useLogsStore.getState().entries.some((e) => e.message.includes("prod became unreachable"))).toBe(true),
    );
  });

  // A blip between two failures is the case this exists to survive: a laptop
  // changing networks should not cost the user their loaded messages.
  it("forgets accumulated failures once the cluster answers again", async () => {
    const disconnect = vi.fn();
    setInvokeHandlers({ connection_disconnect: disconnect });
    const { rerender } = renderHook(
      ({ status, at, connected }) => useUnreachableDisconnect("c1", connected, status, at, "prod"),
      { wrapper, initialProps: args("UNREACHABLE", 1) },
    );

    rerender(args("REACHABLE", 2));
    rerender(args("UNREACHABLE", 3));

    await new Promise((r) => setTimeout(r, 20));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("ignores an unreachable cluster the user is not connected to", async () => {
    const disconnect = vi.fn();
    setInvokeHandlers({ connection_disconnect: disconnect });
    const { rerender } = renderHook(
      ({ status, at, connected }) => useUnreachableDisconnect("c1", connected, status, at, "prod"),
      { wrapper, initialProps: args("UNREACHABLE", 1, false) },
    );

    rerender(args("UNREACHABLE", 2, false));
    rerender(args("UNREACHABLE", 3, false));

    await new Promise((r) => setTimeout(r, 20));
    expect(disconnect).not.toHaveBeenCalled();
  });
});
