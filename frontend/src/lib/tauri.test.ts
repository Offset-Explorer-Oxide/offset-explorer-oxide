import { describe, expect, it, vi } from "vitest";
import { setInvokeHandlers } from "./testInvoke";
import { api } from "./tauri";

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
