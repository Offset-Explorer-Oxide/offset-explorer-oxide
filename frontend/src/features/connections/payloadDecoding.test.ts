import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  base64ToDisplayText,
  bytesToText,
  decodeValuePreview,
  detectConfluentAvro,
  base64DecodedLength,
  exceedsValuePreview,
  isPayloadTruncated,
  formatXmlNode,
  tryParseJson,
  tryParseXml,
  VALUE_PREVIEW_BYTES,
} from "./payloadDecoding";

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("base64ToBytes / bytesToText", () => {
  it("round-trips plain text through base64", () => {
    const original = "hello world";
    const b64 = btoa(original);
    expect(bytesToText(base64ToBytes(b64))).toBe(original);
  });

  it("decodes UTF-8 multi-byte characters correctly", () => {
    const original = "héllo wörld 日本語";
    const bytes = Array.from(new TextEncoder().encode(original));
    expect(bytesToText(base64ToBytes(toBase64(bytes)))).toBe(original);
  });
});

describe("base64ToDisplayText", () => {
  it("decodes a base64 key/header value for display", () => {
    expect(base64ToDisplayText(btoa("order-1"))).toBe("order-1");
  });

  it("returns null unchanged, for a message/header with no key or value at all", () => {
    expect(base64ToDisplayText(null)).toBeNull();
  });

  it("does not throw on binary (non-UTF-8) bytes — shows the replacement character instead", () => {
    // A lone continuation byte (0x80) is invalid as the start of a UTF-8
    // sequence. This must degrade gracefully for display, since a real
    // binary key would fail identically — the underlying base64 field
    // itself (not this display helper) is what preserves the exact bytes.
    const binary = toBase64([0x80, 0x81]);
    expect(() => base64ToDisplayText(binary)).not.toThrow();
    expect(base64ToDisplayText(binary)).toContain("�");
  });
});

describe("tryParseJson", () => {
  it("parses valid JSON into a value", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns undefined for invalid JSON", () => {
    expect(tryParseJson("not json")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(tryParseJson("")).toBeUndefined();
  });
});

describe("tryParseXml", () => {
  it("parses a well-formed XML document into a tree", () => {
    expect(tryParseXml('<root a="1"><child>hi</child></root>')).toEqual({
      tag: "root",
      attributes: [["a", "1"]],
      children: [{ tag: "child", attributes: [], children: [], text: "hi" }],
      text: null,
    });
  });

  it("returns undefined for malformed XML", () => {
    expect(tryParseXml("<root><unclosed></root>")).toBeUndefined();
  });

  it("returns undefined for JSON text", () => {
    expect(tryParseXml('{"a":1}')).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(tryParseXml("")).toBeUndefined();
  });
});

describe("formatXmlNode", () => {
  it("pretty-prints a leaf element with text content", () => {
    expect(formatXmlNode({ tag: "a", attributes: [], children: [], text: "1" })).toBe("<a>1</a>");
  });

  it("pretty-prints a self-closing leaf element with no text", () => {
    expect(formatXmlNode({ tag: "a", attributes: [], children: [], text: null })).toBe("<a/>");
  });

  it("pretty-prints attributes inline with the opening tag", () => {
    expect(formatXmlNode({ tag: "user", attributes: [["id", "1"]], children: [], text: null })).toBe(
      '<user id="1"/>',
    );
  });

  it("pretty-prints nested children with indentation", () => {
    const tree = {
      tag: "root",
      attributes: [],
      children: [{ tag: "child", attributes: [], children: [], text: "hi" }],
      text: null,
    };
    expect(formatXmlNode(tree)).toBe("<root>\n  <child>hi</child>\n</root>");
  });
});

