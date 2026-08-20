import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { setInvokeHandlers } from "./testInvoke";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("setInvokeHandlers", () => {
  it("resolves with the handler's return value for a registered command", async () => {
    setInvokeHandlers({
      made_up_command: (args) => ({ received: args }),
    });

    const result = await invoke("made_up_command", { foo: "bar" });

    expect(result).toEqual({ received: { foo: "bar" } });
  });

  it("rejects with a descriptive error for an unregistered command", async () => {
    setInvokeHandlers({
      made_up_command: () => "ok",
    });

    await expect(invoke("other_command")).rejects.toThrow(
      "no mock handler for command: other_command",
    );
  });
});
