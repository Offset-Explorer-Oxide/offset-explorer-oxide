import { useConnectionConnected } from "./useConnections";
import { useBrokers } from "./useClusterResources";

export interface BrokerDetailPanelProps {
  connectionId: string;
  brokerId: number;
}

export function BrokerDetailPanel({ connectionId, brokerId }: BrokerDetailPanelProps) {
  const { data: isConnected } = useConnectionConnected(connectionId);
  const { data: brokers } = useBrokers(connectionId, true);
  const broker = brokers?.find((b) => b.id === brokerId);

  if (!broker) {
    return <p>Loading broker…</p>;
  }

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header">
        <h2>Broker {broker.id}</h2>
      </header>
      <div role="tabpanel" aria-label="Properties" className="connection-modal-tab-panel">
        <fieldset disabled={isConnected ?? false} className="connection-modal-fieldset">
          <section className="connection-modal-section">
            <h3>General</h3>
            <label>
              Broker ID
              <input value={String(broker.id)} readOnly />
            </label>
            <label>
              Host
              <input value={broker.host} readOnly />
            </label>
            <label>
              Port
              <input value={String(broker.port)} readOnly />
            </label>
          </section>
        </fieldset>
      </div>
    </div>
  );
}
