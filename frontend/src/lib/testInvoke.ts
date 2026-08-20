import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

export function setInvokeHandlers(handlers: Record<string, (args: any) => unknown>) {
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    const handler = handlers[command];
    if (!handler) {
      return Promise.reject(new Error(`no mock handler for command: ${command}`));
    }
    return Promise.resolve(handler(args));
  });
}
