import { describe, expect, it } from "vitest";
import {
  batchByteLength,
  batchProblem,
  DraftMessage,
  duplicateMessage,
  emptyHeader,
  emptyMessage,
  encodedByteLength,
  formatBytes,
  MAX_PUBLISH_MESSAGES,
  messageByteLength,
  messageProblem,
  PAYLOAD_ENCODINGS,
  toWireMessages,
} from "./publishMessages";

const BIG = 1024 * 1024;

function message(overrides: Partial<DraftMessage> = {}): DraftMessage {
  return { ...emptyMessage(), ...overrides };
}

describe("emptyMessage", () => {
  // An empty key is a real key that partitions like any other; nobody means to
  // send one by leaving a box untouched, so the default has to be null.
  it("starts with a null key and an empty text value", () => {
    const fresh = emptyMessage();
    expect(fresh.key).toEqual({ encoding: "null", text: "" });
    expect(fresh.value).toEqual({ encoding: "text", text: "" });
    expect(fresh.headers).toEqual([]);
  });

  it("gives every message a distinct local id", () => {
    expect(emptyMessage().id).not.toBe(emptyMessage().id);
  });
});

describe("duplicateMessage", () => {
  it("copies the contents", () => {
    const original = message({
      key: { encoding: "text", text: "k" },
      value: { encoding: "json", text: "{}" },
      headers: [{ ...emptyHeader(), key: "h", value: { encoding: "text", text: "v" } }],
    });
    const copy = duplicateMessage(original);

    expect(copy.key).toEqual(original.key);
    expect(copy.value).toEqual(original.value);
    expect(copy.headers[0].key).toBe("h");
    expect(copy.headers[0].value).toEqual({ encoding: "text", text: "v" });
  });

  it("gives the copy and its headers fresh ids, so editing one does not edit the other", () => {
    const original = message({ headers: [emptyHeader()] });
    const copy = duplicateMessage(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.headers[0].id).not.toBe(original.headers[0].id);
    // And the objects are not shared, so a patch to one leaves the other alone.
    expect(copy.key).not.toBe(original.key);
    expect(copy.headers[0].value).not.toBe(original.headers[0].value);
  });
});

describe("encodedByteLength", () => {
  it("counts UTF-8 bytes, not characters", () => {
    // 4 characters, 7 bytes — a character count would under-report the size and
    // let a message through that the broker then rejects.
    expect(encodedByteLength({ encoding: "text", text: "a£€x" })).toBe(7);
  });

  it("counts a null field as nothing", () => {
    expect(encodedByteLength({ encoding: "null", text: "ignored" })).toBe(0);
  });

  it("counts a base64 field by its decoded length", () => {
    expect(encodedByteLength({ encoding: "base64", text: "AAECqg==" })).toBe(4);
  });

  it("counts invalid base64 as nothing rather than throwing", () => {
    expect(encodedByteLength({ encoding: "base64", text: "%%%" })).toBe(0);
  });

  it("counts JSON by its text, which is what gets sent", () => {
    expect(encodedByteLength({ encoding: "json", text: '{"a":1}' })).toBe(7);
  });
});

describe("messageByteLength", () => {
  // The broker's message.max.bytes covers the whole record, so a size that
  // counted only the payload would pass records it then refuses.
  it("counts the key, the value and the headers", () => {
    const size = messageByteLength(
      message({
        key: { encoding: "text", text: "keyy" },
        value: { encoding: "text", text: "12345678" },
        headers: [{ ...emptyHeader(), key: "abc", value: { encoding: "text", text: "defg" } }],
      }),
    );
    expect(size).toBe(4 + 8 + 3 + 4);
  });

  it("is zero for an entirely null message", () => {
    expect(
      messageByteLength(
        message({ key: { encoding: "null", text: "" }, value: { encoding: "null", text: "" } }),
      ),
    ).toBe(0);
  });
});

describe("batchByteLength", () => {
  it("totals every message", () => {
    const one = message({ value: { encoding: "text", text: "12345" } });
    expect(batchByteLength([one, one, one])).toBe(15);
  });

  it("is zero for an empty batch", () => {
    expect(batchByteLength([])).toBe(0);
  });
});

