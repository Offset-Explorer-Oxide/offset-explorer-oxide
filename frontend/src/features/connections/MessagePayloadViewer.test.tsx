import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useJsonViewerTabsStore } from "../tabs/useJsonViewerTabsStore";
import { useTabsStore } from "../tabs/useTabsStore";
import { useTabOrderStore } from "../tabs/useTabOrderStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { MessagePayloadViewer, TEXT_PREVIEW_CHARS } from "./MessagePayloadViewer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null });
  useJsonViewerTabsStore.setState({ tabs: [] });
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
  useTabOrderStore.setState({ anchors: {} });
});

describe("MessagePayloadViewer", () => {
  it("shows a placeholder when no message is selected", () => {
    renderWithClient(<MessagePayloadViewer />);
    expect(screen.getByText(/select a message/i)).toBeInTheDocument();
  });

  it("shows the payload as text by default", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("hello world"), payloadSizeBytes: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  // The grid's rows deliberately carry only a bounded preview of each
  // payload — that truncation is what keeps a large fetch inside the
  // webview's memory. Opening a message therefore has to go and get the real
  // bytes, or the viewer would quietly show the first few KB of a multi-
  // megabyte message as though it were the whole thing.
  it("fetches the whole payload when the row only carried a truncated preview", async () => {
    setInvokeHandlers({
      connection_fetch_messages: () => ({
        messages: [
          {
            partition: 0,
            offset: 7,
            timestampMs: null,
            keyBase64: null,
            payloadBase64: btoa("the whole payload"),
            payloadSizeBytes: 17,
            headers: [],
          },
        ],
        totalMatching: 1,
      }),
    });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("the whole"),
        payloadSizeBytes: 17,
        headers: [],
      },
    });

    renderWithClient(<MessagePayloadViewer />);

    expect(await screen.findByText("the whole payload")).toBeInTheDocument();
  });

  // Without this the preview is rendered as though it were the message: a
  // few KB of a multi-megabyte payload, indistinguishable from the whole
  // thing, until the real bytes quietly replace it.
  it("says the payload is still loading while only the preview is on screen", async () => {
    let resolveFetch: (result: unknown) => void = () => {};
    setInvokeHandlers({
      connection_fetch_messages: () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("the whole"),
        payloadSizeBytes: 17,
        headers: [],
      },
    });

    renderWithClient(<MessagePayloadViewer />);

    expect(await screen.findByText(/Loading the full payload/)).toBeInTheDocument();

    resolveFetch({
      messages: [
        {
          partition: 0,
          offset: 7,
          timestampMs: null,
          keyBase64: null,
          payloadBase64: btoa("the whole payload"),
          payloadSizeBytes: 17,
          headers: [],
        },
      ],
      totalMatching: 1,
    });

    expect(await screen.findByText("the whole payload")).toBeInTheDocument();
    expect(screen.queryByText(/Loading the full payload/)).not.toBeInTheDocument();
  });

  // A truncated preview is not the message: parsing it reports "not valid
  // JSON" (and Avro decoding fails outright) for as long as the real bytes
  // take to arrive, which reads as the payload being broken rather than as
  // still loading. The structured views wait instead.
  it("shows a spinner rather than an invalid-JSON alert while the full payload is still loading", async () => {
    setInvokeHandlers({ connection_fetch_messages: () => new Promise(() => {}) });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1,"nam'),
        payloadSizeBytes: 64,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(await screen.findByRole("status", { name: /loading the full payload/i })).toBeInTheDocument();
    expect(screen.queryByText(/not valid json/i)).not.toBeInTheDocument();
  });

  it("renders the JSON tree once the full payload arrives", async () => {
    let resolveFetch: (result: unknown) => void = () => {};
    setInvokeHandlers({
      connection_fetch_messages: () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1,"nam'),
        payloadSizeBytes: 24,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    resolveFetch({
      messages: [
        {
          partition: 0,
          offset: 7,
          timestampMs: null,
          keyBase64: null,
          payloadBase64: btoa('{"id":1,"name":"orders"}'),
          payloadSizeBytes: 24,
          headers: [],
        },
      ],
      totalMatching: 1,
    });

    expect(await screen.findByText("id:")).toBeInTheDocument();
    expect(screen.getByText('"orders"')).toBeInTheDocument();
  });

  // Decoding a cut Avro payload doesn't just look wrong, it costs a backend
  // round trip to be told so. The decode waits for the real bytes.
  it("shows a spinner and does not attempt an Avro decode while the full payload is still loading", async () => {
    const decodeAvro = vi.fn(() => ({ id: 1 }));
    setInvokeHandlers({
      connection_fetch_messages: () => new Promise(() => {}),
      connection_decode_avro: decodeAvro,
    });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("avro-pre"),
        payloadSizeBytes: 64,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "Avro" }));

    expect(await screen.findByRole("status", { name: /loading the full payload/i })).toBeInTheDocument();
    expect(decodeAvro).not.toHaveBeenCalled();
  });

  // The spinner means "still coming". A fetch that failed is not still
  // coming, and the error banner already says so, so the view goes back to
  // reporting what it actually has rather than spinning forever.
  it("stops spinning and reports the payload it has when the full-payload fetch fails", async () => {
    setInvokeHandlers({
      connection_fetch_messages: () => {
        throw new Error("broker unreachable");
      },
    });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1,"nam'),
        payloadSizeBytes: 64,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(await screen.findByText(/not valid json/i)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading the full payload/i })).not.toBeInTheDocument();
  });

  it("does not re-fetch a payload the row already carried in full", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    useMessageViewerStore.setState({
      connectionId: "1",
      topic: "orders",
      message: {
        partition: 0,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("all of it"),
        payloadSizeBytes: 9,
        headers: [],
      },
    });

    renderWithClient(<MessagePayloadViewer />);

    expect(await screen.findByText("all of it")).toBeInTheDocument();
    expect(fetchMessages).not.toHaveBeenCalled();
  });

  it("pretty-prints the payload as JSON when the JSON toggle is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1,"name":"orders"}'),
        payloadSizeBytes: null,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByText("id:")).toBeInTheDocument();
    expect(screen.getByText('"orders"')).toBeInTheDocument();
  });

  it("opens the JSON value as its own app tab and switches to it when 'Open in new tab' is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 2,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1}'),
        payloadSizeBytes: null,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));

    const tabs = useJsonViewerTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: "Partition 2 · Offset 7", value: { id: 1 } });
    expect(useTabsStore.getState().activeTabId).toBe(tabs[0].id);
  });

  it("shows an error message when JSON is requested but the payload isn't valid JSON", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("not json"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it("shows an error message when JSON is requested but the payload is XML", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("<a>1</a>"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it("renders the payload as an XML tree when the XML toggle is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("<order><id>1</id></order>"),
        payloadSizeBytes: null,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "XML" }));

    expect(screen.getByText("<order>")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens the XML value as its own app tab and switches to it when 'Open in new tab' is clicked", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 2,
        offset: 7,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa("<order/>"),
        payloadSizeBytes: null,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "XML" }));
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));

    const tabs = useJsonViewerTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: "Partition 2 · Offset 7", kind: "xml" });
    expect(useTabsStore.getState().activeTabId).toBe(tabs[0].id);
  });

  it("shows an error message when XML is requested but the payload isn't valid XML", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("not xml"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "XML" }));

    expect(screen.getByText(/not valid xml/i)).toBeInTheDocument();
  });

  it("shows an error message when XML is requested but the payload is JSON", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: btoa('{"id":1}'),
        payloadSizeBytes: null,
        headers: [],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "XML" }));

    expect(screen.getByText(/not valid xml/i)).toBeInTheDocument();
  });

  it("decodes and renders the payload as a JSON tree when Avro is clicked", async () => {
    setInvokeHandlers({ connection_decode_avro: () => ({ id: 1, name: "orders" }) });
    useMessageViewerStore.setState({
      connectionId: "conn-1",
      topic: "orders",
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("avro-bytes"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "Avro" }));

    expect(await screen.findByText("id:")).toBeInTheDocument();
    expect(screen.getByText('"orders"')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("connection_decode_avro", {
      id: "conn-1",
      topic: "orders",
      payloadBase64: btoa("avro-bytes"),
    });
  });

  it("shows an alert with the backend's message when Avro decoding fails", async () => {
    setInvokeHandlers({
      connection_decode_avro: () => {
        throw new Error("no manual schema is set for this topic and this connection has no Schema Registry configured");
      },
    });
    useMessageViewerStore.setState({
      connectionId: "conn-1",
      topic: "orders",
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: btoa("avro-bytes"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "Avro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no schema registry configured/i);
  });

  it("shows a hint to enable 'Fetch message payload' when payloadBase64 is null", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/fetch message payload/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Text" })).not.toBeInTheDocument();
  });

  it("shows the message's partition and offset even when the payload wasn't loaded", () => {
    useMessageViewerStore.setState({
      message: { partition: 3, offset: 17, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/partition 3/i)).toBeInTheDocument();
    expect(screen.getByText(/offset 17/i)).toBeInTheDocument();
  });

  it("shows the message's partition and offset", () => {
    useMessageViewerStore.setState({
      message: { partition: 3, offset: 17, timestampMs: null, keyBase64: null, payloadBase64: btoa("x"), payloadSizeBytes: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByText(/partition 3/i)).toBeInTheDocument();
    expect(screen.getByText(/offset 17/i)).toBeInTheDocument();
  });

  it("clears the viewed message when the close button is clicked", async () => {
    useMessageViewerStore.setState({
      message: { partition: 3, offset: 17, timestampMs: null, keyBase64: null, payloadBase64: btoa("x"), payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByLabelText("Close message payload viewer"));

    expect(useMessageViewerStore.getState().message).toBeNull();
  });

  it("opens on the Value tab by default", () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] },
    });
    renderWithClient(<MessagePayloadViewer />);

    expect(screen.getByRole("tab", { name: "Value" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a table of headers on the Headers tab", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: null,
        payloadSizeBytes: null,
        headers: [
          { key: "content-type", valueBase64: btoa("application/json") },
          { key: "empty-header", valueBase64: null },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("content-type")).toBeInTheDocument();
    expect(screen.getByText("application/json")).toBeInTheDocument();
    expect(screen.getByText("empty-header")).toBeInTheDocument();
  });

  it("shows a placeholder on the Headers tab when the message has no headers", async () => {
    useMessageViewerStore.setState({
      message: { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, payloadSizeBytes: null, headers: [] },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText(/no headers/i)).toBeInTheDocument();
  });

  it("shows headers even when the payload wasn't loaded for this fetch", async () => {
    useMessageViewerStore.setState({
      message: {
        partition: 0,
        offset: 1,
        timestampMs: null,
        keyBase64: null,
        payloadBase64: null,
        payloadSizeBytes: null,
        headers: [{ key: "trace-id", valueBase64: btoa("abc") }],
      },
    });
    const user = userEvent.setup();
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("trace-id")).toBeInTheDocument();
  });

  function viewMessage(payloadBase64: string, offset = 1) {
    useMessageViewerStore.setState({
      message: { partition: 0, offset, timestampMs: null, keyBase64: null, payloadBase64, payloadSizeBytes: null, headers: [] },
    });
  }

  /**
   * The viewer is keyed by tab, not by message (App.tsx), so it stays mounted
   * while the user clicks through the grid and its state carries over. Both
   * tests below cover that carry-over, which is where a per-message guard
   * quietly stops guarding.
   */
  it("re-truncates a large payload after the previous message was expanded in full", async () => {
    const short = "a".repeat(300_000);
    const long = "b".repeat(400_000);
    const user = userEvent.setup();
    viewMessage(btoa(short));
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: /show the whole payload/i }));
    expect(screen.queryByText(/show the whole payload/i)).not.toBeInTheDocument();

    // Watching the DOM itself, because the bug is about a render that is
    // immediately corrected: resetting the flag in an effect leaves the first
    // render committing the whole payload, and the browser paints that before
    // the effect lands. Testing Library flushes effects before any assertion,
    // so the final DOM looks identical either way — only the mutations in
    // between tell the two apart, and that intermediate commit is the freeze.
    const committed: number[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") committed.push((record.target.textContent ?? "").length);
        record.addedNodes.forEach((node) => committed.push((node.textContent ?? "").length));
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });

    viewMessage(btoa(long), 2);
    expect(await screen.findByRole("button", { name: /show the whole payload/i })).toBeInTheDocument();
    observer.disconnect();

    expect(Math.max(0, ...committed)).toBeLessThanOrEqual(TEXT_PREVIEW_CHARS);
    expect(screen.queryByText(long)).not.toBeInTheDocument();
  });

  it("collapses a large array in a newly selected message even where the previous one was expanded", async () => {
    const small = JSON.stringify({ events: ["only-one"] });
    const large = JSON.stringify({ events: Array.from({ length: 300 }, (_, i) => `event-${i}`) });
    const user = userEvent.setup();
    viewMessage(btoa(small));
    renderWithClient(<MessagePayloadViewer />);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByText('"only-one"')).toBeInTheDocument();

    viewMessage(btoa(large), 2);

    expect(await screen.findByRole("button", { name: /expand events/i })).toBeInTheDocument();
    expect(screen.queryByText('"event-0"')).not.toBeInTheDocument();
  });
});
