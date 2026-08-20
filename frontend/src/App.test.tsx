import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { useJsonViewerTabsStore } from "./features/tabs/useJsonViewerTabsStore";
import { useTabsStore } from "./features/tabs/useTabsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const save = vi.fn();
const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
  open: (...args: unknown[]) => open(...args),
}));

describe("App", () => {
  it("renders the shell with tab bar, sidebar, and bottom panel", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<App />);

    expect(await screen.findByText("No connections yet. Add one to get started.")).toBeInTheDocument();
    expect(screen.getByText("Select a cluster, broker, or topic.")).toBeInTheDocument();
    expect(screen.getByLabelText("New tab")).toBeInTheDocument();
  });

  it("opens the New Connection modal when the sidebar button is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    expect(screen.queryByRole("dialog", { name: "New Connection" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add Cluster" }));

    expect(screen.getByRole("dialog", { name: "New Connection" })).toBeInTheDocument();
  });

  it("exports every connection when Export All is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      if (command === "connections_export") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    save.mockResolvedValue("/tmp/kafkaoxide-connections.json");
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    await user.click(screen.getByRole("button", { name: "Export All" }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "kafkaoxide-connections.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("connections_export", {
        ids: null,
        path: "/tmp/kafkaoxide-connections.json",
      }),
    );
  });

  it("does not export when the Export All save dialog is cancelled", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    save.mockResolvedValue(null);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");
    vi.mocked(invoke).mockClear();

    await user.click(screen.getByRole("button", { name: "Export All" }));

    expect(invoke).not.toHaveBeenCalledWith("connections_export", expect.anything());
  });

  it("imports connections and shows a summary alert when Import is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      if (command === "connections_import") return Promise.resolve({ imported: 2, skipped: 1 });
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    open.mockResolvedValue("/tmp/kafkaoxide-connections.json");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false }),
    );
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/imported 2.*skipped 1/i)));
  });

  it("does not import when the Import open dialog is cancelled", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    open.mockResolvedValue(null);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");
    vi.mocked(invoke).mockClear();

    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(invoke).not.toHaveBeenCalledWith("connections_import", expect.anything());
  });

  it("opens the Settings panel via the gear icon and shows a closable Settings tab", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    await user.click(screen.getByLabelText("Open settings"));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close tab Settings"));

    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByText("Select a cluster, broker, or topic.")).toBeInTheDocument();
  });

  it("does not render the right pane until a message is selected", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    expect(screen.queryByTestId("resizable-pane-right")).not.toBeInTheDocument();
  });

  it("hides the left sidebar while a JSON/XML viewer tab is active, and restores it when switching away", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");
    expect(screen.getByTestId("resizable-pane-left")).toBeInTheDocument();

    const jsonTabId = useJsonViewerTabsStore.getState().openTab("Partition 0 · Offset 1", { a: 1 });
    useTabsStore.getState().selectTab(jsonTabId);

    await waitFor(() => expect(screen.getByTestId("resizable-pane-left")).not.toBeVisible());

    useTabsStore.setState({ activeTabId: null });

    await waitFor(() => expect(screen.getByTestId("resizable-pane-left")).toBeVisible());
  });

  it("keeps the connection tree's expanded state when switching to a JSON tab and back", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([{ id: "1", name: "Local Kafka" }]);
      if (command === "connection_check_status") return Promise.resolve("REACHABLE");
      if (command === "connection_is_connected") return Promise.resolve(true);
      if (command === "connection_list_brokers") return Promise.resolve([]);
      if (command === "connection_list_topics") return Promise.resolve([]);
      if (command === "connection_list_consumer_groups") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("Local Kafka");
    await user.click(await screen.findByLabelText("Expand Local Kafka"));
    expect(screen.getByLabelText("Collapse Local Kafka")).toBeInTheDocument();

    const jsonTabId = useJsonViewerTabsStore.getState().openTab("Partition 0 · Offset 1", { a: 1 });
    useTabsStore.getState().selectTab(jsonTabId);
    await waitFor(() => expect(screen.getByTestId("resizable-pane-left")).not.toBeVisible());

    useTabsStore.setState({ activeTabId: null });
    await waitFor(() => expect(screen.getByTestId("resizable-pane-left")).toBeVisible());

    expect(screen.getByLabelText("Collapse Local Kafka")).toBeInTheDocument();
  });
});
