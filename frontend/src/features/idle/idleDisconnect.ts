import { QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/tauri";
import { useLogsStore } from "../bottom-panel/useLogsStore";

/** 120 minutes, per General settings' fixed (non-configurable) idle-disconnect policy. */
export const IDLE_DISCONNECT_MS = 120 * 60 * 1000;

/**
 * Disconnects every currently-connected saved connection. Fired once the app
 * has seen no mouse/keyboard/scroll activity for `IDLE_DISCONNECT_MS` (see
 * `IdleTimerProvider`). Checks each connection's live status rather than
 * trusting React Query's cache, since a connection could have gone stale
 * (never refetched) while the user was away.
 */
export async function disconnectAllConnections(queryClient: QueryClient): Promise<void> {
  // Reported on the line below: one backend disconnect per connected cluster,
  // each closing a broker socket (and a Schema Registry one), run together.
  const started = performance.now();
  const connections = await api.listConnections();
  const disconnected: string[] = [];

  await Promise.all(
    connections.map(async (connection) => {
      const connected = await api.isConnectionConnected(connection.id);
      if (!connected) return;
      await api.disconnectConnection(connection.id);
      queryClient.invalidateQueries({ queryKey: ["connection-connected", connection.id] });
      queryClient.invalidateQueries({ queryKey: ["connection-status", connection.id] });
      disconnected.push(connection.name);
    }),
  );

  if (disconnected.length > 0) {
    useLogsStore.getState().addEntry({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Disconnected ${disconnected.join(", ")} after 120 minutes of inactivity in ${Math.round(performance.now() - started)} ms`,
    });
  }
}
