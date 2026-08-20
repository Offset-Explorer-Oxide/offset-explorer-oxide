import { useEffect, useState } from "react";
import { JsonTreeView } from "../../components/JsonTreeView";
import { XmlTreeView } from "../../components/XmlTreeView";
import { useDecodeAvro } from "./useClusterResources";
import { useJsonViewerTabsStore } from "../tabs/useJsonViewerTabsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { base64ToBytes, bytesToText, tryParseJson, tryParseXml } from "./payloadDecoding";

type PanelTabId = "headers" | "value";
type ValueMode = "text" | "json" | "avro" | "xml";

const PANEL_TABS: { id: PanelTabId; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "value", label: "Value" },
];

export function MessagePayloadViewer() {
  const message = useMessageViewerStore((s) => s.message);
  const connectionId = useMessageViewerStore((s) => s.connectionId);
  const topic = useMessageViewerStore((s) => s.topic);
  const openJsonTab = useJsonViewerTabsStore((s) => s.openTab);
  const selectTab = useTabsStore((s) => s.selectTab);
  const [activeTab, setActiveTab] = useState<PanelTabId>("value");
  const [mode, setMode] = useState<ValueMode>("text");
  const decodeAvro = useDecodeAvro();
  const { mutate: runDecodeAvro } = decodeAvro;
  const payloadBase64 = message?.payloadBase64 ?? null;

  // Re-decodes whenever a different message is viewed while Avro mode is
  // already active (e.g. clicking through grid rows without switching
  // modes each time) — not just on the button click that first selects it.
  useEffect(() => {
    if (mode === "avro" && payloadBase64 && connectionId && topic) {
      runDecodeAvro({ connectionId, topic, payloadBase64 });
    }
  }, [mode, payloadBase64, connectionId, topic, runDecodeAvro]);

  if (!message) {
    return <p className="resizable-pane-placeholder">Select a message to view its payload.</p>;
  }

  const bytes = message.payloadBase64 !== null ? base64ToBytes(message.payloadBase64) : null;
  const text = bytes !== null ? bytesToText(bytes) : null;
  const json = mode === "json" && text !== null ? tryParseJson(text) : undefined;
  const xml = mode === "xml" && text !== null ? tryParseXml(text) : undefined;

  return (
    <div className="message-payload-viewer">
      <p className="message-payload-meta">
        Partition {message.partition} · Offset {message.offset}
        {message.key !== null && <> · Key: {message.key}</>}
      </p>

      <div className="connection-modal-tabs" role="tablist">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`connection-modal-tab${activeTab === tab.id ? " connection-modal-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "headers" && (
        <div role="tabpanel" aria-label="Headers">
          {message.headers.length === 0 ? (
            <p className="resizable-pane-placeholder">No headers.</p>
          ) : (
            <table className="topic-detail-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {message.headers.map((header, index) => (
                  <tr key={index}>
                    <td>{header.key}</td>
                    <td>{header.value ?? <em>null</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "value" && (
        <div role="tabpanel" aria-label="Value">
          {text === null ? (
            <p className="resizable-pane-placeholder">
              Payload wasn't loaded for this fetch — check "Load message payload" below Play, then Play again.
            </p>
          ) : (
            <>
              <div className="message-payload-toggle" role="group" aria-label="Payload view mode">
                <button
                  type="button"
                  className={mode === "text" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("text")}
                >
                  Text
                </button>
                <button
                  type="button"
                  className={mode === "json" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("json")}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className={mode === "avro" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("avro")}
                >
                  Avro
                </button>
                <button
                  type="button"
                  className={mode === "xml" ? "message-payload-toggle-button--active" : ""}
                  onClick={() => setMode("xml")}
                >
                  XML
                </button>
              </div>
              {mode === "text" && <pre className="message-payload-body">{text}</pre>}
              {mode === "json" &&
                (json !== undefined ? (
                  <JsonTreeView
                    value={json}
                    onOpenInNewTab={() => {
                      const title = `Partition ${message.partition} · Offset ${message.offset}`;
                      selectTab(openJsonTab(title, json));
                    }}
                  />
                ) : (
                  <p role="alert">Payload is not valid JSON.</p>
                ))}
              {mode === "avro" && (
                <>
                  {decodeAvro.isPending && <p>Decoding…</p>}
                  {decodeAvro.isError && <p role="alert">{decodeAvro.error?.message}</p>}
                  {decodeAvro.isSuccess && (
                    <JsonTreeView
                      value={decodeAvro.data}
                      onOpenInNewTab={() => {
                        const title = `Partition ${message.partition} · Offset ${message.offset}`;
                        selectTab(openJsonTab(title, decodeAvro.data));
                      }}
                    />
                  )}
                </>
              )}
              {mode === "xml" &&
                (xml !== undefined ? (
                  <XmlTreeView
                    value={xml}
                    onOpenInNewTab={() => {
                      const title = `Partition ${message.partition} · Offset ${message.offset}`;
                      selectTab(openJsonTab(title, xml, "xml"));
                    }}
                  />
                ) : (
                  <p role="alert">Payload is not valid XML.</p>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