describe("detectConfluentAvro", () => {
  it("detects the Confluent wire format (magic byte 0 + 4-byte big-endian schema id)", () => {
    // magic byte 0x00, schema id 42 as 4-byte big-endian, then arbitrary avro body
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x2a, 0xde, 0xad, 0xbe, 0xef]);
    expect(detectConfluentAvro(bytes)).toEqual({ schemaId: 42 });
  });

  it("returns null when the magic byte is not 0", () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x2a]);
    expect(detectConfluentAvro(bytes)).toBeNull();
  });

  it("returns null for payloads too short to contain a schema id", () => {
    expect(detectConfluentAvro(new Uint8Array([0x00, 0x01]))).toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(detectConfluentAvro(new Uint8Array([]))).toBeNull();
  });
});

describe("decodeValuePreview", () => {
  const encodeText = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  it("is blank when the payload wasn't loaded", () => {
    expect(decodeValuePreview(null)).toBe("");
  });

  it("decodes a payload smaller than the preview limit in full", () => {
    expect(decodeValuePreview(encodeText('{"id":42}'))).toBe('{"id":42}');
  });

  /**
   * The regression this exists for: the Value column used to decode whole
   * payloads, so a grid of multi-megabyte messages spent seconds decoding
   * text no cell could show — and AG Grid then cached a lowercased copy of
   * every one of them for the quick filter.
   */
  it("stops at the preview limit instead of decoding a huge payload in full", () => {
    const payload = `${"a".repeat(VALUE_PREVIEW_BYTES * 4)}TAIL`;

    const preview = decodeValuePreview(encodeText(payload));

    expect(preview.length).toBeLessThan(payload.length);
    expect(preview).not.toContain("TAIL");
    expect(preview.startsWith("aaa")).toBe(true);
  });

  it("still recognises a Confluent Avro payload from its prefix", () => {
    // magic byte 0x00, schema id 7 as 4-byte big-endian, then an avro body.
    expect(decodeValuePreview(toBase64([0, 0, 0, 0, 7, 1, 2, 3]))).toBe("Avro (schema id: 7)");
  });
});

describe("exceedsValuePreview", () => {
  it("is false when the payload's size is unknown", () => {
    expect(exceedsValuePreview(null)).toBe(false);
  });

  it("is false for a payload the preview covers in full", () => {
    expect(exceedsValuePreview(VALUE_PREVIEW_BYTES)).toBe(false);
  });

  it("is true for a payload longer than the preview", () => {
    expect(exceedsValuePreview(VALUE_PREVIEW_BYTES + 1)).toBe(true);
  });

  // The size now comes from the backend rather than being inferred from the
  // base64 it sent: since the backend truncates payloads to the preview
  // bound, a payload cut to exactly that size is byte-for-byte
  // indistinguishable from one that was genuinely that long, and measuring
  // the base64 would call every large message "not oversized".
  it("reads the real size even for a payload whose base64 was truncated to the preview bound", () => {
    expect(exceedsValuePreview(3_145_728)).toBe(true);
  });
});

describe("base64DecodedLength", () => {
  const encodeBytes = (n: number) => btoa("a".repeat(n));

  it("counts the bytes a base64 string decodes to", () => {
    expect(base64DecodedLength(encodeBytes(3))).toBe(3);
    expect(base64DecodedLength(encodeBytes(4))).toBe(4);
    expect(base64DecodedLength(encodeBytes(5))).toBe(5);
    expect(base64DecodedLength(encodeBytes(6))).toBe(6);
  });

  it("is zero for an empty string", () => {
    expect(base64DecodedLength("")).toBe(0);
  });
});

describe("isPayloadTruncated", () => {
  const encodeBytes = (n: number) => btoa("a".repeat(n));

  it("is false when no payload was loaded at all", () => {
    expect(isPayloadTruncated(null, 5000)).toBe(false);
  });

  it("is false when the size is unknown", () => {
    expect(isPayloadTruncated(encodeBytes(10), null)).toBe(false);
  });

  it("is false when the base64 carries the whole payload", () => {
    expect(isPayloadTruncated(encodeBytes(100), 100)).toBe(false);
  });

  it("is true when the base64 carries less than the payload's real size", () => {
    expect(isPayloadTruncated(encodeBytes(4096), 3_145_728)).toBe(true);
  });
});
