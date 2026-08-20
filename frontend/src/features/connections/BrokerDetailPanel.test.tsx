import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { BrokerDetailPanel } from "./BrokerDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BrokerDetailPanel", () => {
  it("shows the broker's id, host, and port", async () => {
    setInvokeHandlers({
      connection_list_brokers: () => [{ id: 3, host: "broker3.local", port: 9095 }],
      connection_is_connected: () => true,
    });
    renderWithClient(<BrokerDetailPanel connectionId="1" brokerId={3} />);

    expect(await screen.findByLabelText("Broker ID")).toHaveValue("3");
    expect(screen.getByLabelText("Host")).toHaveValue("broker3.local");
    expect(screen.getByLabelText("Port")).toHaveValue("9095");
  });

  it("disables the fields while the owning cluster is connected", async () => {
    setInvokeHandlers({
      connection_list_brokers: () => [{ id: 3, host: "broker3.local", port: 9095 }],
      connection_is_connected: () => true,
    });
    renderWithClient(<BrokerDetailPanel connectionId="1" brokerId={3} />);

    expect(await screen.findByLabelText("Broker ID")).toBeDisabled();
    expect(screen.getByLabelText("Host")).toBeDisabled();
    expect(screen.getByLabelText("Port")).toBeDisabled();
  });

  it("leaves the fields enabled when the owning cluster is not connected", async () => {
    setInvokeHandlers({
      connection_list_brokers: () => [{ id: 3, host: "broker3.local", port: 9095 }],
      connection_is_connected: () => false,
    });
    renderWithClient(<BrokerDetailPanel connectionId="1" brokerId={3} />);

    expect(await screen.findByLabelText("Broker ID")).toBeEnabled();
  });
});
