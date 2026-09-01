import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { ContextMenu } from "../../components/ContextMenu";
import { Connection, ConnectionStatus } from "../../lib/tauri";
import {
  connectMutationKey,
  useConnect,
  useConnectionAuthBlock,
  useConnectionConnected,
  useConnectionsQuery,
  useConnectionStatus,
  useDeleteConnection,
  useDisconnect,
  useExportConnections,
} from "./useConnections";
import { useTabsStore } from "../tabs/useTabsStore";
import { useWorkspaceSelectionStore } from "../workspace/useWorkspaceSelectionStore";
import { ClusterResourceTree } from "./ClusterResourceTree";
import { treeKey, useTreeUiStore } from "./useTreeUiStore";
import { useClusterDisconnectCleanup, useUnreachableDisconnect } from "./useClusterDisconnect";

/**
 * The dot answers "what is my session with this cluster", and warns only
 * about states the user has to act on.
 *
 * * **Green** — connected and answering.
 * * **Red** — something needs attention: a live session that has stopped
 *   answering, or credentials the broker rejected.
 * * **Gray** — not connected. A deliberate state, and not a problem.
 *
 * Reachability used to paint the dot red whether or not there was a session,
 * so a cluster you had deliberately disconnected from — or had simply never
 * connected to, on a laptop away from its network — sat there looking broken,
 * and disconnecting could not clear it because the reachability poll runs
 * regardless of connection state. An idle cluster being unreachable is not a
 * fault; it is only worth knowing at the moment you try to use it, which is
 * what Reconnect and the modal's Test button are for. The tooltip
 * (`statusTitle`) still reports reachability in words for anyone who wants
 * it.
 *
 * Rejected credentials stay red even while disconnected, because that state
 * is not neutral: until it is cleared, every request to this connection is
 * refused up front (see `connection_for_request`), and the row below the name
 * says so.
 */
function statusClass(status: ConnectionStatus, isConnected: boolean, isAuthBlocked: boolean): string {
  if (isAuthBlocked) return "status-dot status-dot--red";
  if (!isConnected) return "status-dot status-dot--gray";
  if (status === "UNREACHABLE") return "status-dot status-dot--red";
  if (status === "REACHABLE") return "status-dot status-dot--green";
  return "status-dot status-dot--gray";
}

/**
 * What the dot means, in words, on hover.
 *
 * The colour alone cannot answer the question it prompts. Red covers two
 * unrelated states — a cluster nothing is listening on, and one whose
 * credentials the broker rejected — and neither of them clears by
 * disconnecting, because reachability is polled whether or not there is a
 * session and the auth breaker deliberately survives one (only editing the
 * connection or Reconnect clears it). A user looking at a red dot on a local
 * plaintext cluster they have just disconnected from has no way to tell which
 * of those they are in, or what to do about it.
 */
function statusTitle(
  status: ConnectionStatus,
  isConnected: boolean,
  authBlockReason: string | null,
  bootstrapServers: string,
): string {
  if (authBlockReason) {
    return `Authentication failed: ${authBlockReason}. Requests are paused — edit the connection's credentials and save, or use Reconnect, to try again.`;
  }
  // Says nothing about reachability while disconnected, because nothing is
  // checking it: the poll behind `status` only runs for a live session (see
  // `useConnectionStatus`), so any value left over from the last one is a
  // fact about the past, not about now.
  if (!isConnected) {
    return `Not connected to ${bootstrapServers}. Use Reconnect to open a session.`;
  }
  if (status === "UNREACHABLE") {
    return `Connected, but ${bootstrapServers} has stopped answering. The session ends if it stays unreachable.`;
  }
  return `Connected to ${bootstrapServers}.`;
}

interface ConnectionRowProps {
  connection: Connection;
  /** Opens the New Connection modal pre-filled with this connection's (non-secret) values. */
  onClone: (connection: Connection) => void;
}

