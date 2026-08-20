import { useEffect, useState } from "react";
import { useDeleteTopicSchema, useSetTopicSchema, useTopicSchema } from "./useClusterResources";

export interface TopicSchemaTabProps {
  connectionId: string;
  topicName: string;
}

/** A manually-pasted Avro schema for this topic — takes precedence over Schema Registry lookups when set. */
export function TopicSchemaTab({ connectionId, topicName }: TopicSchemaTabProps) {
  const { data: savedSchema, isLoading } = useTopicSchema(connectionId, topicName, "avro");
  const setSchema = useSetTopicSchema();
  const deleteSchema = useDeleteTopicSchema();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(savedSchema ?? "");
  }, [savedSchema]);

  if (isLoading) {
    return <p>Loading schema…</p>;
  }

  function handleSave() {
    setSchema.mutate({ connectionId, topic: topicName, format: "avro", schemaText: draft });
  }

  function handleClear() {
    deleteSchema.mutate({ connectionId, topic: topicName, format: "avro" });
    setDraft("");
  }

  return (
    <div className="topic-schema-tab">
      <p className="resizable-pane-placeholder">
        Paste an Avro schema (.avsc JSON) to decode this topic's messages with it — takes precedence over Schema
        Registry lookups. Clear it to go back to registry-based decoding.
      </p>
      <textarea
        className="topic-schema-editor"
        aria-label="Avro schema"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      <div className="connection-modal-input-row">
        <button type="button" onClick={handleSave} disabled={setSchema.isPending}>
          Save
        </button>
        <button type="button" onClick={handleClear} disabled={deleteSchema.isPending || (!savedSchema && !draft)}>
          Clear
        </button>
      </div>
      {setSchema.isError && <p role="alert">{setSchema.error?.message}</p>}
      {deleteSchema.isError && <p role="alert">{deleteSchema.error?.message}</p>}
    </div>
  );
}
