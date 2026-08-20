/** Decodes a base64 string (as sent by the backend) into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decodes bytes as UTF-8 text. */
export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Parses a JSON string into a value for JsonTreeView, or returns undefined if it isn't valid JSON. */
export function tryParseJson(text: string): unknown {
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface XmlElementNode {
  tag: string;
  attributes: [string, string][];
  children: XmlElementNode[];
  /** Trimmed text content — only set for a leaf element (no child elements). */
  text: string | null;
}

function elementToNode(el: Element): XmlElementNode {
  const attributes: [string, string][] = Array.from(el.attributes).map((attr) => [attr.name, attr.value]);
  const childElements = Array.from(el.children);
  const children = childElements.map(elementToNode);
  const text = childElements.length === 0 ? (el.textContent ?? "").trim() || null : null;
  return { tag: el.tagName, attributes, children, text };
}

/** Parses an XML string into a tree for XmlTreeView, or returns undefined if it isn't well-formed XML. */
export function tryParseXml(text: string): XmlElementNode | undefined {
  if (text.trim().length === 0) return undefined;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch {
    return undefined;
  }
  if (doc.querySelector("parsererror") || !doc.documentElement) return undefined;
  return elementToNode(doc.documentElement);
}

/** Pretty-prints an XmlElementNode back to indented XML text — used by XmlTreeView's Copy button. */
export function formatXmlNode(node: XmlElementNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const attrs = node.attributes.map(([key, value]) => ` ${key}="${value}"`).join("");
  if (node.children.length === 0) {
    return node.text
      ? `${indent}<${node.tag}${attrs}>${node.text}</${node.tag}>`
      : `${indent}<${node.tag}${attrs}/>`;
  }
  const children = node.children.map((child) => formatXmlNode(child, depth + 1)).join("\n");
  return `${indent}<${node.tag}${attrs}>\n${children}\n${indent}</${node.tag}>`;
}

export interface ConfluentAvroInfo {
  schemaId: number;
}

/**
 * Detects the Confluent Schema Registry wire format: a leading magic byte
 * (0x00) followed by a 4-byte big-endian schema id, then the Avro-encoded
 * body. Full Avro decoding requires fetching the schema from the registry
 * and isn't implemented — this only surfaces the schema id so the UI can
 * label the payload rather than silently mis-rendering it as text/JSON.
 */
export function detectConfluentAvro(bytes: Uint8Array): ConfluentAvroInfo | null {
  if (bytes.length < 5 || bytes[0] !== 0x00) return null;
  const schemaId = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
  return { schemaId: schemaId >>> 0 };
}
