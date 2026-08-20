import { usePartitions } from "./useClusterResources";

export interface PartitionsTabProps {
  connectionId: string;
  topicName: string;
}

export function PartitionsTab({ connectionId, topicName }: PartitionsTabProps) {
  const { data: partitions, isLoading } = usePartitions(connectionId, topicName);

  if (isLoading) {
    return <p>Loading partitions…</p>;
  }

  if (!partitions || partitions.length === 0) {
    return <p>No partitions found for this topic.</p>;
  }

  return (
    <table className="topic-detail-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Leader</th>
          <th>Replicas</th>
          <th>ISR</th>
          <th>Low offset</th>
          <th>High offset</th>
        </tr>
      </thead>
      <tbody>
        {partitions.map((partition) => (
          <tr key={partition.id}>
            <td>{partition.id}</td>
            <td>{partition.leader}</td>
            <td>{partition.replicas.join(", ")}</td>
            <td>{partition.isr.join(", ")}</td>
            <td>{partition.lowOffset}</td>
            <td>{partition.highOffset}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
