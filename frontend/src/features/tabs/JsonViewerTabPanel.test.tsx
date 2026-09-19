import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JsonViewerTabPanel } from "./JsonViewerTabPanel";

describe("JsonViewerTabPanel", () => {
  it("shows the tab's title and the JSON tree for its value", () => {
    render(
      <JsonViewerTabPanel
        tab={{ id: "json-1", title: "Partition 0 · Offset 1", name: "Json", kind: "json", value: { orderId: 1 } }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Partition 0 · Offset 1" })).toBeInTheDocument();
    expect(screen.getByText("orderId:")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("doesn't show an 'Open in new tab' button — this view is already a dedicated tab for the value", () => {
    render(
      <JsonViewerTabPanel
        tab={{ id: "json-1", title: "Partition 0 · Offset 1", name: "Json", kind: "json", value: { a: 1 } }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
  });

  it("shows the tab's title and the XML tree for its value when kind is xml", () => {
    render(
      <JsonViewerTabPanel
        tab={{
          id: "xml-1",
          title: "Partition 0 · Offset 1",
          name: "Xml",
          kind: "xml",
          value: { tag: "order", attributes: [], children: [], text: "42" },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Partition 0 · Offset 1" })).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows a line-numbered text view when kind is text", () => {
    const { container } = render(
      <JsonViewerTabPanel
        tab={{
          id: "text-1",
          title: "Partition 0 · Offset 1 · Hex",
          name: "Text",
          kind: "text",
          value: "line one\nline two",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Partition 0 · Offset 1 · Hex" })).toBeInTheDocument();
    expect(container.querySelector(".code-gutter")?.textContent).toBe("1\n2");
    expect(container.querySelector(".code-body")?.textContent).toBe("line one\nline two");
  });
});
