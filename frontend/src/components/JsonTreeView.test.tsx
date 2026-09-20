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

  /**
   * Expanding everything on sight is fine for an ordinary message and ruinous
   * for a multi-megabyte one: it renders every node of the document into the
   * DOM at once and the app stops responding until layout finishes.
   */
  it("starts a heavy array collapsed instead of rendering all of its children", async () => {
    const user = userEvent.setup();
    // 300 objects of four fields is around 1,800 rendered lines — over the
    // budget, and the shape that actually makes payloads megabytes long.
    const items = Array.from({ length: 300 }, (_, i) => ({
      id: `item-${i}`,
      quantity: i,
      sku: `sku-${i}`,
      note: "…",
    }));

    render(<JsonTreeView value={{ events: items }} />);

    expect(screen.queryByText('"item-0"')).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand events" }));
    expect(screen.getByText('"item-0"')).toBeInTheDocument();
  });

  /**
   * The rule counts rendered lines, not entries. A long list of primitives is
   * one line each — cheap — and used to collapse anyway on a count of 100,
   * while a much heavier list of 80 fat objects stayed open.
   */
  it("expands a long list of primitives, which is cheap to render", () => {
    const items = Array.from({ length: 500 }, (_, i) => `item-${i}`);

    render(<JsonTreeView value={{ events: items }} />);

    expect(screen.getByText('"item-0"')).toBeInTheDocument();
    expect(screen.getByText('"item-499"')).toBeInTheDocument();
  });

  /**
   * Collapsing the root would render the whole view as a single
   * `{ 3 keys }` line, so the outline stays open and the weight inside it is
   * what collapses.
   */
  it("keeps the root open on a document too big to expand, collapsing only the heavy node", () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `item-${i}`, sku: `sku-${i}`, note: "…" }));

    render(<JsonTreeView value={{ orderId: "a-1", events: items }} />);

    expect(screen.getByText('"a-1"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand events" })).toBeInTheDocument();
  });

  it("still expands an ordinary-sized container on sight", () => {
    render(<JsonTreeView value={{ order: { id: "a-1" } }} />);

    expect(screen.getByText('"a-1"')).toBeInTheDocument();
  });
});

describe("JsonTreeView line numbers and toolbar", () => {
  it("numbers the lines only when asked to", () => {
    const { container, rerender } = render(<JsonTreeView value={{ a: 1 }} />);
    expect(container.querySelector(".json-tree-body--numbered")).toBeNull();

    rerender(<JsonTreeView value={{ a: 1 }} lineNumbers />);
    expect(container.querySelector(".json-tree-body--numbered")).not.toBeNull();
  });

  // The indent has to sit on the line's content rather than on the line box,
  // or the number column staggers right along with each node's depth.
  it("keeps the indent off the line box so the number column stays straight", () => {
    const { container } = render(<JsonTreeView value={{ outer: { inner: 1 } }} lineNumbers />);

    for (const line of container.querySelectorAll<HTMLElement>(".json-tree-line")) {
      expect(line.style.paddingLeft).toBe("");
      expect(line.querySelector(".json-tree-line-content")).not.toBeNull();
    }
  });

  it("hides its own toolbar when the surrounding panel provides one", () => {
    const { container } = render(<JsonTreeView value={{ a: 1 }} onOpenInNewTab={() => {}} showToolbar={false} />);

    expect(container.querySelector(".json-tree-toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });
});
