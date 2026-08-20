import { useTopicConfig } from "./useClusterResources";

export interface ConfigTabProps {
  connectionId: string;
  topicName: string;
}

export function ConfigTab({ connectionId, topicName }: ConfigTabProps) {
  const { data: entries, isLoading } = useTopicConfig(connectionId, topicName);

  if (isLoading) {
    return <p>Loading config…</p>;
  }

  if (!entries || entries.length === 0) {
    return <p>No config entries found for this topic.</p>;
  }

  return (
    <table className="topic-detail-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.name}>
            <td>{entry.name}</td>
            <td>{entry.value ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
