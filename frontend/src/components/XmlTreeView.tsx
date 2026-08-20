import { useState } from "react";
import { formatXmlNode, XmlElementNode } from "../features/connections/payloadDecoding";

export interface XmlTreeViewProps {
  value: XmlElementNode;
  /** Opens `value` as its own tab in the app (there's no browser to open a real new tab in). Omit to hide the button — e.g. a view that's already a dedicated XML tab has nothing new to open. */
  onOpenInNewTab?: () => void;
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

function attributesSuffix(attributes: [string, string][]): string {
  if (attributes.length === 0) return "";
  return " " + attributes.map(([key, value]) => `${key}="${value}"`).join(" ");
}

interface XmlNodeProps {
  node: XmlElementNode;
  depth: number;
}

function XmlNode({ node, depth }: XmlNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const indent = { paddingLeft: `${depth * 14}px` };
  const openTag = `<${node.tag}${attributesSuffix(node.attributes)}>`;

  if (node.children.length === 0) {
    return (
      <div className="json-tree-line" style={indent}>
        <span className="json-tree-indent" aria-hidden="true" />
        <span className="json-tree-key">{openTag}</span>
        {node.text !== null && <span className="json-tree-value json-tree-value--string">{node.text}</span>}
        <span className="json-tree-key">{`</${node.tag}>`}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="json-tree-line" style={indent}>
        <button
          type="button"
          className={`tree-caret-button${expanded ? " tree-caret-button--expanded" : ""}`}
          aria-label={expanded ? `Collapse ${node.tag}` : `Expand ${node.tag}`}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="tree-caret" aria-hidden="true" />
        </button>
        <span className="json-tree-key">{openTag}</span>
        {!expanded && (
          <span className="json-tree-summary">
            {node.children.length} {node.children.length === 1 ? "child" : "children"}
          </span>
        )}
      </div>
      {expanded && (
        <>
          {node.children.map((child, index) => (
            <XmlNode key={index} node={child} depth={depth + 1} />
          ))}
          <div className="json-tree-line" style={indent}>
            <span className="json-tree-indent" aria-hidden="true" />
            <span className="json-tree-key">{`</${node.tag}>`}</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A collapsible XML element tree, mirroring JsonTreeView's look and
 * interaction (expand/collapse arrows, copy, open-in-new-tab) for XML
 * payloads.
 */
export function XmlTreeView({ value, onOpenInNewTab }: XmlTreeViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(formatXmlNode(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="json-tree">
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
      <div className="json-tree-body" role="tree">
        <XmlNode node={value} depth={0} />
      </div>
    </div>
  );
}
