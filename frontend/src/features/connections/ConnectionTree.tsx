import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { ContextMenu } from "../../components/ContextMenu";
import { Connection, ConnectionStatus } from "../../lib/tauri";
import {
  connectMutationKey,
  useConnect,
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

/**
 * Green requires both a reachable ping AND an explicit "connected" session
 * (see Reconnect/Disconnect) — a cluster that's merely network-reachable
 * but never connected shows gray, matching the cluster detail panel's
 * connect-state-gated field disabling and the tree's Brokers/Topics/
 * Consumers expansion, which key off the same "connected" flag.
 */
function statusClass(status: ConnectionStatus, isConnected: boolean): string {
  if (status === "UNREACHABLE") return "status-dot status-dot--red";
  if (status === "REACHABLE" && isConnected) return "status-dot status-dot--green";
  return "status-dot status-dot--gray";
}

interface ConnectionRowProps {
  connection: Connection;
  /** Opens the New Connection modal pre-filled with this connection's (non-secret) values. */
  onClone: (connection: Connection) => void;
}

function ConnectionRow({ connection, onClone }: ConnectionRowProps) {
  const { id, name } = connection;
  const { data: status } = useConnectionStatus(id);
  const { data: isConnected } = useConnectionConnected(id);
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
    <>
      <li
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
        <span className={statusClass(status ?? "UNKNOWN", connected)} data-testid={`status-${id}`} />
        <span>{name}</span>
        {isConnecting && <span className="spinner" role="status" aria-label="Connecting" />}
      </li>
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
        <li className="connection-row-children" style={expanded ? undefined : { display: "none" }}>
          <ClusterResourceTree connectionId={id} />
        </li>
      )}
    </>
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
