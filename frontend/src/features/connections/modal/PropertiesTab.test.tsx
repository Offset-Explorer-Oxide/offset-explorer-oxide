import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setInvokeHandlers } from "../../../lib/testInvoke";
import { emptyDraft } from "./draft";
import { PropertiesTab } from "./PropertiesTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PropertiesTab", () => {
  it("renders the General section's cluster name, bootstrap servers, and kafka version inputs", () => {
    const onChange = vi.fn();
    renderWithClient(<PropertiesTab draft={emptyDraft()} onChange={onChange} />);

    expect(screen.getByLabelText("Cluster name")).toBeInTheDocument();
    expect(screen.getByLabelText("Bootstrap servers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3\.7/ })).toBeInTheDocument();
  });

  it("lists 0.11 through 3.7 as kafka version options", async () => {
    const user = userEvent.setup();
    renderWithClient(<PropertiesTab draft={emptyDraft()} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /3\.7/ }));

    expect(screen.getByRole("option", { name: "0.11" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2.9" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3.0" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "✓ 3.7" })).toBeInTheDocument();
  });

  it("calls onChange when the cluster name is typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<PropertiesTab draft={emptyDraft()} onChange={onChange} />);

    await user.type(screen.getByLabelText("Cluster name"), "L");

    expect(onChange).toHaveBeenCalledWith({ name: "L" });
  });

  it("does not show zookeeper host/port/chroot fields until zookeeper is enabled", () => {
    renderWithClient(<PropertiesTab draft={emptyDraft()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Enable Zookeeper")).toBeInTheDocument();
    expect(screen.queryByLabelText("Zookeeper host")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zookeeper port")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Zookeeper chroot path")).not.toBeInTheDocument();
  });

  it("shows zookeeper host/port/chroot fields once zookeeper is enabled", () => {
    const draft = { ...emptyDraft(), zookeeperEnabled: true };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Zookeeper host")).toBeInTheDocument();
    expect(screen.getByLabelText("Zookeeper port")).toBeInTheDocument();
    expect(screen.getByLabelText("Zookeeper chroot path")).toBeInTheDocument();
  });

  it("pings the bootstrap servers and shows a success message", async () => {
    setInvokeHandlers({ connection_ping_bootstrap: () => "REACHABLE" });
    const user = userEvent.setup();
    const draft = { ...emptyDraft(), bootstrapServers: "localhost:9092" };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ping bootstrap servers" }));

    expect(await screen.findByText("Success")).toBeInTheDocument();
  });

  it("shows a failure message when the bootstrap servers ping is unreachable", async () => {
    setInvokeHandlers({ connection_ping_bootstrap: () => "UNREACHABLE" });
    const user = userEvent.setup();
    const draft = { ...emptyDraft(), bootstrapServers: "localhost:9092" };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ping bootstrap servers" }));

    expect(await screen.findByText(/unable to reach/i)).toBeInTheDocument();
  });

  it("disables the bootstrap servers ping button while bootstrap servers is empty", () => {
    renderWithClient(<PropertiesTab draft={emptyDraft()} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ping bootstrap servers" })).toBeDisabled();
  });

  it("pings zookeeper and shows a success message", async () => {
    setInvokeHandlers({ connection_ping_zookeeper: () => "REACHABLE" });
    const user = userEvent.setup();
    const draft = { ...emptyDraft(), zookeeperEnabled: true, zookeeperHost: "zk.local", zookeeperPort: "2181" };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ping zookeeper" }));

    await waitFor(() => expect(screen.getByText("Success")).toBeInTheDocument());
  });

  it("disables the zookeeper ping button until both host and port are filled in", () => {
    const draft = { ...emptyDraft(), zookeeperEnabled: true };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ping zookeeper" })).toBeDisabled();
  });

  it("keeps cluster name editable but disables every other field when disabled is true", () => {
    const draft = { ...emptyDraft(), zookeeperEnabled: true, zookeeperHost: "zk.local", zookeeperPort: "2181" };
    renderWithClient(<PropertiesTab draft={draft} onChange={vi.fn()} disabled />);

    expect(screen.getByLabelText("Cluster name")).toBeEnabled();
    expect(screen.getByLabelText("Bootstrap servers")).toBeDisabled();
    expect(screen.getByRole("button", { name: /3\.7/ })).toBeDisabled();
    expect(screen.getByLabelText("Enable Zookeeper")).toBeDisabled();
    expect(screen.getByLabelText("Zookeeper host")).toBeDisabled();
    expect(screen.getByLabelText("Zookeeper port")).toBeDisabled();
    expect(screen.getByLabelText("Zookeeper chroot path")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ping bootstrap servers" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ping zookeeper" })).toBeDisabled();
  });
});
