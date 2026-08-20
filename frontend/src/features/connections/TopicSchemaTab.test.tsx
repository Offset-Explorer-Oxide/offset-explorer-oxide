import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { TopicSchemaTab } from "./TopicSchemaTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("TopicSchemaTab", () => {
  it("loads and shows the saved schema", async () => {
    setInvokeHandlers({ topic_schema_get: () => '{"type":"string"}' });
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);

    expect(await screen.findByLabelText("Avro schema")).toHaveValue('{"type":"string"}');
  });

  it("shows an empty editor when no schema is saved", async () => {
    setInvokeHandlers({ topic_schema_get: () => null });
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);

    expect(await screen.findByLabelText("Avro schema")).toHaveValue("");
  });

  it("saves the edited schema when Save is clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => null, topic_schema_set: () => undefined });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.type(screen.getByLabelText("Avro schema"), '{{"type":"string"}');
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("topic_schema_set", {
        connectionId: "1",
        topic: "orders",
        format: "avro",
        schemaText: '{"type":"string"}',
      });
    });
  });

  it("shows an alert when saving an invalid schema fails", async () => {
    setInvokeHandlers({
      topic_schema_get: () => null,
      topic_schema_set: () => {
        throw new Error("invalid Avro schema");
      },
    });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.type(screen.getByLabelText("Avro schema"), "not json");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid Avro schema");
  });

  it("clears the schema when Clear is clicked", async () => {
    setInvokeHandlers({ topic_schema_get: () => '{"type":"string"}', topic_schema_delete: () => undefined });
    const user = userEvent.setup();
    renderWithClient(<TopicSchemaTab connectionId="1" topicName="orders" />);
    await screen.findByLabelText("Avro schema");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("topic_schema_delete", { connectionId: "1", topic: "orders", format: "avro" });
    });
    expect(screen.getByLabelText("Avro schema")).toHaveValue("");
  });
});
