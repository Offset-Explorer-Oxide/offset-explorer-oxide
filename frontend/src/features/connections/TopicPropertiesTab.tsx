import { useState } from "react";
import { useCountTopicMessages } from "./useClusterResources";

export interface TopicPropertiesTabProps {
  connectionId: string;
  topicName: string;
}

export function TopicPropertiesTab({ connectionId, topicName }: TopicPropertiesTabProps) {
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const countMessages = useCountTopicMessages();

  async function handleRefresh() {
    setError(null);
    try {
      const count = await countMessages.mutateAsync({ connectionId, topic: topicName });
      setMessageCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to count messages");
    }
  }

  return (
    <div role="tabpanel" aria-label="Properties" className="connection-modal-tab-panel">
      <section className="connection-modal-section">
        <h3>General</h3>
        <label>
          Topic name
          <input value={topicName} disabled readOnly />
        </label>
      </section>

      <section className="connection-modal-section">
        <h3>Messages</h3>
        <label>
          Total number of messages
          <div className="connection-modal-input-row">
            <input
              value={messageCount === null ? "" : String(messageCount)}
              disabled
              readOnly
              placeholder="Not loaded"
            />
            <button type="button" onClick={handleRefresh} disabled={countMessages.isPending}>
              Refresh
            </button>
          </div>
        </label>
        {error && (
          <p role="alert" className="connection-modal-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
