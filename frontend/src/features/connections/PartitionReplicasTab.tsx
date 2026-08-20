import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, ModuleRegistry } from "ag-grid-community";
import { APP_GRID_THEME } from "./agGridTheme";
import { usePartitions } from "./useClusterResources";

ModuleRegistry.registerModules([AllCommunityModule]);

interface ReplicaRow {
  id: number;
  node: number;
}

const COLUMN_DEFS: ColDef<ReplicaRow>[] = [
  { field: "id", headerName: "ID" },
  { field: "node", headerName: "Node" },
];

const DEFAULT_COL_DEF: ColDef<ReplicaRow> = {
  sortable: true,
  filter: true,
  resizable: true,
};

export interface PartitionReplicasTabProps {
  connectionId: string;
  topicName: string;
  partitionId: number;
}

export function PartitionReplicasTab({ connectionId, topicName, partitionId }: PartitionReplicasTabProps) {
  const { data: partitions, isLoading } = usePartitions(connectionId, topicName, true);
  const partition = partitions?.find((p) => p.id === partitionId);

  if (isLoading) {
    return <p>Loading replicas…</p>;
  }

  if (!partition) {
    return <p>Partition not found.</p>;
  }

  const rows: ReplicaRow[] = partition.replicas.map((node, index) => ({ id: index, node }));

  return (
    <div role="tabpanel" aria-label="Replicas" className="connection-modal-tab-panel connection-modal-tab-panel--fill">
      <div className="data-tab-grid" data-testid="replicas-grid">
        <AgGridReact<ReplicaRow>
          theme={APP_GRID_THEME}
          rowData={rows}
          columnDefs={COLUMN_DEFS}
          defaultColDef={DEFAULT_COL_DEF}
        />
      </div>
    </div>
  );
}