function ConnectionRow({ connection, onClone }: ConnectionRowProps) {
  const { id, name } = connection;
  const { data: isConnected } = useConnectionConnected(id);
  // A cluster the user is not connected to is polled far less often — see
  // `IDLE_STATUS_POLL_MS`. Read before the status query so it can drive it.
  const { data: status, dataUpdatedAt: statusUpdatedAt } = useConnectionStatus(id, isConnected ?? false);
  // This row is the one component mounted for every saved connection for as
  // long as the app runs — the sidebar is hidden rather than unmounted when a
  // JSON viewer or Settings tab is active — which makes it the place a
  // cluster's session can actually be watched. Both hooks are no-ops until
  // something changes.
  useUnreachableDisconnect(id, isConnected ?? false, status ?? "UNKNOWN", statusUpdatedAt, name);
  useClusterDisconnectCleanup(id, isConnected ?? false);
  const { data: authBlockReason } = useConnectionAuthBlock(id);
  const selection = useWorkspaceSelectionStore((s) => s.selection);
  const selectConnection = useWorkspaceSelectionStore((s) => s.selectConnection);
  const isSelected = selection?.type === "connection" && selection.id === id;
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const rowKey = treeKey(activeTabId, "connection", id);
  const expanded = useTreeUiStore((s) => s.expanded[rowKey] ?? false);
  const toggleExpanded = useTreeUiStore((s) => s.toggleExpanded);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const connected = isConnected ?? false;
  const isConnecting = useIsMutating({ mutationKey: connectMutationKey(id) }) > 0;
  const connect = useConnect(id);
  const disconnect = useDisconnect();
  const deleteConnection = useDeleteConnection();
  const exportConnections = useExportConnections();

  function handleDelete() {
    if (window.confirm(`Delete connection "${name}"? This cannot be undone.`)) {
      deleteConnection.mutate(id);
    }
  }

  async function handleExport() {
    const path = await save({
      defaultPath: `${name}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path) {
      exportConnections.mutate({ ids: [id], path });
    }
  }

  return (
    // One <li> per connection, wrapping the row *and* everything under it.
    // The row is `position: sticky` so the cluster name stays visible while
    // its topics scroll past, and a sticky element is bounded by its parent
    // box — as flat siblings, one cluster's row would have stuck over the
    // next cluster's rows all the way down the list.
    <li className="connection-node">
      <div
        className={`connection-row${isSelected ? " connection-row--selected" : ""}`}
        data-testid={`connection-row-${id}`}
        onClick={() => selectConnection(id, name)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuPosition({ x: e.clientX, y: e.clientY });
        }}
      >
        {connected && (
          <button
            type="button"
            className={`tree-caret-button${expanded ? " tree-caret-button--expanded" : ""}`}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(rowKey);
            }}
          >
            <span className="tree-caret" aria-hidden="true" />
          </button>
        )}
        <span
          className={statusClass(status ?? "UNKNOWN", connected, Boolean(authBlockReason))}
          data-testid={`status-${id}`}
          role="img"
          aria-label={statusTitle(status ?? "UNKNOWN", connected, authBlockReason ?? null, connection.bootstrapServers)}
          title={statusTitle(status ?? "UNKNOWN", connected, authBlockReason ?? null, connection.bootstrapServers)}
        />
        <span>{name}</span>
        {isConnecting && <span className="spinner" role="status" aria-label="Connecting" />}
      </div>
      {authBlockReason && (
        <p className="connection-row-auth-block" data-testid={`auth-block-${id}`}>
          Authentication failed: {authBlockReason}. Requests to this cluster are paused. Edit the connection's
          credentials and save to try again.
        </p>
      )}
      {menuPosition && (
        <ContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          onClose={() => setMenuPosition(null)}
          items={[
            { label: "Reconnect", onSelect: () => connect.mutate() },
            { label: "Disconnect", onSelect: () => disconnect.mutate(id) },
            { label: "Clone Connection", onSelect: () => onClone(connection) },
            { label: "Export Connection", onSelect: handleExport },
            { label: "Delete Connection", destructive: true, onSelect: handleDelete },
          ]}
        />
      )}
      {connected && (
        <div className="connection-row-children" style={expanded ? undefined : { display: "none" }}>
          <ClusterResourceTree connectionId={id} />
        </div>
      )}
    </li>
  );
}

function noop() {}

export interface ConnectionTreeProps {
  /** Opens the New Connection modal pre-filled with a connection's (non-secret) values. */
  onClone?: (connection: Connection) => void;
}

export function ConnectionTree({ onClone = noop }: ConnectionTreeProps) {
  const { data: connections, isLoading } = useConnectionsQuery();

  if (isLoading) {
    return <p>Loading connections…</p>;
  }

  if (!connections || connections.length === 0) {
    return <p>No connections yet. Add one to get started.</p>;
  }

  return (
    <ul className="connection-tree" data-testid="connection-tree" aria-label="Connections">
      {connections.map((connection) => (
        <ConnectionRow key={connection.id} connection={connection} onClone={onClone} />
      ))}
    </ul>
  );
}
