import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { IdleTimerProvider } from "./IdleTimerProvider";
import { IDLE_DISCONNECT_MS } from "./idleDisconnect";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IdleTimerProvider>
        <div>content</div>
      </IdleTimerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IdleTimerProvider", () => {
  it("disconnects connected connections after 120 minutes with no activity", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [{ id: "1", name: "prod" }],
      connection_is_connected: () => true,
      connection_disconnect: disconnect,
    });
    renderProvider();

    await vi.advanceTimersByTimeAsync(IDLE_DISCONNECT_MS);

    expect(disconnect).toHaveBeenCalledWith({ id: "1" });
  });

  it("does not disconnect before 120 minutes have elapsed", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [{ id: "1", name: "prod" }],
      connection_is_connected: () => true,
      connection_disconnect: disconnect,
    });
    renderProvider();

    await vi.advanceTimersByTimeAsync(IDLE_DISCONNECT_MS - 1000);

    expect(disconnect).not.toHaveBeenCalled();
  });

  it("resets the idle clock on activity, so 120 minutes of accumulated-but-interrupted time does not trigger a disconnect", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [{ id: "1", name: "prod" }],
      connection_is_connected: () => true,
      connection_disconnect: disconnect,
    });
    renderProvider();

    await vi.advanceTimersByTimeAsync(IDLE_DISCONNECT_MS - 1000);
    window.dispatchEvent(new MouseEvent("mousemove"));
    await vi.advanceTimersByTimeAsync(IDLE_DISCONNECT_MS - 1000);

    expect(disconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(disconnect).toHaveBeenCalledWith({ id: "1" });
  });

  it("stops the timer on unmount", async () => {
    const disconnect = vi.fn(() => undefined);
    setInvokeHandlers({
      connection_list: () => [{ id: "1", name: "prod" }],
      connection_is_connected: () => true,
      connection_disconnect: disconnect,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <IdleTimerProvider>
          <div>content</div>
        </IdleTimerProvider>
      </QueryClientProvider>,
    );

    unmount();
    await vi.advanceTimersByTimeAsync(IDLE_DISCONNECT_MS);

    expect(disconnect).not.toHaveBeenCalled();
  });
});
