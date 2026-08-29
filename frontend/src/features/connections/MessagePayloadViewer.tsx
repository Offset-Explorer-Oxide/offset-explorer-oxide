import { useEffect, useMemo, useState } from "react";
import { JsonTreeView } from "../../components/JsonTreeView";
import { XmlTreeView } from "../../components/XmlTreeView";
import { useDecodeAvro, useFullPayload } from "./useClusterResources";
import { useJsonViewerTabsStore } from "../tabs/useJsonViewerTabsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import {
  base64ToBytes,
  base64ToDisplayText,
  bytesToText,
  isPayloadTruncated,
  tryParseJson,
  tryParseXml,
} from "./payloadDecoding";

type PanelTabId = "headers" | "value";
type ValueMode = "text" | "json" | "avro" | "xml";

/**
 * How much of a payload the raw Text view renders before offering the rest
 * behind a click. A `<pre>` is one text node the browser lays out in a
 * single pass, so a 10 MB message costs a visible freeze to display text
 * that runs thousands of screens deep. 256 KB is far more than anyone reads
 * at a glance and renders instantly.
 */
export const TEXT_PREVIEW_CHARS = 256 * 1024;

const PANEL_TABS: { id: PanelTabId; label: string }[] = [
  { id: "headers", label: "Headers" },
  { id: "value", label: "Value" },
];

/**
 * Shown by the structured views while the real bytes are still coming.
 *
 * Those views can't render a truncated preview honestly: `JSON.parse` on a
 * payload cut mid-document fails, and an Avro decode of one fails at the
 * broker's expense. Both used to report that failure — "Payload is not valid
 * JSON", an Avro error — for as long as the fetch took, which reads as a
 * broken message rather than a pending one.
 */
