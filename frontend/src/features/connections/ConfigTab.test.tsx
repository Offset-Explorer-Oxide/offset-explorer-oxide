import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { ConfigTab } from "./ConfigTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConfigTab", () => {
  it("shows a loading state before config arrives", () => {
    setInvokeHandlers({ connection_describe_topic_config: () => [] });
    renderWithClient(<ConfigTab connectionId="1" topicName="orders" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("lists each config entry's name and value", async () => {
    setInvokeHandlers({
      connection_describe_topic_config: () => [
        { name: "retention.ms", value: "604800000" },
        { name: "cleanup.policy", value: "delete" },
      ],
    });
    renderWithClient(<ConfigTab connectionId="1" topicName="orders" />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "retention.ms",
      "604800000",
    ]);
    expect(within(rows[2]).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "cleanup.policy",
      "delete",
    ]);
  });

  it("shows a null value as a dash rather than blank", async () => {
    setInvokeHandlers({
      connection_describe_topic_config: () => [{ name: "some.key", value: null }],
    });
    renderWithClient(<ConfigTab connectionId="1" topicName="orders" />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["some.key", "—"]);
  });
});
