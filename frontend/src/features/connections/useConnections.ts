import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ConnectionStatus, ImportSummary, NewConnection } from "../../lib/tauri";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";

export function useConnectionsQuery() {
  return useQuery({ queryKey: ["connections"], queryFn: api.listConnections });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newConnection: NewConnection) => api.createConnection(newConnection),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, connection }: { id: string; connection: NewConnection }) => api.updateConnection(id, connection),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      // A deleted connection's id can still be sitting in the middle pane's
      // selection or the right pane's viewed message (in this tab or any
      // other) — without this, those panes would keep referencing a
      // connection that no longer exists.
      useWorkspaceSelectionStore.getState().clearForConnection(id);
      useMessageViewerStore.getState().clearForConnection(id);
    },
  });
}

/** Backs the "Export Connection" context-menu item (`ids: [id]`) and the "Export All" button (`ids: null`). */
export function useExportConnections() {
  return useMutation<void, Error, { ids: string[] | null; path: string }>({
    mutationFn: ({ ids, path }) => api.exportConnections(ids, path),
  });
}

/** Backs the sidebar's "Import" button. */
export function useImportConnections() {
  const queryClient = useQueryClient();
  return useMutation<ImportSummary, Error, string>({
    mutationFn: (path: string) => api.importConnections(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useConnectionStatus(id: string) {
  return useQuery({
    queryKey: ["connection-status", id],
    queryFn: () => api.checkConnectionStatus(id),
    refetchInterval: 10_000,
    initialData: "UNKNOWN" as const,
  });
}

/** Backs the ping button next to "Bootstrap servers" in the New Connection modal. */
export function usePingBootstrapServers() {
  return useMutation<ConnectionStatus, Error, string>({
    mutationFn: (bootstrapServers: string) => api.pingBootstrapServers(bootstrapServers),
  });
}

/** Backs the ping button next to "Host" in the New Connection modal's Zookeeper section. */
export function usePingZookeeper() {
  return useMutation<ConnectionStatus, Error, { host: string; port: number }>({
    mutationFn: ({ host, port }) => api.pingZookeeper(host, port),
  });
}

/** Backs the New Connection modal's bottom "Test" button. */
export function useTestConnection() {
  return useMutation<ConnectionStatus, Error, NewConnection>({
    mutationFn: (newConnection: NewConnection) => api.testConnection(newConnection),
  });
}

/**
 * Why this connection's requests are being refused before they reach the
 * broker — the reason the broker gave when it rejected its credentials — or
 * `null` while it isn't blocked.
 *
 * Polled alongside the reachability dot, since the breaker can trip at any
 * time (a rotated password takes effect mid-session, not at connect time).
 */
export function useConnectionAuthBlock(id: string) {
  return useQuery({
    queryKey: ["connection-auth-block", id],
    queryFn: () => api.connectionAuthBlockReason(id),
    refetchInterval: 10_000,
    initialData: null,
  });
}

/** Whether the cluster detail panel should treat this connection as connected (gates field-disabling and the tree's Brokers/Topics/Consumers expansion). */
export function useConnectionConnected(id: string) {
  return useQuery({
    queryKey: ["connection-connected", id],
    queryFn: () => api.isConnectionConnected(id),
    initialData: false,
  });
}

/**
 * Backs the cluster detail panel's "Reconnect" button. Takes `id` as a hook
 * argument (rather than at `.mutate()` time) so the mutation key is scoped
 * to this connection — `useIsMutating({ mutationKey: connectMutationKey(id) })`
 * elsewhere (the connection tree's spinner) can then observe it in flight
 * without needing its own reference to this mutation instance.
 */
export function connectMutationKey(id: string) {
  return ["connect", id];
}

export function useConnect(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ConnectionStatus, Error, void>({
    mutationKey: connectMutationKey(id),
    mutationFn: () => api.connectConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connection-connected", id] });
      queryClient.invalidateQueries({ queryKey: ["connection-status", id] });
      // The cluster listings are fetched once and then held for as long as
      // the app runs (see `CLUSTER_LISTING_OPTIONS`), which is right while a
      // connection stays up and wrong the moment it is re-established: the
      // cluster may have gained or lost topics while it was down, and
      // nothing else would ever ask again. Connecting is the one event that
      // means "whatever we knew about this cluster is from a previous
      // session".
      for (const key of ["brokers", "topics", "consumer-groups"]) {
        queryClient.invalidateQueries({ queryKey: [key, id] });
      }
    },
    // On settled, not on success: a Reconnect that the broker *rejects* is
    // exactly when the breaker's state changes, and the tree needs to say so
    // straight away rather than at the next poll.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["connection-auth-block", id] });
    },
  });
}

/** Backs the cluster detail panel's "Disconnect" button. */
export function useDisconnect() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id: string) => api.disconnectConnection(id),
    onSuccess: (_void, id) => {
      queryClient.invalidateQueries({ queryKey: ["connection-connected", id] });
      queryClient.invalidateQueries({ queryKey: ["connection-status", id] });
    },
  });
}
