import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { CheckIcon, CopyIcon, DownloadIcon, SaveIcon } from "../../components/AppIcons";
import { JsonTreeView } from "../../components/JsonTreeView";
import { LineNumberedText } from "../../components/LineNumberedText";
import { valueFormat } from "../../components/ValueFormatSelect";
import { XmlTreeView } from "../../components/XmlTreeView";
import { api } from "../../lib/tauri";
import { formatXmlNode, textToBase64, XmlElementNode } from "../connections/payloadDecoding";
import { JsonViewerTab } from "./useJsonViewerTabsStore";

export interface JsonViewerTabPanelProps {
  tab: JsonViewerTab;
}

type ToolbarAction = "copy" | "save" | "download";

/**
 * The tab's value as text — what Copy and Save both write.
 *
 * Rebuilt from `value` rather than remembered as a string when the tab was
 * opened: the tree views render from the parsed value, so this is the one
 * definition that cannot drift from what is on screen. A `"text"` tab's
 * value already *is* the rendered text (that is why it was opened as one).
 */
function tabText(tab: JsonViewerTab): string {
  if (tab.kind === "xml") return formatXmlNode(tab.value as XmlElementNode);
  if (tab.kind === "text") return String(tab.value);
  return JSON.stringify(tab.value, null, 2);
}

/** The extension Save defaults to — the opening format's, or the render kind's. */
function tabExtension(tab: JsonViewerTab): string {
  if (tab.format) return valueFormat(tab.format).extension;
  if (tab.kind === "xml") return "xml";
  if (tab.kind === "text") return "txt";
  return "json";
}

/**
 * What Save calls the format — the payload viewer's own name for it where
 * there is one, so the two toolbars say "Save as Hex", not one of them
 * "Save as HEX" off the back of a file extension.
 */
function tabFormatLabel(tab: JsonViewerTab): string {
  return tab.format ? valueFormat(tab.format).label : tabExtension(tab).toUpperCase();
}

/**
 * The middle pane's content for an ephemeral "opened in new tab" JSON/XML
 * view — takes over the whole pane instead of sharing it with the usual
 * cluster/topic detail panel. No "open in new tab" button here: this view
 * already *is* a dedicated tab for the value, so there's nothing new to open.
 *
 * It carries the same Copy/Save/Download the payload viewer does, and for
 * the same reason it has them there: opening a payload in its own tab is
 * what you do with the payload you actually care about, and sending it
 * somewhere else was the obvious next step with no button for it. The tree
 * views' own toolbars are switched off (`showToolbar={false}`) so the
 * controls don't stack, exactly as in `MessagePayloadViewer`.
 */
export function JsonViewerTabPanel({ tab }: JsonViewerTabPanelProps) {
  /** Transient feedback for the three buttons — cleared on a timer, or replaced by the next action's. */
  const [status, setStatus] = useState<{ kind: "ok" | "error"; action: ToolbarAction; message: string } | null>(null);
  /** The pending clear, so a new action cancels the old one's timer rather than racing it. */
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function report(kind: "ok" | "error", action: ToolbarAction, message: string) {
    if (statusTimerRef.current !== null) clearTimeout(statusTimerRef.current);
    setStatus({ kind, action, message });
    statusTimerRef.current = setTimeout(() => setStatus(null), 4000);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tabText(tab));
      report("ok", "copy", "Copied.");
    } catch (error) {
      report("error", "copy", `Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Save writes the value as this tab renders it — the "give me what I'm looking at" button. */
  async function handleSave() {
    const extension = tabExtension(tab);
    try {
      const path = await save({
        defaultPath: `${tab.fileStem ?? "payload"}.${extension}`,
        filters: [{ name: tabFormatLabel(tab), extensions: [extension] }],
      });
      if (!path) return;
      await api.savePayloadFile(path, textToBase64(tabText(tab)));
      report("ok", "save", `Saved to ${path}`);
    } catch (error) {
      report("error", "save", `Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download writes the message's **original bytes**, not this tab's text.
   *
   * Only offered when the tab was handed them — a value parsed out of a
   * payload has already been through a lossy UTF-8 decode, so writing it
   * back produces a file that no longer round-trips, and a Download button
   * that quietly did that would be worse than no button at all.
   */
  async function handleDownload() {
    if (!tab.payloadBase64) return;
    try {
      const path = await save({
        defaultPath: `${tab.fileStem ?? "payload"}.bin`,
        filters: [{ name: "Raw payload", extensions: ["bin"] }],
      });
      if (!path) return;
      await api.savePayloadFile(path, tab.payloadBase64);
      report("ok", "download", `Downloaded to ${path}`);
    } catch (error) {
      report("error", "download", `Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const justCopied = status?.kind === "ok" && status.action === "copy";

  return (
    <div className="cluster-detail-panel">
      <header className="cluster-detail-header json-viewer-tab-header">
        <h2>{tab.title}</h2>
        <div className="message-payload-toolbar-actions">
          <button
            type="button"
            className="json-tree-icon-button"
            title={justCopied ? "Copied!" : "Copy"}
            aria-label={justCopied ? "Copied!" : "Copy"}
            onClick={handleCopy}
          >
            {justCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            className="json-tree-icon-button"
            title={`Save as ${tabFormatLabel(tab)}…`}
            aria-label={`Save as ${tabFormatLabel(tab)}`}
            onClick={handleSave}
          >
            <SaveIcon />
          </button>
          {tab.payloadBase64 && (
            <button
              type="button"
              className="json-tree-icon-button"
              title="Download the original payload bytes…"
              aria-label="Download the original payload bytes"
              onClick={handleDownload}
            >
              <DownloadIcon />
            </button>
          )}
        </div>
      </header>
      {status && (
        <p
          className={`message-payload-truncation${status.kind === "error" ? " message-payload-status--error" : ""}`}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      )}
      <div className="connection-modal-body">
        {tab.kind === "xml" ? (
          <XmlTreeView value={tab.value as XmlElementNode} showToolbar={false} />
        ) : tab.kind === "text" ? (
          <LineNumberedText text={String(tab.value)} ariaLabel={tab.title} />
        ) : (
          <JsonTreeView value={tab.value} showToolbar={false} />
        )}
      </div>
    </div>
  );
}
