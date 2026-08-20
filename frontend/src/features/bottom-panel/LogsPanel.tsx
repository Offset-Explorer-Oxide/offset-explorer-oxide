import { useLogsStore } from "./useLogsStore";

export function LogsPanel() {
  const entries = useLogsStore((s) => s.entries);

  if (entries.length === 0) {
    return <p className="logs-empty">No log entries yet.</p>;
  }

  return (
    <ul className="logs-panel" aria-label="Application logs">
      {entries.map((entry, index) => (
        <li key={index} className={`log-entry log-entry--${entry.level}`}>
          <span className="log-timestamp">{entry.timestamp}</span>
          <span className="log-message">{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}
