import { useEffect, useState } from "react";
import {
  JsonTreeControl,
  JsonTreeExpansionContext,
  childCount,
  shouldAutoExpand,
  useJsonTreeControl,
  useJsonTreeExpansion,
} from "./jsonTreeExpansion";

export interface JsonTreeViewProps {
  value: unknown;
  /** Opens `value` as its own tab in the app (there's no browser to open a real new tab in). Omit to hide the button — e.g. a view that's already a dedicated JSON tab has nothing new to open. */
  onOpenInNewTab?: () => void;
  /** Numbers every rendered line down the left edge. Off by default — a tab-sized view of a small document reads better without the column. */
  lineNumbers?: boolean;
  /** Set false where the surrounding panel already provides copy/open/save controls for this value, so the two toolbars don't stack. */
  showToolbar?: boolean;
  /**
   * Drives Expand all from a button outside this component — the payload
   * panel's toolbar sits above the tree, not in it. Omit and the tree makes
   * its own, so nodes behave identically either way.
   */
  control?: JsonTreeControl;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" stroke="currentColor" />
      <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" stroke="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" stroke="currentColor" />
      <path d="M9.5 2.5h4v4M13.3 2.7L7.5 8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type JsonRecord = Record<string, unknown>;

function isExpandable(value: unknown): value is unknown[] | JsonRecord {
  return value !== null && typeof value === "object";
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

function primitiveTypeClass(value: unknown): string {
  if (value === null) return "json-tree-value--null";
  return `json-tree-value--${typeof value}`;
}

interface JsonNodeProps {
  label: string | null;
  value: unknown;
  depth: number;
}

function JsonNode({ label, value, depth }: JsonNodeProps) {
  // Containers worth more lines than the budget start collapsed. Everything
  // expanded is the right default for the documents this view was built for —
  // a Kafka message of a few KB — but the same default on a multi-megabyte
  // payload renders every node of it into the DOM at once, and the app stops
  // responding until the browser finishes laying out a tree nobody asked to
  // see in full. A container past that size is one the user has to scroll
  // anyway, so it costs a click and saves the freeze. See `shouldAutoExpand`
  // for why the measure is lines rather than entries.
  const [expanded, setExpanded] = useState(() => shouldAutoExpand(value, depth));
  const expansion = useJsonTreeExpansion();
  const expandAllToken = expansion?.expandAllToken ?? 0;
  const reportCollapsed = expansion?.reportCollapsed;

  // Fires on mount as well as on a later bump, which is the point: Expand all
  // has to reach the nodes that only come into existence as their parents
  // open. `useJsonTreeControl` resets the token for a new document so this
  // can't force-expand the next message the user clicks on.
  useEffect(() => {
    if (expandAllToken > 0) setExpanded(true);
  }, [expandAllToken]);

  // One collapsed node on screen is one thing Expand all can still do.
  useEffect(() => {
    if (!reportCollapsed || expanded || !isExpandable(value)) return;
    reportCollapsed(1);
    return () => reportCollapsed(-1);
  }, [expanded, reportCollapsed, value]);

  const indent = { paddingLeft: `${depth * 14}px` };

  if (!isExpandable(value)) {
    return (
      <div className="json-tree-line">
        <span className="json-tree-line-content" style={indent}>
          <span className="json-tree-indent" aria-hidden="true" />
          {label !== null && <span className="json-tree-key">{label}: </span>}
          <span className={`json-tree-value ${primitiveTypeClass(value)}`}>{formatPrimitive(value)}</span>
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div>
      <div className="json-tree-line">
        <span className="json-tree-line-content" style={indent}>
          <button
            type="button"
            className={`tree-caret-button${expanded ? " tree-caret-button--expanded" : ""}`}
            aria-label={expanded ? `Collapse ${label ?? "value"}` : `Expand ${label ?? "value"}`}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="tree-caret" aria-hidden="true" />
          </button>
          {label !== null && <span className="json-tree-key">{label}: </span>}
          <span className="json-tree-bracket">{openBracket}</span>
          {!expanded && (
            <>
              <span className="json-tree-summary">
                {entries.length} {isArray ? "items" : "keys"}
              </span>
              <span className="json-tree-bracket">{closeBracket}</span>
            </>
          )}
        </span>
      </div>
      {expanded && (
        <>
          {entries.map(([key, item]) => (
            <JsonNode key={key} label={key} value={item} depth={depth + 1} />
          ))}
          <div className="json-tree-line">
            <span className="json-tree-line-content" style={indent}>
              <span className="json-tree-indent" aria-hidden="true" />
              <span className="json-tree-bracket">{closeBracket}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A collapsible, syntax-highlighted JSON tree — every object/array node gets
 * an expand/collapse arrow. The toolbar has two icon buttons (label shown
 * on hover): copy the whole pretty-printed value to the clipboard, or open
 * it in its own tab in the app.
 */
export function JsonTreeView({
  value,
  onOpenInNewTab,
  lineNumbers = false,
  showToolbar = true,
  control,
}: JsonTreeViewProps) {
  const [copied, setCopied] = useState(false);
  // Hooks can't be called conditionally, so the fallback control is always
  // built; it just goes unused when the caller brought its own.
  const ownControl = useJsonTreeControl(value);
  const expansion = control ?? ownControl;

  async function handleCopy() {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="json-tree">
      {showToolbar && (
      <div className="json-tree-toolbar">
        {onOpenInNewTab && (
          <button
            type="button"
            className="json-tree-icon-button"
            title="Open in new tab"
            aria-label="Open in new tab"
            onClick={onOpenInNewTab}
          >
            <ExternalLinkIcon />
          </button>
        )}
        <button
          type="button"
          className="json-tree-icon-button"
          title={copied ? "Copied!" : "Copy"}
          aria-label={copied ? "Copied!" : "Copy"}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      )}
      <JsonTreeExpansionContext.Provider value={expansion}>
        <div className={`json-tree-body${lineNumbers ? " json-tree-body--numbered" : ""}`} role="tree">
          <JsonNode label={null} value={value} depth={0} />
        </div>
      </JsonTreeExpansionContext.Provider>
    </div>
  );
}
