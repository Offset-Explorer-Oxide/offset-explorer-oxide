import { NewPublishMessage, PayloadEncoding, PublishField } from "../../lib/tauri";

/**
 * The Publish tab's model: an editable list of messages, and the rules for
 * inspecting one before it is sent.
 *
 * Every rule here is *also* enforced in Rust by `encode_messages`, which is the
 * authority — a crafted IPC call never reaches this file. These exist so the
 * user finds out about a malformed payload while they are typing it rather than
 * after a round trip, and so the Publish button can be disabled instead of
 * offering an action that is already known to fail.
 */

/** Mirrors `MAX_PUBLISH_BATCH_MESSAGES` in `salty_core::publish`. */
export const MAX_PUBLISH_MESSAGES = 100;

export const PAYLOAD_ENCODINGS: { id: PayloadEncoding; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "json", label: "JSON" },
  { id: "base64", label: "Base64" },
  { id: "null", label: "Null" },
];

/** One row in the editor. `id` is local only — it keys React lists and survives reordering/removal. */
export interface DraftMessage {
  id: string;
  key: PublishField;
  value: PublishField;
  headers: DraftHeader[];
}

export interface DraftHeader {
  id: string;
  key: string;
  value: PublishField;
}

let nextId = 0;
function localId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function emptyMessage(): DraftMessage {
  return {
    id: localId("message"),
    // A null key by default, not an empty one: an empty key is a real key that
    // partitions like any other, and nobody means to send one by leaving a box
    // untouched.
    key: { encoding: "null", text: "" },
    value: { encoding: "text", text: "" },
    headers: [],
  };
}

export function emptyHeader(): DraftHeader {
  return { id: localId("header"), key: "", value: { encoding: "text", text: "" } };
}

/** Duplicates a row, contents and all, under a fresh set of local ids. */
export function duplicateMessage(message: DraftMessage): DraftMessage {
  return {
    ...message,
    id: localId("message"),
    key: { ...message.key },
    value: { ...message.value },
    headers: message.headers.map((header) => ({
      ...header,
      id: localId("header"),
      value: { ...header.value },
    })),
  };
}

/** UTF-8 byte length, not character count — what the broker's size limit counts. */
export function encodedByteLength(field: PublishField): number {
  switch (field.encoding) {
    case "null":
      return 0;
    case "base64": {
      const decoded = decodeBase64(field.text);
      return decoded === null ? 0 : decoded;
    }
    default:
      return new TextEncoder().encode(field.text).length;
  }
}

/**
 * The decoded length of a base64 string, or `null` if it is not valid base64.
 * Uses `atob` for validation rather than arithmetic on the string length, so
 * that what the UI calls valid is what a decoder accepts.
 */
function decodeBase64(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  try {
    return atob(trimmed).length;
  } catch {
    return null;
  }
}

/** Total bytes a message will occupy — key, value and headers, the way the broker counts a record. */
export function messageByteLength(message: DraftMessage): number {
  const headers = message.headers.reduce(
    (total, header) =>
      total + new TextEncoder().encode(header.key).length + encodedByteLength(header.value),
    0,
  );
  return encodedByteLength(message.key) + encodedByteLength(message.value) + headers;
}

/** "1 byte" / "1,024 bytes" — the grid and footer both show single-byte messages. */
export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} byte${bytes === 1 ? "" : "s"}`;
}

export function batchByteLength(messages: DraftMessage[]): number {
  return messages.reduce((total, message) => total + messageByteLength(message), 0);
}

function fieldProblem(field: PublishField, what: string): string | null {
  if (field.encoding === "json") {
    if (field.text.trim().length === 0) return `${what} is set to JSON but empty`;
    try {
      JSON.parse(field.text);
    } catch {
      return `${what} is not valid JSON`;
    }
  }
  if (field.encoding === "base64" && decodeBase64(field.text) === null) {
    return `${what} is not valid base64`;
  }
  return null;
}

/**
 * What is wrong with one message, or `null` if nothing is. One problem at a
 * time, in reading order, so the message shown is the next thing to fix rather
 * than a list to work through.
 */
export function messageProblem(message: DraftMessage, maxMessageSizeBytes: number): string | null {
  const keyProblem = fieldProblem(message.key, "Key");
  if (keyProblem) return keyProblem;
  const valueProblem = fieldProblem(message.value, "Value");
  if (valueProblem) return valueProblem;

  for (const header of message.headers) {
    if (header.key.trim().length === 0) return "A header has no name";
    const problem = fieldProblem(header.value, `Header "${header.key}"`);
    if (problem) return problem;
  }

  const size = messageByteLength(message);
  if (size > maxMessageSizeBytes) {
    return `${size.toLocaleString()} bytes is over the ${maxMessageSizeBytes.toLocaleString()} byte Max Message Size`;
  }
  return null;
}

/**
 * Why the batch cannot be published, or `null` if it can. Checked per message
 * as well as overall, so the reason names the row it came from.
 */
export function batchProblem(messages: DraftMessage[], maxMessageSizeBytes: number): string | null {
  if (messages.length === 0) return "There are no messages to publish";
  if (messages.length > MAX_PUBLISH_MESSAGES) {
    return `One publish carries at most ${MAX_PUBLISH_MESSAGES} messages`;
  }
  for (const [index, message] of messages.entries()) {
    const problem = messageProblem(message, maxMessageSizeBytes);
    if (problem) return `Message ${index + 1}: ${problem}`;
  }
  return null;
}

/**
 * Strips the local ids and hands the backend what it expects. The encoding and
 * the raw text go over the wire — never bytes this file produced — so Rust
 * remains the only thing that decides what the payload is.
 */
export function toWireMessages(messages: DraftMessage[]): NewPublishMessage[] {
  return messages.map((message) => ({
    key: { encoding: message.key.encoding, text: message.key.text },
    value: { encoding: message.value.encoding, text: message.value.text },
    headers: message.headers.map((header) => ({
      key: header.key,
      value: { encoding: header.value.encoding, text: header.value.text },
    })),
  }));
}
