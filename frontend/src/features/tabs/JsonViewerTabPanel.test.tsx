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

/**
 * Opening a payload in its own tab is what you do with the payload you
 * actually care about — and until now that tab was a dead end with a Copy
 * button and nothing else. These cover the two that write files, including
 * the distinction that makes them two buttons rather than one.
 */
describe("JsonViewerTabPanel toolbar", () => {
  const PAYLOAD = btoa('{"orderId":1}');

  function jsonTab(overrides: Record<string, unknown> = {}) {
    return {
      id: "json-1",
      title: "Partition 0 · Offset 1",
      name: "Json",
      kind: "json" as const,
      format: "json" as const,
      payloadBase64: PAYLOAD,
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
   * The whole reason Download is a separate button: a payload is an
   * arbitrary byte string, and the text above it is a lossy UTF-8 decode
   * plus a parse. This one has to write what the broker holds.
   */
  it("downloads the original payload bytes, not the rendered text", async () => {
    saveDialog.mockResolvedValue("/tmp/out.bin");
    const user = userEvent.setup();
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Download the original payload bytes" }));

    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "partition-0-offset-1.bin" }),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "payload_save",
      expect.objectContaining({ contentsBase64: PAYLOAD }),
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<JsonViewerTabPanel tab={jsonTab()} />);

    await user.click(screen.getByRole("button", { name: "Save as JSON" }));

    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  // A tab opened without the bytes must not offer a button that would have
  // to invent them — it offers no button.
  it("hides Download when the tab carries no original bytes", () => {
    render(<JsonViewerTabPanel tab={jsonTab({ payloadBase64: undefined })} />);

    expect(screen.queryByRole("button", { name: "Download the original payload bytes" })).not.toBeInTheDocument();
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
