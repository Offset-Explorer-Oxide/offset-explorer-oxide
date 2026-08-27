import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, ModuleRegistry, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import { listen } from "@tauri-apps/api/event";
import { MessagesBatchEvent, TopicMessage } from "../../lib/tauri";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, EMPTY_TAB_MESSAGES, useTabDataStore } from "../workspace/useTabDataStore";
import { APP_GRID_THEME } from "./agGridTheme";
import {
  emptyFilterForm,
  FilterFormState,
  toMessageFilter,
  validateDateRange,
  validateMaxMessagesPerPartition,
} from "./dataFilters";
import { useDataTabFiltersStore } from "./useDataTabFiltersStore";
import { base64ToDisplayText, decodeValuePreview, exceedsValuePreview, VALUE_PREVIEW_BYTES } from "./payloadDecoding";
import { api } from "../../lib/tauri";
import { useFetchMessages } from "./useClusterResources";
import { ValueCell, ValueCellContext } from "./ValueCell";

ModuleRegistry.registerModules([AllCommunityModule]);

function formatTimestamp(params: ValueFormatterParams<TopicMessage, number | null>): string {
  return params.value ? new Date(params.value).toISOString() : "";
}

/**
 * Previews are cached per message object rather than recomputed: AG Grid
 * calls a `valueGetter` again on every sort, filter, quick-filter keystroke
 * and re-render, and `matchesSearch` below asks for the same text again.
 * Keyed weakly, so a row's preview is released with the row itself when a
 * new fetch replaces the tab's messages.
 */
const valuePreviewCache = new WeakMap<TopicMessage, string>();

/**
 * The Value column's text: a bounded preview of the payload (see
 * `decodeValuePreview`), blank until "Load message payload" is checked and a
 * fetch has run. The full payload is decoded only when a row is opened in
 * `MessagePayloadViewer`.
 *
 * This scopes the search box to each message's first few KB. Searching whole
 * payloads would mean decoding and scanning every loaded message on every
 * keystroke (~244ms per keystroke over 300 x 2 MB messages), which is a
 * worse trade than a bounded search.
 */
function messageValueText(message: TopicMessage | undefined): string {
  if (!message) return "";
  const cached = valuePreviewCache.get(message);
  if (cached !== undefined) return cached;

  const preview = decodeValuePreview(message.payloadBase64);
  valuePreviewCache.set(message, preview);
  return preview;
}

/** Decodes a message's key for display — base64 on the wire since a Kafka key is an arbitrary byte string, not guaranteed text. */
function messageKeyText(message: TopicMessage | undefined): string {
  return base64ToDisplayText(message?.keyBase64 ?? null) ?? "";
}

function formatValue(params: ValueGetterParams<TopicMessage>): string {
  return messageValueText(params.data);
}

function formatKey(params: ValueGetterParams<TopicMessage>): string {
  return messageKeyText(params.data);
}

/**
 * How long streamed messages accumulate before being written to the grid.
 *
 * Short enough that rows still appear to arrive continuously, long enough that
 * the arrival rate stops mattering: at any speed the grid re-renders ten times
 * a second rather than once per message.
 */
const STREAM_FLUSH_MS = 100;

/** Keeps the search bar's quick filter scoped to key + value by opting these columns out of it. */
const excludeFromQuickFilter = () => "";

/** Mirrors AG Grid's own quick-filter matching (case-insensitive substring over the Key/Value columns' text, the only two that don't opt out via `excludeFromQuickFilter`) so the "N / total" count above the grid reflects exactly what's visible, without reaching into the grid's internal API. */
function matchesSearch(message: TopicMessage, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return messageKeyText(message).toLowerCase().includes(q) || messageValueText(message).toLowerCase().includes(q);
}

const COLUMN_DEFS: ColDef<TopicMessage>[] = [
  { field: "partition", headerName: "Partition", width: 100, getQuickFilterText: excludeFromQuickFilter },
  { field: "offset", headerName: "Offset", width: 100, getQuickFilterText: excludeFromQuickFilter },
  {
    field: "timestampMs",
    headerName: "Timestamp",
    valueFormatter: formatTimestamp,
    width: 200,
    getQuickFilterText: excludeFromQuickFilter,
  },
  { headerName: "Key", valueGetter: formatKey, width: 150 },
  { headerName: "Value", valueGetter: formatValue, cellRenderer: ValueCell, flex: 1 },
];

const DEFAULT_COL_DEF: ColDef<TopicMessage> = {
  sortable: true,
  filter: true,
  resizable: true,
};

