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

/**
 * Decodes a base64 message key or header value (`TopicMessage.keyBase64`,
 * `MessageHeader.valueBase64`) into text for display. These fields are
 * arbitrary Kafka byte strings, not guaranteed UTF-8, so this is
 * display-only and lossy (invalid sequences become "�") — the base64 field
 * itself is what preserves the real bytes exactly.
 */
export function base64ToDisplayText(base64: string | null): string | null {
  if (base64 === null) return null;
  return bytesToText(base64ToBytes(base64));
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

/**
 * How much of a payload the Data tab's Value column decodes per row.
 *
 * A grid cell shows a single line, so decoding a whole message to render one
 * is wasted work — and on a topic of multi-megabyte JSON it is the work that
 * makes the grid unusable. Measured over 300 rows of 2 MB payloads: decoding
 * every row in full costs ~1.35s, and AG Grid's quick-filter cache then
 * retains ~600 MB of lowercased copies of them, against ~1ms and no
 * measurable retention for a bounded preview.
 *
 * 4 KB is far more than any cell can display, and generous enough that the
 * search box still matches the identifying fields at the top of a typical
 * JSON document.
 */
export const VALUE_PREVIEW_BYTES = 4096;

/**
 * Decodes the first [`VALUE_PREVIEW_BYTES`] of a payload for display in a
 * grid cell. Returns "" when the payload wasn't loaded.
 *
 * base64 packs 3 bytes into every 4 characters, so cutting on a multiple of
 * 4 leaves a prefix that still decodes on its own. A multi-byte character
 * straddling the cut becomes a replacement character — acceptable in a
 * one-line preview, and never seen by the payload viewer, which decodes the
 * real bytes.
 */
export function decodeValuePreview(payloadBase64: string | null): string {
  if (!payloadBase64) return "";

  const prefix = payloadBase64.slice(0, Math.ceil(VALUE_PREVIEW_BYTES / 3) * 4);
  const bytes = base64ToBytes(prefix);
  const avro = detectConfluentAvro(bytes);
  if (avro) return `Avro (schema id: ${avro.schemaId})`;
  return bytesToText(bytes);
}

/**
 * How many bytes a base64 string decodes to, without decoding it: every 4
 * characters carry 3 bytes, less one byte per '=' of padding.
 */
export function base64DecodedLength(base64: string): number {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * Whether a payload is longer than the preview [`decodeValuePreview`] builds
 * — i.e. whether the grid's Value column, and the search over it, sees only
 * part of this message.
 *
 * Takes the size the backend reported (`TopicMessage.payloadSizeBytes`)
 * rather than measuring the base64 it sent. Since the backend now truncates
 * payloads to the grid's preview bound, that base64 is itself a preview: a
 * message cut to exactly the bound is indistinguishable from one that was
 * genuinely that long, so measuring it would report every large message as
 * fitting comfortably.
 */
export function exceedsValuePreview(payloadSizeBytes: number | null): boolean {
  return payloadSizeBytes !== null && payloadSizeBytes > VALUE_PREVIEW_BYTES;
}

/**
 * Whether `payloadBase64` holds only part of the message it came from.
 *
 * The Data tab's fetch asks the backend for a bounded slice of each payload,
 * so a row's `payloadBase64` is usually a preview — enough for the grid's
 * one-line cell, never enough to display or decode as the message. Anything
 * that shows the payload itself has to check this and fetch the real bytes
 * for that single message first.
 */
export function isPayloadTruncated(payloadBase64: string | null, payloadSizeBytes: number | null): boolean {
  if (payloadBase64 === null || payloadSizeBytes === null) return false;
  return base64DecodedLength(payloadBase64) < payloadSizeBytes;
}

/**
 * The most of any one payload a grid fetch carries back.
 *
 * Deliberately not [`VALUE_PREVIEW_BYTES`], which the two used to share.
 * That constant is sized for what a *grid cell* decodes and what the search
 * box reads — 4 KB, ample for both — and using it as the transport bound too
 * meant every row of any ordinary JSON or Avro topic arrived truncated. The
 * payload viewer then had nothing whole to show, so opening a message went
 * back to the broker for its real bytes: a fresh consumer, a TLS and SASL
 * handshake, metadata and watermarks, on every single click. Carrying more
 * per row costs memory once, at fetch time, and makes opening anything that
 * fits instant again.
 *
 * 256 KB covers ordinary records many times over while still cutting the
 * multi-megabyte payloads this bound exists to cut.
 */
export const MAX_INLINE_PAYLOAD_BYTES = 256 * 1024;

/**
 * Total payload bytes one fetch's rows may hold in the webview at once.
 *
 * This is what keeps [`MAX_INLINE_PAYLOAD_BYTES`] from being the memory bug
 * again. A bound applied per row says nothing about what a fetch costs in
 * aggregate — 1,000 rows of multi-megabyte records is what killed the
 * webview — so the per-row bound is priced out of this budget rather than
 * fixed: the more rows a fetch asks for, the less of each payload it
 * carries.
 */
export const PAYLOAD_RETENTION_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * How much of each payload a fetch of `estimatedRows` rows may carry.
 *
 * Floored at [`VALUE_PREVIEW_BYTES`] and capped at
 * [`MAX_INLINE_PAYLOAD_BYTES`], so the bytes one fetch retains never exceed
 * `max(PAYLOAD_RETENTION_BUDGET_BYTES, rows * VALUE_PREVIEW_BYTES)` — and
 * that second term is exactly what a flat `VALUE_PREVIEW_BYTES` bound
 * retained. A fetch can therefore never hold more than the code this
 * replaced, whatever the user types into the filter form.
 *
 * `null` rows means the count isn't knowable from the filter alone (no
 * overall budget and no explicit partition list, so it is the topic's
 * partition count that decides), which takes the conservative floor.
 */
export function inlinePayloadBytesFor(estimatedRows: number | null): number {
  if (estimatedRows === null || estimatedRows <= 0) return VALUE_PREVIEW_BYTES;
  const perRow = Math.floor(PAYLOAD_RETENTION_BUDGET_BYTES / estimatedRows);
  return Math.min(MAX_INLINE_PAYLOAD_BYTES, Math.max(VALUE_PREVIEW_BYTES, perRow));
}
