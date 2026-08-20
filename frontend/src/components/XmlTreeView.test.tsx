import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { XmlTreeView } from "./XmlTreeView";
import { tryParseXml, XmlElementNode } from "../features/connections/payloadDecoding";

function parse(xml: string): XmlElementNode {
  const node = tryParseXml(xml);
  if (!node) throw new Error("test fixture XML failed to parse");
  return node;
}

describe("XmlTreeView", () => {
  it("renders a leaf element's text content", () => {
    render(<XmlTreeView value={parse("<name>orders</name>")} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("renders attributes inline with the opening tag", () => {
    render(<XmlTreeView value={parse('<user id="1" active="true"/>')} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText('<user id="1" active="true">')).toBeInTheDocument();
  });

  it("renders nested child elements expanded by default", () => {
    render(<XmlTreeView value={parse("<root><a>1</a><b>2</b></root>")} onOpenInNewTab={vi.fn()} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("collapses a node when its arrow is clicked, hiding its children", async () => {
    const user = userEvent.setup();
    render(<XmlTreeView value={parse("<root><child>1</child></root>")} onOpenInNewTab={vi.fn()} />);
    expect(screen.getByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse root" }));

    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText(/1 child/)).toBeInTheDocument();
  });

  it("re-expands a collapsed node when its arrow is clicked again", async () => {
    const user = userEvent.setup();
    render(<XmlTreeView value={parse("<root><child>1</child></root>")} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Collapse root" }));
    await user.click(screen.getByRole("button", { name: "Expand root" }));

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("copies the pretty-printed XML to the clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    const user = userEvent.setup();
    render(<XmlTreeView value={parse("<a>1</a>")} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("<a>1</a>");
  });

  it("shows 'Copied!' briefly after copying", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<XmlTreeView value={parse("<a>1</a>")} onOpenInNewTab={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("calls onOpenInNewTab when the 'Open in new tab' button is clicked", async () => {
    const onOpenInNewTab = vi.fn();
    const user = userEvent.setup();
    render(<XmlTreeView value={parse("<a>1</a>")} onOpenInNewTab={onOpenInNewTab} />);

    await user.click(screen.getByRole("button", { name: "Open in new tab" }));

    expect(onOpenInNewTab).toHaveBeenCalled();
  });

  it("hides the 'Open in new tab' button when onOpenInNewTab isn't provided", () => {
    render(<XmlTreeView value={parse("<a>1</a>")} />);

    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
  });
});
