import { useState } from "react";
import { ContextMenu } from "../../components/ContextMenu";
import { useLogsStore } from "./useLogsStore";

export function LogsPanel() {
  const entries = useLogsStore((s) => s.entries);
  const clearEntries = useLogsStore((s) => s.clearEntries);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  return (
    // The right-click handler sits on this wrapper rather than on the list
    // itself so it covers the whole panel — the empty state, and the blank
    // area below a short list, are both places a user will reasonably
    // right-click looking for "clear".
    <div
      className="logs-panel-surface"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPosition({ x: e.clientX, y: e.clientY });
      }}
    >
      {entries.length === 0 ? (
        <p className="logs-empty">No log entries yet.</p>
      ) : (
        <ul className="logs-panel" aria-label="Application logs">
          {entries.map((entry, index) => (
            <li key={index} className={`log-entry log-entry--${entry.level}`}>
              <span className="log-timestamp">{entry.timestamp}</span>
              <span className="log-message">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
      {menuPosition && (
        <ContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          items={[
            // Deliberately not styled `destructive`: dropping the scrollback
            // is housekeeping in the same spirit as the status strip's
            // "Clear memory" button, not a delete of anything the user made.
            { label: "Clear logs", disabled: entries.length === 0, onSelect: clearEntries },
          ]}
          onClose={() => setMenuPosition(null)}
        />
      )}
    </div>
  );
}