function PayloadLoadingSpinner() {
  return (
    <p className="message-payload-truncation">
      <span className="spinner" role="status" aria-label="Loading the full payload" />
    </p>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MessagePayloadViewer() {
  const message = useMessageViewerStore((s) => s.message);
  const connectionId = useMessageViewerStore((s) => s.connectionId);
  const topic = useMessageViewerStore((s) => s.topic);
  const clearViewedMessage = useMessageViewerStore((s) => s.clear);
  const openJsonTab = useJsonViewerTabsStore((s) => s.openTab);
  const selectTab = useTabsStore((s) => s.selectTab);
  const [activeTab, setActiveTab] = useState<PanelTabId>("value");
  const [mode, setMode] = useState<ValueMode>("text");
  /**
   * Which payload the user asked to see in full, rather than a boolean.
   *
   * A boolean reset by an effect looks equivalent and isn't: effects run
   * after React commits and the browser paints, so the first render after
   * switching messages would still see the previous message's `true`, put the
   * whole new payload into the `<pre>`, and paint it — the exact freeze
   * `TEXT_PREVIEW_CHARS` exists to prevent, one render before the reset lands.
   * Comparing against the current payload is decided during render, so a
   * different message is always truncated from its first frame.
   */
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null);
  const decodeAvro = useDecodeAvro();
  const { mutate: runDecodeAvro } = decodeAvro;

  // The Data tab's grid rows carry only a bounded slice of each payload —
  // that truncation is what keeps a large fetch inside the webview's memory
  // ceiling. So what a row hands this component is usually a preview, and
  // displaying or decoding the message means going back for the real bytes,
  // for this one message.
  const rowPayloadBase64 = message?.payloadBase64 ?? null;
  const needsFullPayload = isPayloadTruncated(rowPayloadBase64, message?.payloadSizeBytes ?? null);
  const fullPayload = useFullPayload(
    connectionId,
    topic,
    message?.partition,
    message?.offset,
    needsFullPayload,
  );
  const fetchedPayloadBase64 =
    fullPayload.data?.messages.find((m) => m.partition === message?.partition && m.offset === message?.offset)
      ?.payloadBase64 ?? null;
  // Falls back to the preview while the full fetch is in flight or if it
  // fails — a truncated payload beats a blank pane — but that fallback is
  // always labelled, because a few KB of a multi-megabyte message is
  // otherwise indistinguishable from the whole of a small one.
  const payloadBase64 = needsFullPayload ? (fetchedPayloadBase64 ?? rowPayloadBase64) : rowPayloadBase64;
  const isShowingPreviewOnly = needsFullPayload && fetchedPayloadBase64 === null;
  // A failed fetch is not still in flight: the banner above says why, and the
  // views below go back to reporting what they actually have rather than
  // spinning for a payload that is never going to arrive.
  const isLoadingFullPayload = isShowingPreviewOnly && !fullPayload.isError;

  // Re-decodes whenever a different message is viewed while Avro mode is
  // already active (e.g. clicking through grid rows without switching
  // modes each time) — not just on the button click that first selects it.
  useEffect(() => {
    if (mode === "avro" && !isLoadingFullPayload && payloadBase64 && connectionId && topic) {
      runDecodeAvro({ connectionId, topic, payloadBase64 });
    }
  }, [mode, payloadBase64, connectionId, topic, runDecodeAvro, isLoadingFullPayload]);


  // Decoding is memoised on the payload itself, not left to run inline.
  // Every one of these is O(payload): the base64 decode walks byte by byte,
  // the UTF-8 decode copies the lot, and `JSON.parse` builds an object graph
  // the size of the document. Inline, they re-ran on *every* render of this
  // component — switching panel tabs, toggling a mode, a parent re-rendering
  // — so on a 2-10 MB message the app froze each time rather than only on
  // the first look at it.
  const text = useMemo(
    () => (payloadBase64 === null ? null : bytesToText(base64ToBytes(payloadBase64))),
    [payloadBase64],
  );

  const json = useMemo(
    () => (mode === "json" && text !== null ? tryParseJson(text) : undefined),
    [mode, text],
  );
  const xml = useMemo(() => (mode === "xml" && text !== null ? tryParseXml(text) : undefined), [mode, text]);

  // A `<pre>` holding megabytes of text is a single enormous DOM text node
  // that the browser lays out in one go, so the raw view is capped until the
  // user asks for the rest — and asking is per payload, so clicking through
  // to a different message starts collapsed again.
  const showFullText = expandedPayload !== null && expandedPayload === payloadBase64;
  const isTextTruncated = text !== null && !showFullText && text.length > TEXT_PREVIEW_CHARS;
  const displayText = isTextTruncated ? text.slice(0, TEXT_PREVIEW_CHARS) : text;

  if (!message) {
    return <p className="resizable-pane-placeholder">Select a message to view its payload.</p>;
  }

  return (
    <div className="message-payload-viewer">
      <div className="message-payload-header">
        <p className="message-payload-meta">
          Partition {message.partition} · Offset {message.offset}
          {message.keyBase64 !== null && <> · Key: {base64ToDisplayText(message.keyBase64)}</>}
        </p>
        <button
          type="button"
          className="json-tree-icon-button"
          title="Close"
          aria-label="Close message payload viewer"
          onClick={clearViewedMessage}
        >
          <CloseIcon />
        </button>
      </div>

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
                    <td>{base64ToDisplayText(header.valueBase64) ?? <em>null</em>}</td>
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
              Payload wasn't loaded for this fetch — check "Fetch message payload" below Fetch, then Fetch again.
            </p>
          ) : (
            <>
              {isShowingPreviewOnly && (
                <p className="message-payload-truncation">
                  {fullPayload.isError
                    ? `Showing a preview only — the full payload could not be loaded: ${fullPayload.error?.message}`
                    : "Loading the full payload — showing a preview until it arrives."}
                </p>
              )}
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
              {mode === "text" && (
                <>
                  <pre className="message-payload-body">{displayText}</pre>
                  {isTextTruncated && (
                    <p className="message-payload-truncation">
                      Showing the first {Math.round(TEXT_PREVIEW_CHARS / 1024)} KB of{" "}
                      {Math.round((text?.length ?? 0) / 1024).toLocaleString()} KB.{" "}
                      <button type="button" className="link-button" onClick={() => setExpandedPayload(payloadBase64)}>
                        Show the whole payload
                      </button>
                    </p>
                  )}
                </>
              )}
              {mode === "json" &&
                (isLoadingFullPayload ? (
                  <PayloadLoadingSpinner />
                ) : json !== undefined ? (
                  // Keyed by payload so every message gets a fresh tree.
                  // `JsonNode` decides whether to start expanded in a
                  // `useState` initialiser, which React runs once per mounted
                  // instance — and nodes reconcile by position and property
                  // name, so without this an `events` node expanded on a
                  // message with three entries stays expanded on the next
                  // message where it holds three thousand, rendering all of
                  // them in one pass.
                  <JsonTreeView
                    key={payloadBase64}
                    value={json}
                    onOpenInNewTab={() => {
                      const title = `Partition ${message.partition} · Offset ${message.offset}`;
                      selectTab(openJsonTab(title, json));
                    }}
                  />
                ) : (
                  <p role="alert">Payload is not valid JSON.</p>
                ))}
              {mode === "avro" && isLoadingFullPayload && <PayloadLoadingSpinner />}
              {mode === "avro" && !isLoadingFullPayload && (
                <>
                  {decodeAvro.isPending && <p>Decoding…</p>}
                  {decodeAvro.isError && <p role="alert">{decodeAvro.error?.message}</p>}
                  {decodeAvro.isSuccess && (
                    // Same reason as the JSON view above.
                    <JsonTreeView
                      key={payloadBase64}
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
                (isLoadingFullPayload ? (
                  <PayloadLoadingSpinner />
                ) : xml !== undefined ? (
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
