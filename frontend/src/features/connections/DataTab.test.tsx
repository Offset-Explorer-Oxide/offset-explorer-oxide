import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { useTabDataStore } from "../workspace/useTabDataStore";
import { useDataTabFiltersStore } from "./useDataTabFiltersStore";
import { DataTab } from "./DataTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let capturedMessagesBatchHandler: ((event: { payload: { requestId: string; message: unknown } }) => void) | null =
  null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: (event: { payload: { requestId: string; message: unknown } }) => void) => {
    capturedMessagesBatchHandler = handler;
    return Promise.resolve(() => {});
  }),
}));

// Real AG Grid needs DOM measurement (ResizeObserver etc.) jsdom doesn't
// fully provide; this test's job is to verify DataTab passes the right
// rowData/onRowClicked, not to exercise AG Grid's own rendering.
interface MockColDef {
  headerName?: string;
  field?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valueGetter?: (params: any) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cellRenderer?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQuickFilterText?: (params: any) => string;
}
let lastGridProps: {
  rowData: unknown[];
  onRowClicked: (event: { data: unknown; event?: { target: unknown } }) => void;
  quickFilterText?: string;
  overlayNoRowsTemplate?: string;
  columnDefs: MockColDef[];
  loading?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any;
} | null = null;
vi.mock("ag-grid-react", () => ({
  AgGridReact: (props: {
    rowData: unknown[];
    onRowClicked: (event: { data: unknown; event?: { target: unknown } }) => void;
    quickFilterText?: string;
    overlayNoRowsTemplate?: string;
    columnDefs: MockColDef[];
    loading?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
  }) => {
    lastGridProps = props;
    return null;
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// Resetting via a helper (rather than a bare `lastGridProps = null` inline)
// avoids TypeScript narrowing lastGridProps to exactly `null` for the rest
// of the enclosing test body.
function resetLastGridProps() {
  lastGridProps = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLastGridProps();
  capturedMessagesBatchHandler = null;
  useMessageViewerStore.setState({ message: null, connectionId: null, topic: null });
  useTabDataStore.setState({ messagesByTab: {}, totalMatchingByTab: {} });
  useDataTabFiltersStore.setState({ formByTab: {} });
});

describe("DataTab", () => {
  it("renders Fetch and Stop controls, and all six filter inputs", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    expect(screen.getByRole("button", { name: "Fetch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByLabelText("Max messages per partition")).toBeInTheDocument();
    expect(screen.getByLabelText("Total max messages")).toBeInTheDocument();
    expect(screen.getByLabelText("Partition filter")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByLabelText("Offset")).toBeInTheDocument();
  });

  it("pre-fills and disables the partition filter when partitionId is given", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" partitionId={2} />);

    expect(screen.getByLabelText("Partition filter")).toHaveValue("2");
    expect(screen.getByLabelText("Partition filter")).toBeDisabled();
  });

  it("updates the partition filter when partitionId changes without the component remounting", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="orders" partitionId={0} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Partition filter")).toHaveValue("0");

    rerender(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="orders" partitionId={1} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Partition filter")).toHaveValue("1");
  });

  it("clears the search text and filter fields when switching to a different topic without remounting", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="orders" />
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText("Search messages"), "some-old-order-id");
    await user.clear(screen.getByLabelText("Max messages per partition"));
    await user.type(screen.getByLabelText("Max messages per partition"), "5");

    rerender(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="order-created" />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Search messages")).toHaveValue("");
    // A brand new topic's form starts at the default cap, not blank.
    expect(screen.getByLabelText("Max messages per partition")).toHaveValue("100");
  });

  it("keeps a topic's filter form intact when switching away to a different topic and back, even though the search text does not persist", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="orders" />
      </QueryClientProvider>,
    );
    await user.clear(screen.getByLabelText("Max messages per partition"));
    await user.type(screen.getByLabelText("Max messages per partition"), "5");
    await user.type(screen.getByLabelText("Offset"), "100");
    await user.type(screen.getByLabelText("Search messages"), "some-old-order-id");

    rerender(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="order-created" />
      </QueryClientProvider>,
    );
    // A brand new topic's form starts at the default cap, not blank.
    expect(screen.getByLabelText("Max messages per partition")).toHaveValue("100");

    rerender(
      <QueryClientProvider client={client}>
        <DataTab connectionId="1" topicName="orders" />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Max messages per partition")).toHaveValue("5");
    expect(screen.getByLabelText("Offset")).toHaveValue("100");
    // The quick-filter search box is deliberately NOT persisted per topic —
    // only the fetch filter form is.
    expect(screen.getByLabelText("Search messages")).toHaveValue("");
  });

  it("passes the current partitionId to viewMessage when a row is clicked, so the viewer can tell a topic-wide Data tab apart from one of its partitions'", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" partitionId={2} />);
    const message = { partition: 2, offset: 5, timestampMs: null, keyBase64: null, payloadBase64: "eA==" };

    lastGridProps?.onRowClicked({ data: message });

    expect(useMessageViewerStore.getState().partitionId).toBe(2);
  });

  it("leaves the partition filter blank and editable when partitionId is not given", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    expect(screen.getByLabelText("Partition filter")).toHaveValue("");
    expect(screen.getByLabelText("Partition filter")).toBeEnabled();
  });

  it("fetches with the prepopulated partition when partitionId is given and Fetch is clicked", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" partitionId={2} />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ filter: expect.objectContaining({ partitions: [2] }) }),
      ),
    );
  });

  it("starts with Stop disabled, since nothing is playing yet", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("shows a 'Load message payload' checkbox below Fetch/Stop, unchecked by default", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    expect(screen.getByLabelText("Load message payload")).not.toBeChecked();
  });

  it("fetches messages with a default-capped, no-payload filter when Fetch is clicked with no filters touched", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith({
        id: "1",
        topic: "orders",
        filter: {
          partitions: null,
          maxMessagesPerPartition: 100,
          maxTotalMessages: 100,
          fromTimestampMs: null,
          toTimestampMs: null,
          offset: null,
          includePayload: false,
        },
        requestId: expect.any(String),
        readTimeoutMs: 10_000,
        maxMessageSizeBytes: 1_048_576,
      }),
    );
  });

  it("rejects Fetch with a validation error when Max messages per partition is cleared to blank, without calling the backend", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.clear(screen.getByLabelText("Max messages per partition"));
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"Max messages per partition" is required');
    expect(fetchMessages).not.toHaveBeenCalled();
  });

  it("sets includePayload true when the checkbox is checked before Fetch is clicked", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByLabelText("Load message payload"));
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ filter: expect.objectContaining({ includePayload: true }) }),
      ),
    );
  });

  it("applies entered filters when Fetch is clicked", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.clear(screen.getByLabelText("Max messages per partition"));
    await user.type(screen.getByLabelText("Max messages per partition"), "10");
    await user.type(screen.getByLabelText("Partition filter"), "0,1");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ maxMessagesPerPartition: 10, partitions: [0, 1] }),
        }),
      ),
    );
  });

  it("applies the offset filter when Fetch is clicked, using the same default per-partition cap as any other fetch", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.type(screen.getByLabelText("Offset"), "100");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ offset: 100, maxMessagesPerPartition: 100 }),
        }),
      ),
    );
  });

  it("respects an explicit Max messages per partition value when offset is also set", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.type(screen.getByLabelText("Offset"), "100");
    await user.clear(screen.getByLabelText("Max messages per partition"));
    await user.type(screen.getByLabelText("Max messages per partition"), "20");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(fetchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ offset: 100, maxMessagesPerPartition: 20 }),
        }),
      ),
    );
  });

  it("rejects Fetch with a validation error when To is before From, without calling the backend", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-02T00:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01T00:00" } });
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"To" date must be after "From" date');
    expect(fetchMessages).not.toHaveBeenCalled();
  });

  it("rejects Fetch with a validation error when To equals From, without calling the backend", async () => {
    const fetchMessages = vi.fn(() => ({ messages: [], totalMatching: 0 }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01T00:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01T00:00" } });
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent('"To" date must be after "From" date');
    expect(fetchMessages).not.toHaveBeenCalled();
  });

  it("shows the grid's loading state while a fetch is in flight, and clears it once it resolves", async () => {
    let resolveFetch: (result: { messages: unknown[]; totalMatching: number }) => void = () => {};
    const pending = new Promise<{ messages: unknown[]; totalMatching: number }>((resolve) => {
      resolveFetch = resolve;
    });
    setInvokeHandlers({ connection_fetch_messages: () => pending });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    expect(lastGridProps?.loading).toBe(false);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.loading).toBe(true));

    resolveFetch({ messages: [], totalMatching: 0 });
    await waitFor(() => expect(lastGridProps?.loading).toBe(false));
  });

  it("streams a message onto the grid as soon as a matching messages-batch event arrives, ahead of the fetch resolving", async () => {
    let resolveFetch: (result: { messages: unknown[]; totalMatching: number }) => void = () => {};
    const pending = new Promise<{ messages: unknown[]; totalMatching: number }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMessages = vi.fn((_args: { requestId: string }) => pending);
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(fetchMessages).toHaveBeenCalled());
    const requestId = fetchMessages.mock.calls[0][0].requestId;

    const streamed = { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null };
    capturedMessagesBatchHandler?.({ payload: { requestId, message: streamed } });

    await waitFor(() => expect(lastGridProps?.rowData).toEqual([streamed]));

    resolveFetch({ messages: [streamed], totalMatching: 1 });
    await waitFor(() => expect(lastGridProps?.loading).toBe(false));
  });

  it("ignores a messages-batch event from a different (stale/superseded) request id", async () => {
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages: [], totalMatching: 0 }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.loading).toBe(false));

    const stale = { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null };
    capturedMessagesBatchHandler?.({ payload: { requestId: "some-other-request", message: stale } });

    expect(lastGridProps?.rowData).toEqual([]);
  });

  it("tells the grid to show a 'No messages' overlay when there are no rows", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    expect(lastGridProps?.overlayNoRowsTemplate).toContain("No messages");
  });

  it("passes the fetched messages to the grid as rowData", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: "eA==" }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => expect(lastGridProps?.rowData).toEqual(messages));
  });

  it("includes a Value column that decodes a row's base64 payload", async () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    const valueColumn = lastGridProps?.columnDefs.find((c) => c.headerName === "Value");
    expect(valueColumn).toBeDefined();
    expect(valueColumn?.valueGetter?.({ data: { payloadBase64: "eyJhIjoxfQ==" } })).toBe('{"a":1}');
  });

  it("shows a blank Value for rows with no payload loaded", async () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    const valueColumn = lastGridProps?.columnDefs.find((c) => c.headerName === "Value");
    expect(valueColumn?.valueGetter?.({ data: { payloadBase64: null } })).toBe("");
  });

  it("keeps the fetched messages cached for the tab across an unmount/remount (switching tabs away and back)", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: "eA==" }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    const { unmount } = renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.rowData).toEqual(messages));

    unmount();
    resetLastGridProps();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    expect(lastGridProps?.rowData).toEqual(messages);
  });

  it("does not leak one topic's cached rows into a different topic's Data tab in the same top-level tab", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: "eA==" }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    const { unmount } = renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.rowData).toEqual(messages));

    unmount();
    resetLastGridProps();
    renderWithClient(<DataTab connectionId="1" topicName="payments" />);

    expect(lastGridProps?.rowData).toEqual([]);
  });

  it("does not leak a topic's cached rows into one of its partitions' Data tab", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: "eA==" }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    const { unmount } = renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.rowData).toEqual(messages));

    unmount();
    resetLastGridProps();
    renderWithClient(<DataTab connectionId="1" topicName="orders" partitionId={0} />);

    expect(lastGridProps?.rowData).toEqual([]);
  });

  it("shows an error when fetching fails", async () => {
    setInvokeHandlers({
      connection_fetch_messages: () => {
        throw new Error("Failed to fetch messages");
      },
    });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch messages");
  });

  it("shows a search input above the grid", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    expect(screen.getByLabelText("Search messages")).toBeInTheDocument();
  });

  it("passes the search text to the grid as quickFilterText", async () => {
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.type(screen.getByLabelText("Search messages"), "order-1");

    await waitFor(() => expect(lastGridProps?.quickFilterText).toBe("order-1"));
  });

  it("narrows the single loaded/total count to only messages matching the search text", async () => {
    const messages = [
      { partition: 0, offset: 1, timestampMs: null, keyBase64: "b3JkZXItMQ==", payloadBase64: null, headers: [] },
      { partition: 0, offset: 2, timestampMs: null, keyBase64: "b3RoZXI=", payloadBase64: null, headers: [] },
    ];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(screen.getByText("2 / 2 loaded")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Search messages"), "order-1");

    await waitFor(() => expect(screen.getByText("1 / 2 loaded")).toBeInTheDocument());
  });

  it("shows 0 / 0 loaded before any fetch has run", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    expect(screen.getByText("0 / 0 loaded")).toBeInTheDocument();
  });

  it("shows every loaded message as matching the total when the fetch wasn't capped", async () => {
    const messages = [
      { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
      { partition: 0, offset: 2, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] },
    ];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: messages.length }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => expect(screen.getByText("2 / 2 loaded")).toBeInTheDocument());
  });

  it("shows fewer loaded than total matching when a max-messages cap trimmed the fetch, so the user knows more remain", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: 150 }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => expect(screen.getByText("1 / 150 loaded")).toBeInTheDocument());
  });

  it("keeps showing the last fetch's loaded/total count for a tab across an unmount/remount", async () => {
    const messages = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages, totalMatching: 150 }) });
    const user = userEvent.setup();
    const { unmount } = renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(screen.getByText("1 / 150 loaded")).toBeInTheDocument());

    unmount();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    expect(screen.getByText("1 / 150 loaded")).toBeInTheDocument();
  });

  it("excludes partition, offset, and timestamp from the quick filter, leaving only key and value searchable", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    const columnDefs = lastGridProps?.columnDefs ?? [];
    const excluded = ["Partition", "Offset", "Timestamp"];
    for (const headerName of excluded) {
      const colDef = columnDefs.find((c) => c.headerName === headerName);
      expect(colDef?.getQuickFilterText?.({})).toBe("");
    }

    const keyColDef = columnDefs.find((c) => c.headerName === "Key");
    const valueColDef = columnDefs.find((c) => c.headerName === "Value");
    expect(keyColDef?.getQuickFilterText).toBeUndefined();
    expect(valueColDef?.getQuickFilterText).toBeUndefined();
  });

  it("selects a message into the viewer store when a grid row is clicked", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    const message = { partition: 0, offset: 5, timestampMs: null, keyBase64: null, payloadBase64: "eA==" };

    lastGridProps?.onRowClicked({ data: message });

    expect(useMessageViewerStore.getState().message).toEqual(message);
    expect(useMessageViewerStore.getState().connectionId).toBe("1");
    expect(useMessageViewerStore.getState().topic).toBe("orders");
  });

  it("does not open the viewer when the row click originated from a button (e.g. Fetch payload)", () => {
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);
    const message = { partition: 0, offset: 5, timestampMs: null, keyBase64: null, payloadBase64: null };
    const button = document.createElement("button");

    lastGridProps?.onRowClicked({ data: message, event: { target: button } });

    expect(useMessageViewerStore.getState().message).toBeNull();
  });

  it("passes a context.fetchPayload that fetches just one row's payload and patches it into the cached rows", async () => {
    const initial = [
      { partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null },
      { partition: 1, offset: 2, timestampMs: null, keyBase64: null, payloadBase64: null },
    ];
    setInvokeHandlers({ connection_fetch_messages: () => ({ messages: initial, totalMatching: initial.length }) });
    const user = userEvent.setup();
    renderWithClient(<DataTab connectionId="1" topicName="orders" />);

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(lastGridProps?.rowData).toEqual(initial));

    const fetchMessages = vi.fn(() => ({
      messages: [{ partition: 0, offset: 1, timestampMs: null, keyBase64: "k", payloadBase64: "eA==" }],
      totalMatching: 1,
    }));
    setInvokeHandlers({ connection_fetch_messages: fetchMessages });
    await lastGridProps?.context.fetchPayload(initial[0]);

    expect(fetchMessages).toHaveBeenCalledWith({
      id: "1",
      topic: "orders",
      filter: {
        partitions: [0],
        maxMessagesPerPartition: 1,
        maxTotalMessages: 1,
        fromTimestampMs: null,
        toTimestampMs: null,
        offset: 1,
        includePayload: true,
      },
      requestId: expect.any(String),
      readTimeoutMs: 10_000,
      maxMessageSizeBytes: 1_048_576,
    });
    expect(lastGridProps?.rowData).toEqual([
      { partition: 0, offset: 1, timestampMs: null, keyBase64: "k", payloadBase64: "eA==" },
      initial[1],
    ]);
  });
});
