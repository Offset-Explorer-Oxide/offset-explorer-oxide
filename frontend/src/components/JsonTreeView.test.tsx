import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonTreeView } from "./JsonTreeView";

describe("JsonTreeView", () => {
  it("renders primitive values with their keys", () => {
    render(<JsonTreeView value={{ name: "orders", count: 3, active: true, note: null }} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText('"orders"')).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });

  it("renders nested objects and arrays expanded by default", () => {
    render(<JsonTreeView value={{ user: { id: 1, tags: ["a", "b"] } }} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText('"a"')).toBeInTheDocument();
    expect(screen.getByText('"b"')).toBeInTheDocument();
  });

  it("collapses a node when its arrow is clicked, hiding its children", async () => {
    const user = userEvent.setup();
    render(<JsonTreeView value={{ user: { id: 1 } }} onOpenInNewTab={vi.fn()} />);
    expect(screen.getByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse user" }));

    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText(/1 keys/)).toBeInTheDocument();
  });

  it("re-expands a collapsed node when its arrow is clicked again", async () => {
    const user = userEvent.setup();
    render(<JsonTreeView value={{ user: { id: 1 } }} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Collapse user" }));
    await user.click(screen.getByRole("button", { name: "Expand user" }));

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows array indices as labels", () => {
    render(<JsonTreeView value={["first", "second"]} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText("0:")).toBeInTheDocument();
    expect(screen.getByText("1:")).toBeInTheDocument();
  });

  it("copies the pretty-printed JSON to the clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    const user = userEvent.setup();
    render(<JsonTreeView value={{ a: 1 }} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
  });

  it("shows 'Copied!' briefly after copying", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<JsonTreeView value={{ a: 1 }} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("calls onOpenInNewTab when the 'Open in new tab' button is clicked", async () => {
    const onOpenInNewTab = vi.fn();
    const user = userEvent.setup();
    render(<JsonTreeView value={{ a: 1 }} onOpenInNewTab={onOpenInNewTab} />);

    await user.click(screen.getByRole("button", { name: "Open in new tab" }));

    expect(onOpenInNewTab).toHaveBeenCalled();
  });

  it("hides the 'Open in new tab' button when onOpenInNewTab isn't provided", () => {
    render(<JsonTreeView value={{ a: 1 }} />);

    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
  });
});
