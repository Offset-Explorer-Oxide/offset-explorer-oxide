import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { JsonViewerTabPanel } from "./JsonViewerTabPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const saveDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...args: unknown[]) => saveDialog(...args) }));

describe("JsonViewerTabPanel", () => {
  it("shows the tab's title and the JSON tree for its value", () => {
    render(
      <JsonViewerTabPanel
        tab={{ id: "json-1", title: "Partition 0 · Offset 1", name: "Json", kind: "json", value: { orderId: 1 } }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Partition 0 · Offset 1" })).toBeInTheDocument();
    expect(screen.getByText("orderId:")).toBeInTheDocument();
    // Scoped to the value: the tree's line-number gutter is a real element
    // now (a CSS counter can't number a windowed list), so a bare "1" also
    // matches the number of the line this value is on.
    expect(screen.getByText("1", { selector: ".json-tree-value" })).toBeInTheDocument();
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

  /**
   * The text kind has had a gutter all along; the two tree kinds hadn't.
   * A whole tab of one document is where a line to point at is worth the
   * column, so all three are numbered here — unlike the payload pane beside
   * the grid, which stays unnumbered on its trees.
   */
  it("numbers the JSON tree's lines", () => {
    const { container } = render(
      <JsonViewerTabPanel
        tab={{ id: "json-1", title: "Offset 1", name: "Json", kind: "json", value: { orderId: 1 } }}
      />,
    );

    expect(container.querySelector(".json-tree-body--numbered")).not.toBeNull();
  });

  it("numbers the XML tree's lines", () => {
    const { container } = render(
      <JsonViewerTabPanel
        tab={{
          id: "xml-1",
          title: "Offset 1",
          name: "Xml",
          kind: "xml",
          value: { tag: "order", attributes: [], children: [], text: "42" },
        }}
      />,
    );

    expect(container.querySelector(".json-tree-body--numbered")).not.toBeNull();
  });
});

describe("JsonViewerTabPanel expansion", () => {
  const heavy = {
    orderId: "a-1",
    events: Array.from({ length: 300 }, (_, i) => ({ id: `event-${i}`, seq: i, note: "n" })),
  };

  it("opens the tree fully, with nothing behind a click", () => {
    render(
      <JsonViewerTabPanel tab={{ id: "json-1", title: "Offset 1", name: "Json", kind: "json", value: heavy }} />,
    );

    expect(screen.getByText('"event-0"')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand events" })).not.toBeInTheDocument();
  });

  /** The tree opens expanded, so there is nothing for an Expand all to do. */
  it("offers no Expand all button", () => {
    render(
      <JsonViewerTabPanel tab={{ id: "json-1", title: "Offset 1", name: "Json", kind: "json", value: heavy }} />,
    );

    expect(screen.queryByRole("button", { name: "Expand all" })).not.toBeInTheDocument();
  });

  it("still lets the reader close a section by hand", async () => {
    const user = userEvent.setup();
    render(
      <JsonViewerTabPanel tab={{ id: "json-1", title: "Offset 1", name: "Json", kind: "json", value: heavy }} />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse events" }));

    expect(screen.queryByText('"event-0"')).not.toBeInTheDocument();
    expect(screen.getByText(/300 items/)).toBeInTheDocument();
  });
});

describe("JsonViewerTabPanel toolbar", () => {
  function jsonTab(overrides: Record<string, unknown> = {}) {
    return {
      id: "json-1",
      title: "Partition 0 · Offset 1",
      name: "Json",
      kind: "json" as const,
      format: "json" as const,
      payloadSizeBytes: 2048,
      fileStem: "partition-0-offset-1",
      value: { orderId: 1 },
      ...overrides,
    };
  }

  beforeEach(() => {
    saveDialog.mockReset();
    vi.mocked(invoke).mockReset();
    setInvokeHandlers({ payload_save: () => undefined });
  });

  it("copies the value as text", async () => {
    // `userEvent.setup()` is what installs `navigator.clipboard` under
    // jsdom, so the spy has to come after it — there is no object to spy on
    // before.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ orderId: 1 }, null, 2));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  it("saves the rendered text, under the tab's own filename stem and extension", async () => {
    saveDialog.mockResolvedValue("/tmp/out.json");
    const user = userEvent.setup();
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Save as JSON" }));

    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "partition-0-offset-1.json" }),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "payload_save",
      expect.objectContaining({ contentsBase64: btoa(JSON.stringify({ orderId: 1 }, null, 2)) }),
    );
    expect(await screen.findByText("Saved to /tmp/out.json")).toBeInTheDocument();
  });

  /**
   * The size the pane this tab was opened from was showing — the message's,
   * as the broker reported it, not the length of the text rendered here.
   */
  it("shows the message's size the way the payload viewer does", () => {
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByTitle("Payload size: 2,048 bytes")).toBeInTheDocument();
  });

  // A tab opened from something that isn't a message has no size to show,
  // and shows no chip rather than a made-up number.
  it("omits the size when the tab was opened without one", () => {
    render(<JsonViewerTabPanel tab={jsonTab({ payloadSizeBytes: undefined })} />);

    expect(screen.queryByText(/KB|MB|\d+ B/)).not.toBeInTheDocument();
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Save as JSON" }));

    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  // Download used to sit beside Save here, writing the payload's original
  // bytes. It was removed from the app entirely — Save is the only way out.
  it("offers no Download button", () => {
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as JSON" })).toBeInTheDocument();
  });

  it("saves an XML tab as indented XML", async () => {
    saveDialog.mockResolvedValue("/tmp/out.xml");
    const user = userEvent.setup();
    render(
      <JsonViewerTabPanel
        tab={jsonTab({
          kind: "xml",
          format: "xml",
          value: { tag: "order", attributes: [], children: [], text: "42" },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save as XML" }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "payload_save",
      expect.objectContaining({ contentsBase64: btoa("<order>42</order>") }),
    );
  });

  it("reports a failed save rather than failing silently", async () => {
    saveDialog.mockRejectedValue(new Error("no permission"));
    const user = userEvent.setup();
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Save as JSON" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed: no permission");
  });
});
