import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, ModuleRegistry, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import { listen } from "@tauri-apps/api/event";
import { MessagesBatchEvent, TopicMessage } from "../../lib/tauri";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, EMPTY_TAB_MESSAGES, useTabDataStore } from "../workspace/useTabDataStore";
import { APP_GRID_THEME } from "./agGridTheme";
import { emptyFilterForm, FilterFormState, toMessageFilter } from "./dataFilters";
import { useDataTabFiltersStore } from "./useDataTabFiltersStore";
import { base64ToBytes, base64ToDisplayText, bytesToText, detectConfluentAvro } from "./payloadDecoding";
import { useFetchMessages } from "./useClusterResources";
import { ValueCell, ValueCellContext } from "./ValueCell";

ModuleRegistry.registerModules([AllCommunityModule]);

function formatTimestamp(params: ValueFormatterParams<TopicMessage, number | null>): string {
  return params.value ? new Date(params.value).toISOString() : "";
}

/** Decodes a message's payload for the Value column — blank until "Load message payload" is checked and a fetch has run. */
function messageValueText(message: TopicMessage | undefined): string {
  const payload = message?.payloadBase64;
  if (!payload) return "";
  const bytes = base64ToBytes(payload);
  const avro = detectConfluentAvro(bytes);
  if (avro) return `Avro (schema id: ${avro.schemaId})`;
  return bytesToText(bytes);
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
 * below (an all-blank filter pulls everything). Stop doesn't cancel the
 * in-flight backend fetch (no cancellation plumbing there) — it just
 * discards the result when it eventually arrives, so the grid never
 * updates with data the user already asked to stop waiting for.
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
  const setTabMessages = useTabDataStore((s) => s.setTabMessages);
  const setTabTotalMatching = useTabDataStore((s) => s.setTabTotalMatching);
  /** How many messages match the last Fetch's filter in total, uncapped by "max messages per partition"/"total max messages" — `messages.length` can be smaller when those caps trimmed the result. `undefined` before any Fetch has run for this tab. */
  const totalMatching = useTabDataStore((s) => s.totalMatchingByTab[tabKey]);
  const appendTabMessage = useTabDataStore((s) => s.appendTabMessage);
  /** Tags the in-flight Fetch's `requestId` so the "messages-batch" listener below can tell its rows apart from a stale/superseded fetch's late-arriving events — see `MessagesBatchEvent`'s doc comment. */
  const activeRequestIdRef = useRef<string | null>(null);

  // Streams rows into the grid as connection_fetch_messages's backend task
  // polls them, instead of leaving the grid empty until the whole fetch
  // finishes. Subscribed once (not per-fetch) and reads the current
  // request/tab via refs, since re-subscribing on every Fetch click would
  // risk a race between the old listener's teardown and a new one's setup.
  useEffect(() => {
    const unlisten = listen<MessagesBatchEvent>("messages-batch", (event) => {
      if (stoppedRef.current) return;
      if (event.payload.requestId !== activeRequestIdRef.current) return;
      appendTabMessage(tabKeyRef.current, event.payload.message);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appendTabMessage]);

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
    setSearchText("");
    setError(null);
  }, [connectionId, topicName, partitionId]);

  function updateForm(patch: Partial<FilterFormState>) {
    setStoredForm(tabKey, { ...form, ...patch });
  }

  async function handlePlay() {
    setError(null);
    setIsPlaying(true);
    stoppedRef.current = false;
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

  function handleStop() {
    stoppedRef.current = true;
    setIsPlaying(false);
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
          />
        </label>
        <label>
          Total max messages
          <input
            inputMode="numeric"
            value={form.maxTotalMessages}
            onChange={(e) => updateForm({ maxTotalMessages: e.target.value })}
          />
        </label>
        <label>
          Partition filter
          <input
            value={form.partitions}
            onChange={(e) => updateForm({ partitions: e.target.value })}
            placeholder="e.g. 0, 1, 2"
            disabled={partitionId !== undefined}
          />
        </label>
        <label>
          Offset
          <input
            inputMode="numeric"
            value={form.offset}
            onChange={(e) => updateForm({ offset: e.target.value })}
            placeholder="e.g. 100"
          />
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={form.fromDate}
            onChange={(e) => updateForm({ fromDate: e.target.value })}
          />
        </label>
        <label>
          To
          <input type="datetime-local" value={form.toDate} onChange={(e) => updateForm({ toDate: e.target.value })} />
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

      <p className="data-tab-message-count">
        {visibleMessageCount} / {messages.length} messages
      </p>
      <p className="data-tab-total-count">
        {messages.length} / {totalMatching ?? messages.length} loaded
      </p>

      <div className="data-tab-grid" data-testid="message-grid">
        <AgGridReact<TopicMessage>
          theme={APP_GRID_THEME}
          rowData={messages}
          columnDefs={COLUMN_DEFS}
          defaultColDef={DEFAULT_COL_DEF}
          quickFilterText={searchText}
          context={gridContext}
          loading={isPlaying}
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
