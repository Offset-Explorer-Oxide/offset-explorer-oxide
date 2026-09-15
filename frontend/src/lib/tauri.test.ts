import { describe, expect, it, vi } from "vitest";
import { setInvokeHandlers } from "./testInvoke";
import { api } from "./tauri";
import { useGeneralSettingsStore } from "../features/settings/useGeneralSettingsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("invoke error normalization", () => {
  it("converts a Tauri command's plain-object rejection into a real Error instance", async () => {
    // This is what a real `CommandError { message: String }` rejection
    // actually looks like once it crosses the Tauri IPC boundary — a plain
    // object, not a JS Error. Every `err instanceof Error` check in the app
    // depends on this being normalized here.
    setInvokeHandlers({
      connection_connect: () => {
        throw { message: "SSL connection closed by peer" };
      },
    });

    await expect(api.connectConnection("1")).rejects.toBeInstanceOf(Error);
    await expect(api.connectConnection("1")).rejects.toThrow("SSL connection closed by peer");
  });

  it("leaves an already-real Error instance unchanged", async () => {
    setInvokeHandlers({
      connection_connect: () => {
        throw new Error("already a real error");
      },
    });

    await expect(api.connectConnection("1")).rejects.toThrow("already a real error");
  });

  it("falls back to String(err) when the rejection has no message field", async () => {
    setInvokeHandlers({
      connection_connect: () => {
        throw "just a string";
      },
    });

    await expect(api.connectConnection("1")).rejects.toThrow("just a string");
  });
});

describe("publishMessages", () => {
  it("sends the messages verbatim, with the user's size and timeout settings", async () => {
    const publish = vi.fn(() => ({ delivered: [], failure: null, notAttempted: 0 }));
    setInvokeHandlers({ connection_publish_messages: publish });
    useGeneralSettingsStore.setState({ maxMessageSizeBytes: 5_000_000, brokerReadTimeoutMs: 20_000 });

    await api.publishMessages("conn-1", "orders", 2, [
      { key: { encoding: "null", text: "" }, value: { encoding: "text", text: "hi" }, headers: [] },
    ]);

    expect(publish).toHaveBeenCalledWith({
      id: "conn-1",
      topic: "orders",
      partition: 2,
      messages: [
        { key: { encoding: "null", text: "" }, value: { encoding: "text", text: "hi" }, headers: [] },
      ],
      maxMessageSizeBytes: 5_000_000,
      writeTimeoutMs: 20_000,
    });
  });

  it("returns the outcome for a publish that failed part-way, rather than rejecting", async () => {
    // A partial publish is the one case where the result matters more than the
    // error: it is the only thing that says which messages are now on the topic.
    const outcome = {
      delivered: [{ index: 0, partition: 2, offset: 7 }],
      failure: { index: 1, kind: "authorization" as const, reason: "no write access" },
      notAttempted: 3,
    };
    setInvokeHandlers({ connection_publish_messages: () => outcome });

    await expect(api.publishMessages("conn-1", "orders", 2, [])).resolves.toEqual(outcome);
  });

  it("rejects with the backend's message when a gate refuses the publish", async () => {
    setInvokeHandlers({
      connection_publish_messages: () => {
        throw { message: "validation error: publishing is disabled for this connection" };
      },
    });

    await expect(api.publishMessages("conn-1", "orders", 0, [])).rejects.toThrow(
      "publishing is disabled for this connection",
    );
  });
});

describe("writeDeniedReason", () => {
  it("asks about one connection and topic", async () => {
    const reason = vi.fn(() => "no write access");
    setInvokeHandlers({ connection_write_denied_reason: reason });

    await expect(api.writeDeniedReason("conn-1", "orders")).resolves.toBe("no write access");
    expect(reason).toHaveBeenCalledWith({ id: "conn-1", topic: "orders" });
  });

  it("reports null for a topic with no recorded denial", async () => {
    setInvokeHandlers({ connection_write_denied_reason: () => null });
    await expect(api.writeDeniedReason("conn-1", "orders")).resolves.toBeNull();
  });
});