describe("messageProblem", () => {
  it("passes a valid message", () => {
    expect(messageProblem(message({ value: { encoding: "text", text: "hi" } }), BIG)).toBeNull();
  });

  it("rejects malformed JSON", () => {
    const problem = messageProblem(message({ value: { encoding: "json", text: "{" } }), BIG);
    expect(problem).toBe("Value is not valid JSON");
  });

  it("rejects JSON left empty, which is not a document", () => {
    expect(messageProblem(message({ value: { encoding: "json", text: "  " } }), BIG)).toBe(
      "Value is set to JSON but empty",
    );
  });

  it("accepts valid JSON", () => {
    expect(
      messageProblem(message({ value: { encoding: "json", text: '{"a":[1,2]}' } }), BIG),
    ).toBeNull();
  });

  it("rejects invalid base64", () => {
    expect(messageProblem(message({ value: { encoding: "base64", text: "not!base64" } }), BIG)).toBe(
      "Value is not valid base64",
    );
  });

  it("accepts base64 with the whitespace a paste brings with it", () => {
    expect(
      messageProblem(message({ value: { encoding: "base64", text: " AAECqg==\n" } }), BIG),
    ).toBeNull();
  });

  it("names the key when the key is what is wrong", () => {
    expect(
      messageProblem(message({ key: { encoding: "json", text: "nope" } }), BIG),
    ).toBe("Key is not valid JSON");
  });

  it("reports the key before the value, so the first problem named is the first one on screen", () => {
    const problem = messageProblem(
      message({
        key: { encoding: "json", text: "nope" },
        value: { encoding: "json", text: "also nope" },
      }),
      BIG,
    );
    expect(problem).toBe("Key is not valid JSON");
  });

  it("rejects a header with no name", () => {
    expect(
      messageProblem(message({ headers: [{ ...emptyHeader(), key: "   " }] }), BIG),
    ).toBe("A header has no name");
  });

  it("names the header whose value is invalid", () => {
    expect(
      messageProblem(
        message({
          headers: [{ ...emptyHeader(), key: "trace-id", value: { encoding: "base64", text: "!!" } }],
        }),
        BIG,
      ),
    ).toBe('Header "trace-id" is not valid base64');
  });

  it("rejects a message over the configured Max Message Size", () => {
    const problem = messageProblem(message({ value: { encoding: "text", text: "x".repeat(20) } }), 16);
    expect(problem).toBe("20 bytes is over the 16 byte Max Message Size");
  });

  it("allows a message exactly at the ceiling", () => {
    expect(
      messageProblem(message({ value: { encoding: "text", text: "x".repeat(16) } }), 16),
    ).toBeNull();
  });

  it("accepts a null value, which is a tombstone rather than a missing field", () => {
    expect(
      messageProblem(
        message({ key: { encoding: "text", text: "k" }, value: { encoding: "null", text: "" } }),
        BIG,
      ),
    ).toBeNull();
  });
});

describe("batchProblem", () => {
  it("passes a valid batch", () => {
    expect(batchProblem([message({ value: { encoding: "text", text: "a" } })], BIG)).toBeNull();
  });

  it("refuses an empty batch", () => {
    expect(batchProblem([], BIG)).toBe("There are no messages to publish");
  });

  it("refuses more messages than one publish carries", () => {
    const many = Array.from({ length: MAX_PUBLISH_MESSAGES + 1 }, () => emptyMessage());
    expect(batchProblem(many, BIG)).toBe(
      `One publish carries at most ${MAX_PUBLISH_MESSAGES} messages`,
    );
  });

  it("allows exactly the maximum", () => {
    const many = Array.from({ length: MAX_PUBLISH_MESSAGES }, () =>
      message({ value: { encoding: "text", text: "x" } }),
    );
    expect(batchProblem(many, BIG)).toBeNull();
  });

  it("names the row a problem came from", () => {
    const problem = batchProblem(
      [
        message({ value: { encoding: "text", text: "fine" } }),
        message({ value: { encoding: "text", text: "fine" } }),
        message({ value: { encoding: "json", text: "{" } }),
      ],
      BIG,
    );
    // One-based, matching the "Message 3" heading the row is shown under.
    expect(problem).toBe("Message 3: Value is not valid JSON");
  });
});

describe("toWireMessages", () => {
  it("sends the declared encoding and the raw text, never bytes decoded here", () => {
    const wire = toWireMessages([
      message({
        key: { encoding: "text", text: "k" },
        value: { encoding: "base64", text: "AAEC" },
        headers: [{ ...emptyHeader(), key: "h", value: { encoding: "null", text: "" } }],
      }),
    ]);

    expect(wire).toEqual([
      {
        key: { encoding: "text", text: "k" },
        value: { encoding: "base64", text: "AAEC" },
        headers: [{ key: "h", value: { encoding: "null", text: "" } }],
      },
    ]);
  });

  it("drops the local ids, which mean nothing to the backend", () => {
    const wire = toWireMessages([message({ headers: [emptyHeader()] })]);
    expect(wire[0]).not.toHaveProperty("id");
    expect(wire[0].headers[0]).not.toHaveProperty("id");
  });

  it("preserves message order, which is the order they are published in", () => {
    const wire = toWireMessages([
      message({ value: { encoding: "text", text: "first" } }),
      message({ value: { encoding: "text", text: "second" } }),
    ]);
    expect(wire.map((m) => m.value.text)).toEqual(["first", "second"]);
  });
});

describe("PAYLOAD_ENCODINGS", () => {
  it("offers exactly the four the backend understands", () => {
    expect(PAYLOAD_ENCODINGS.map((e) => e.id)).toEqual(["text", "json", "base64", "null"]);
  });
});

describe("formatBytes", () => {
  it("says byte, singular, for one", () => {
    expect(formatBytes(1)).toBe("1 byte");
  });

  it("says bytes for none and for many", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(2)).toBe("2 bytes");
  });

  it("groups thousands, so a large message is readable at a glance", () => {
    expect(formatBytes(1048576)).toBe("1,048,576 bytes");
  });
});
