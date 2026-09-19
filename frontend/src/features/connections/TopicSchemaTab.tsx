import { useEffect, useState } from "react";
import { SchemaFormat } from "../../lib/tauri";
import { useDeleteTopicSchema, useSetTopicSchema, useTopicSchema } from "./useClusterResources";

export interface TopicSchemaTabProps {
  connectionId: string;
  topicName: string;
}

interface SchemaFormatDef {
  id: SchemaFormat;
  label: string;
  /** Shown above the editor — what to paste, and what it changes. */
  hint: string;
  placeholder: string;
}

const SCHEMA_FORMATS: SchemaFormatDef[] = [
  {
    id: "avro",
    label: "Avro",
    hint:
      "Paste an Avro schema (.avsc JSON) to decode this topic's messages with it — takes precedence over Schema " +
      "Registry lookups. Clear it to go back to registry-based decoding.",
    placeholder: '{\n  "type": "record",\n  "name": "Order",\n  "fields": []\n}',
  },
  {
    id: "protobuf",
    label: "Protobuf",
    hint:
      "Paste a .proto schema to decode this topic's messages with it — takes precedence over Schema Registry " +
      "lookups. Without either, protobuf payloads still decode to field numbers read from the wire format.",
    placeholder: 'syntax = "proto3";\n\nmessage Order {\n  string order_id = 1;\n}',
  },
];

/**
 * The per-topic schema override, one tab per format.
 *
 * Two formats rather than one because the two decode paths are independent:
 * the payload viewer's Avro mode reads the Avro schema and its Protobuf mode
 * reads the `.proto`, and a topic can legitimately have one, the other, or
 * both saved. They are stored under separate rows (`topic_schemas` is keyed
 * by connection, topic *and* format), so switching format here does not
 * disturb the other one.
 */
export function TopicSchemaTab({ connectionId, topicName }: TopicSchemaTabProps) {
  const [format, setFormat] = useState<SchemaFormat>("avro");
  const active = SCHEMA_FORMATS.find((f) => f.id === format) ?? SCHEMA_FORMATS[0];
  const { data: savedSchema, isLoading } = useTopicSchema(connectionId, topicName, format);
  const setSchema = useSetTopicSchema();
  const deleteSchema = useDeleteTopicSchema();
  const [draft, setDraft] = useState("");

  // Keyed on the format as well as the saved text: switching format has to
  // pull that format's saved schema into the editor, and a draft typed under
  // one format must never be saved against the other.
  useEffect(() => {
    setDraft(savedSchema ?? "");
  }, [savedSchema, format]);

  function handleSave() {
    setSchema.mutate({ connectionId, topic: topicName, format, schemaText: draft });
  }

  function handleClear() {
    deleteSchema.mutate({ connectionId, topic: topicName, format });
    setDraft("");
  }

  return (
    <div className="topic-schema-tab">
      <div className="connection-modal-tabs" role="tablist" aria-label="Schema format">
        {SCHEMA_FORMATS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={format === option.id}
            className={`connection-modal-tab${format === option.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => setFormat(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p>Loading schema…</p>
      ) : (
        <>
          <p className="resizable-pane-placeholder">{active.hint}</p>
          <textarea
            className="topic-schema-editor"
            aria-label={`${active.label} schema`}
            value={draft}
            placeholder={active.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="connection-modal-input-row">
            <button type="button" onClick={handleSave} disabled={setSchema.isPending}>
              Save
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={deleteSchema.isPending || (!savedSchema && !draft)}
            >
              Clear
            </button>
          </div>
          {setSchema.isError && <p role="alert">{setSchema.error?.message}</p>}
          {deleteSchema.isError && <p role="alert">{deleteSchema.error?.message}</p>}
        </>
      )}
    </div>
  );
}
