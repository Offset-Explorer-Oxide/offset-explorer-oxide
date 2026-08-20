import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setInvokeHandlers } from "../../../lib/testInvoke";
import { ConnectionModal } from "./ConnectionModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function pointerEventAt(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectionModal", () => {
  it("opens on the Properties tab by default", () => {
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Properties" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Cluster name")).toBeInTheDocument();
  });

  it("switches to the Security tab when clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));

    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /PLAINTEXT/ })).toBeInTheDocument();
  });

  it("switches to the Advanced tab when clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Advanced" }));

    expect(screen.getByLabelText("Endpoint")).toBeInTheDocument();
  });

  it("switches to the Authentication tab when clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Authentication" }));

    expect(screen.getByRole("button", { name: /None/ })).toBeInTheDocument();
  });

  it("preserves field values entered on one tab after switching away and back", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Cluster name"), "Local Kafka");
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(screen.getByLabelText("Cluster name")).toHaveValue("Local Kafka");
  });

  it("calls onCancel and does not call onAdd when Cancel is clicked", async () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={onAdd} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows a validation error and does not call onAdd when required fields are missing", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={onAdd} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Cluster name is required");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd with the assembled connection when Add is clicked with valid fields", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={onAdd} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Cluster name"), "Local Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "localhost:9092");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Local Kafka", bootstrapServers: "localhost:9092" }),
    );
  });

  it("runs a connection test and shows success", async () => {
    setInvokeHandlers({ connection_test: () => "REACHABLE" });
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Cluster name"), "Local Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "localhost:9092");
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText("Connection succeeded")).toBeInTheDocument();
  });

  it("runs a connection test and shows failure", async () => {
    setInvokeHandlers({ connection_test: () => "UNREACHABLE" });
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Cluster name"), "Local Kafka");
    await user.type(screen.getByLabelText("Bootstrap servers"), "localhost:9092");
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText(/connection failed/i)).toBeInTheDocument();
  });

  it("shows a validation error rather than calling the test command when required fields are missing", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Cluster name is required");
  });

  it("moves with the pointer when dragged by its header", () => {
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New Connection" });
    const header = screen.getByText("New Connection").closest("header") as HTMLElement;

    act(() => {
      header.dispatchEvent(pointerEventAt("pointerdown", 100, 100));
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 140, 115));
    });

    expect(dialog).toHaveStyle({ transform: "translate(40px, 15px)" });
  });

  it("does not move when clicking inside the body, only from the header", () => {
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New Connection" });

    act(() => {
      screen.getByLabelText("Cluster name").dispatchEvent(pointerEventAt("pointerdown", 100, 100));
    });
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 140, 115));
    });

    expect(dialog).toHaveStyle({ transform: "translate(0px, 0px)" });
  });
});