export interface DataTabProps {
  connectionId: string;
  topicName: string;
  /** When set, this Data tab is scoped to a single partition — the Partition filter is prepopulated and locked to it. */
  partitionId?: number;
}

/**
 * Fetch pulls a bounded snapshot of message metadata applying the filters
 * below (an all-blank filter pulls everything). Stop both discards the
 * result client-side (so late-arriving stream events/the final result never
 * reach the grid) and tells the backend to interrupt the poll loop that's
 * running it, via `connection_cancel_fetch` — see `stopActiveFetch`.
 */
export function DataTab({ connectionId, topicName, partitionId }: DataTabProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const fetchMessages = useFetchMessages();
  const viewMessage = useMessageViewerStore((s) => s.viewMessage);
  const stoppedRef = useRef(false);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabKey = dataTabCacheKey(activeTabId, connectionId, topicName, partitionId);
  // Keyed the same way as the cached messages below, so returning to a
  // topic (or partition) you've already set filters on shows them exactly
  // as you left them, instead of resetting every time this component's
  // props change to a different topic and back.
  const defaultForm = partitionId === undefined ? emptyFilterForm() : { ...emptyFilterForm(), partitions: String(partitionId) };
  const form = useDataTabFiltersStore((s) => s.formByTab[tabKey]) ?? defaultForm;
  const setStoredForm = useDataTabFiltersStore((s) => s.setForm);
  const tabKeyRef = useRef(tabKey);
  tabKeyRef.current = tabKey;
  const messages = useTabDataStore((s) => s.messagesByTab[tabKey] ?? EMPTY_TAB_MESSAGES);
  const visibleMessageCount = useMemo(
    () => (searchText ? messages.filter((m) => matchesSearch(m, searchText)).length : messages.length),
    [messages, searchText],
  );
  // Only worth telling the user the search is bounded when the loaded rows
  // actually reach that bound.
  const hasOversizedValues = useMemo(() => messages.some((m) => exceedsValuePreview(m.payloadBase64)), [messages]);
  const setTabMessages = useTabDataStore((s) => s.setTabMessages);
  const setTabTotalMatching = useTabDataStore((s) => s.setTabTotalMatching);
  /** How many messages match the last Fetch's filter in total, uncapped by "max messages per partition"/"total max messages" — `messages.length` can be smaller when those caps trimmed the result. `undefined` before any Fetch has run for this tab. */
  const totalMatching = useTabDataStore((s) => s.totalMatchingByTab[tabKey]);
  const appendTabMessages = useTabDataStore((s) => s.appendTabMessages);
  /** Streamed messages waiting to be written to the store — see the listener below. */
  const streamBufferRef = useRef<TopicMessage[]>([]);
  const streamFlushHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tags the in-flight Fetch's `requestId` so the "messages-batch" listener below can tell its rows apart from a stale/superseded fetch's late-arriving events — see `MessagesBatchEvent`'s doc comment. */
  const activeRequestIdRef = useRef<string | null>(null);

  // Streams rows into the grid as connection_fetch_messages's backend task
  // polls them, instead of leaving the grid empty until the whole fetch
  // finishes. Subscribed once (not per-fetch) and reads the current
  // request/tab via refs, since re-subscribing on every Fetch click would
  // risk a race between the old listener's teardown and a new one's setup.
  //
  // Arrivals are buffered and flushed on a timer rather than written straight
  // through: one store write per message means one grid render per message,
  // and each rebuilds the tab's row array, so a big fetch spends longer
  // painting rows than it does fetching them (20,000 messages: ~1.15s of
  // copying across 20,000 renders, against ~11ms across 100 batched ones).
  // A tenth of a second is below what reads as delay, and turns any arrival
  // rate into at most ten renders a second.
  useEffect(() => {
    const flush = () => {
      streamFlushHandleRef.current = null;
      const buffered = streamBufferRef.current;
      if (buffered.length === 0) return;
      streamBufferRef.current = [];
      appendTabMessages(tabKeyRef.current, buffered);
    };

    const unlisten = listen<MessagesBatchEvent>("messages-batch", (event) => {
      if (stoppedRef.current) return;
      if (event.payload.requestId !== activeRequestIdRef.current) return;
      streamBufferRef.current.push(event.payload.message);
      if (streamFlushHandleRef.current === null) {
        streamFlushHandleRef.current = setTimeout(flush, STREAM_FLUSH_MS);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      if (streamFlushHandleRef.current !== null) clearTimeout(streamFlushHandleRef.current);
    };
  }, [appendTabMessages]);

  // DataTab is reused (not remounted) when switching between topics,
  // partitions, or connections within the same top-level tab — neither
  // App.tsx's <TopicDetailPanel>/<PartitionDetailPanel> nor this component
  // are keyed by topic/partition, only by the top-level tab. The fetch
  // filter form is keyed per-topic above so it doesn't need resetting here
  // (and correctly persists if you come back to a topic you'd already set
  // it on) — but the quick-filter search box and any leftover error from a
  // previous fetch are deliberately NOT persisted per topic, so they still
  // need an explicit reset: a leftover "Search messages" quick-filter
  // carrying over to a completely different topic could silently hide/skew
  // its results, making a successful Fetch look like it returned nothing.
  //
  // The right pane's viewed message needs a reset for the same underlying
  // reason, but is deliberately NOT handled here — this component isn't
  // even mounted while a non-Data sub-tab (e.g. Properties) is active, so a
  // clear scoped to this effect would silently fail to fire when the user
  // switches topics from one of those. That reset lives in App.tsx instead,
  // driven directly off `useWorkspaceSelectionStore`'s `selection`, which
  // always changes on a topic/partition switch regardless of which sub-tab
  // (or component) happens to be mounted at the time.
  useEffect(() => {
    stopActiveFetch();
    setSearchText("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, topicName, partitionId]);

  function updateForm(patch: Partial<FilterFormState>) {
    setStoredForm(tabKey, { ...form, ...patch });
  }

  async function handlePlay() {
    setError(null);
    const maxMessagesError = validateMaxMessagesPerPartition(form);
    if (maxMessagesError) {
      setError(maxMessagesError);
      return;
    }
    const dateRangeError = validateDateRange(form);
    if (dateRangeError) {
      setError(dateRangeError);
      return;
    }
    setIsPlaying(true);
    stoppedRef.current = false;
    discardBufferedStream();
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    setTabMessages(tabKey, []);
    try {
      const result = await fetchMessages.mutateAsync({
        connectionId,
        topic: topicName,
        filter: toMessageFilter(form),
        requestId,
      });
      if (!stoppedRef.current) {
        setTabMessages(tabKey, result.messages);
        setTabTotalMatching(tabKey, result.totalMatching);
      }
    } catch (err) {
      if (!stoppedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch messages");
      }
    } finally {
      setIsPlaying(false);
    }
  }

  /**
   * Drops anything streamed but not yet written to the store.
   *
   * Buffered messages belong to whichever request was in flight when they
   * arrived: carrying them into the next fetch would paint one filter's rows
   * into another's results, and past a Stop they are rows the user asked not
   * to wait for.
   */
  function discardBufferedStream() {
    streamBufferRef.current = [];
    if (streamFlushHandleRef.current !== null) {
      clearTimeout(streamFlushHandleRef.current);
      streamFlushHandleRef.current = null;
    }
  }

  /**
   * Stops the in-flight fetch, client-side and on the backend, and
   * re-enables the filters. Used by the Stop button directly, and by the
   * topic/partition/connection-switch effect below — DataTab is reused
   * (not remounted) across a tab's topics, so without this a fetch left
   * running when the user switches away keeps polling the old topic's
   * broker for a tab nobody is waiting on anymore. Safe to call when
   * nothing is in flight: `activeRequestIdRef` is only set by a Fetch, and
   * cancelling an already-finished/unknown request id is a no-op on the
   * backend.
   */
  function stopActiveFetch() {
    stoppedRef.current = true;
    discardBufferedStream();
    setIsPlaying(false);
    if (activeRequestIdRef.current) {
      api.cancelFetch(activeRequestIdRef.current).catch(() => {});
    }
  }

  function handleStop() {
    stopActiveFetch();
  }

  /** Fetches just one row's payload (by its exact partition/offset) and patches it into the cached rows — reads the store directly so it always applies on top of the latest cached rows regardless of how long the fetch took. */
  async function fetchPayloadForRow(row: TopicMessage) {
    const result = await fetchMessages.mutateAsync({
      connectionId,
      topic: topicName,
      filter: {
        partitions: [row.partition],
        maxMessagesPerPartition: 1,
        maxTotalMessages: 1,
        fromTimestampMs: null,
        toTimestampMs: null,
        offset: row.offset,
        includePayload: true,
      },
      // Own, unmatched request id — this single-row fetch shouldn't be
      // appended to the grid via the "messages-batch" listener above (which
      // only reacts to the main Fetch's activeRequestIdRef); its result is
      // patched into the cached rows directly below instead.
      requestId: crypto.randomUUID(),
    });
    const updated = result.messages.find((m) => m.partition === row.partition && m.offset === row.offset);
    if (!updated) return;
    const current = useTabDataStore.getState().messagesByTab[tabKey] ?? EMPTY_TAB_MESSAGES;
    setTabMessages(
      tabKey,
      current.map((m) => (m.partition === row.partition && m.offset === row.offset ? updated : m)),
    );
  }

  const gridContext: ValueCellContext = { fetchPayload: fetchPayloadForRow };

  return (
    <div className="data-tab">
      <div className="data-tab-filters">
        <label>
          Max messages per partition
          <input
            inputMode="numeric"
            value={form.maxMessagesPerPartition}
            onChange={(e) => updateForm({ maxMessagesPerPartition: e.target.value })}
            disabled={isPlaying}
          />
        </label>
        <label>
          Total max messages
          <input
            inputMode="numeric"
            value={form.maxTotalMessages}
            onChange={(e) => updateForm({ maxTotalMessages: e.target.value })}
            disabled={isPlaying}
          />
        </label>
        <label>
          Partition filter
          <input
            value={form.partitions}
            onChange={(e) => updateForm({ partitions: e.target.value })}
            placeholder="e.g. 0, 1, 2"
            disabled={partitionId !== undefined || isPlaying}
          />
        </label>
        <label>
          Offset
          <input
            inputMode="numeric"
            value={form.offset}
            onChange={(e) => updateForm({ offset: e.target.value })}
            placeholder="e.g. 100"
            disabled={isPlaying}
          />
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={form.fromDate}
            onChange={(e) => updateForm({ fromDate: e.target.value })}
            disabled={isPlaying}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={form.toDate}
            onChange={(e) => updateForm({ toDate: e.target.value })}
            disabled={isPlaying}
          />
        </label>
      </div>

      <div className="data-tab-controls">
        <button type="button" aria-label="Fetch" onClick={handlePlay} disabled={isPlaying}>
          ▶ Fetch
        </button>
        <button type="button" aria-label="Stop" onClick={handleStop} disabled={!isPlaying}>
          ■ Stop
        </button>
      </div>
      <label className="connection-modal-checkbox-label data-tab-include-payload">
        <input
          type="checkbox"
          checked={form.includePayload}
          onChange={(e) => updateForm({ includePayload: e.target.checked })}
          disabled={isPlaying}
        />
        Load message payload
      </label>

      {error && (
        <p role="alert" className="connection-modal-error">
          {error}
        </p>
      )}

      <label className="data-tab-search">
        Search messages
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search by key or value"
        />
      </label>

      {hasOversizedValues && (
        <p className="data-tab-search-notice">
          Some messages exceed {VALUE_PREVIEW_BYTES / 1024} KB. Search examines only the first{" "}
          {VALUE_PREVIEW_BYTES / 1024} KB of each message value; open a message to view its full payload.
        </p>
      )}

      <p className="data-tab-total-count">
        {/*
          Spelled out rather than "100 / 600000 loaded", which reads as though
          the fetch pulled 600,000 messages. It pulled the number on the left;
          the number on the right is how many exist within the filter, and the
          gap is what tells you more are there. Separators because a bare
          600000 is hard to size at a glance.
        */}
        {visibleMessageCount.toLocaleString()} loaded of {(totalMatching ?? messages.length).toLocaleString()} matching
      </p>

      <div className="data-tab-grid" data-testid="message-grid">
        <AgGridReact<TopicMessage>
          theme={APP_GRID_THEME}
          rowData={messages}
          columnDefs={COLUMN_DEFS}
          defaultColDef={DEFAULT_COL_DEF}
          quickFilterText={searchText}
          context={gridContext}
          // Only until the first row lands, not for the whole fetch. The
          // backend streams each message to the grid as it polls it (see the
          // "messages-batch" listener above), but AG Grid's loading overlay
          // covers the rows it is streaming in — so the work was done and
          // then hidden, and the user waited for the whole fetch anyway.
          // Once rows exist they stay visible and keep arriving; the Stop
          // button and the growing "N loaded of M matching" count are what
          // show the fetch is still running.
          loading={isPlaying && messages.length === 0}
          overlayNoRowsTemplate="<span class='data-tab-no-rows'>No messages</span>"
          onRowClicked={(event) => {
            // AG Grid's row-click detection runs regardless of stopPropagation
            // on the Value column's "Fetch payload" button, so guard here
            // instead — otherwise clicking it also opens the viewer with
            // whatever (possibly payload-less) row data existed at click
            // time, racing the in-flight per-row fetch.
            const target = event.event?.target;
            if (target instanceof HTMLElement && target.closest("button")) return;
            if (event.data) viewMessage(event.data, connectionId, topicName, partitionId);
          }}
        />
      </div>
    </div>
  );
}
