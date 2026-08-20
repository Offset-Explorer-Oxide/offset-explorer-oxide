import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { TopicDetailPanel } from "./TopicDetailPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("TopicDetailPanel", () => {
  it("opens on the Data tab by default", () => {
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText("Topic name")).not.toBeInTheDocument();
  });

  it("renders Properties, Data, Partitions, Config, and Schema tabs", () => {
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    expect(screen.getByRole("tab", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Partitions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schema" })).toBeInTheDocument();
  });

  it("switches to the Schema tab when clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => null });
    const user = userEvent.setup();
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("tab", { name: "Schema" }));

    expect(await screen.findByLabelText("Avro schema")).toBeInTheDocument();
  });

  it("switches to the Properties tab when clicked, showing the topic name", async () => {
    const user = userEvent.setup();
    renderWithClient(<TopicDetailPanel connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(screen.getByRole("tab", { name: "Properties" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Topic name")).toHaveValue("orders");
  });
});
