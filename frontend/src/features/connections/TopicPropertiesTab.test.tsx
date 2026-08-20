import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { TopicPropertiesTab } from "./TopicPropertiesTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TopicPropertiesTab", () => {
  it("shows the topic name, pre-filled and disabled for editing", () => {
    renderWithClient(<TopicPropertiesTab connectionId="1" topicName="orders" />);

    const nameInput = screen.getByLabelText("Topic name");
    expect(nameInput).toHaveValue("orders");
    expect(nameInput).toBeDisabled();
  });

  it("does not fetch the message count on render", () => {
    const countMessages = vi.fn(() => 42);
    setInvokeHandlers({ connection_count_topic_messages: countMessages });
    renderWithClient(<TopicPropertiesTab connectionId="1" topicName="orders" />);

    expect(countMessages).not.toHaveBeenCalled();
  });

  it("fetches and shows the total message count when Refresh is clicked", async () => {
    const countMessages = vi.fn(() => 42);
    setInvokeHandlers({ connection_count_topic_messages: countMessages });
    const user = userEvent.setup();
    renderWithClient(<TopicPropertiesTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(countMessages).toHaveBeenCalledWith({ id: "1", topic: "orders" }));
    expect(await screen.findByLabelText("Total number of messages")).toHaveValue("42");
  });

  it("shows an error if counting messages fails", async () => {
    setInvokeHandlers({
      connection_count_topic_messages: () => {
        throw new Error("Failed to count messages");
      },
    });
    const user = userEvent.setup();
    renderWithClient(<TopicPropertiesTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to count messages");
  });
});
