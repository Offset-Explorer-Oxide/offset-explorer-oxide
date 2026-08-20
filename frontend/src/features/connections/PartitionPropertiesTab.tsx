import { usePartitions } from "./useClusterResources";

export interface PartitionPropertiesTabProps {
  connectionId: string;
  topicName: string;
  partitionId: number;
}

export function PartitionPropertiesTab({ connectionId, topicName, partitionId }: PartitionPropertiesTabProps) {
  const { data: partitions, isLoading } = usePartitions(connectionId, topicName, true);
  const partition = partitions?.find((p) => p.id === partitionId);

  if (isLoading) {
    return <p>Loading partition…</p>;
  }

  if (!partition) {
    return <p>Partition not found.</p>;
  }

  return (
    <div role="tabpanel" aria-label="Properties" className="connection-modal-tab-panel">
      <section className="connection-modal-section">
        <h3>General</h3>
        <label>
          Id
          <input value={String(partition.id)} disabled readOnly />
        </label>
        <label>
          Leader
          <input value={String(partition.leader)} disabled readOnly />
        </label>
      </section>

      <section className="connection-modal-section">
        <h3>Offsets</h3>
        <label>
          Start
          <input value={String(partition.lowOffset)} disabled readOnly />
        </label>
        <label>
          End
          <input value={String(partition.highOffset)} disabled readOnly />
        </label>
        <label>
          Size
          <input value={String(partition.highOffset - partition.lowOffset)} disabled readOnly />
        </label>
      </section>
    </div>
  );
}
