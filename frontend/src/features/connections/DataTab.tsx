import { useEffect, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, ModuleRegistry, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import { TopicMessage } from "../../lib/tauri";
import { useTabsStore } from "../tabs/useTabsStore";
import { useMessageViewerStore } from "../workspace/useMessageViewerStore";
import { dataTabCacheKey, EMPTY_TAB_MESSAGES, useTabDataStore } from "../workspace/useTabDataStore";
import { APP_GRID_THEME } from "./agGridTheme";
import { emptyFilterForm, FilterFormState, toMessageFilter } from "./dataFilters";
import { base64ToBytes, bytesToText, detectConfluentAvro } from "./payloadDecoding";
import { useFetchMessages } from "./useClusterResources";
import { ValueCell, ValueCellContext } from "./ValueCell";

ModuleRegistry.registerModules([AllCommunityModule]);

function formatTimestamp(params: ValueFormatterParams<TopicMessage, number | null>): string {
  return params.value ? new Date(params.value).toISOString() : "";
}

/** Decodes the row's payload for the Value column — blank until "Load message payload" is checked and a fetch has run. */
function formatValue(params: ValueGetterParams<TopicMessage>): string {
  const payload = params.data?.payloadBase64;
  if (!payload) return "";
  const bytes = base64ToBytes(payload);
  const avro = detectConfluentAvro(bytes);
  if (avro) return `Avro (schema id: ${avro.schemaId})`;
  return bytesToText(bytes);
}

/** Keeps the search bar's quick filter scoped to key + value by opting these columns out of it. */
const excludeFromQuickFilter = () => "";

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
  { field: "key", headerName: "Key", width: 150 },
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
  const [form, setForm] = useState<FilterFormState>(() =>
    partitionId === undefined ? emptyFilterForm() : { ...emptyFilterForm(), partitions: String(partitionId) },
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const fetchMessages = useFetchMessages();
  const viewMessage = useMessageViewerStore((s) => s.viewMessage);
  const stoppedRef = useRef(false);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabKey = dataTabCacheKey(activeTabId, connectionId, topicName, partitionId);
  const messages = useTabDataStore((s) => s.messagesByTab[tabKey] ?? EMPTY_TAB_MESSAGES);
  const setTabMessages = useTabDataStore((s) => s.setTabMessages);

  // DataTab is reused (not remounted) when switching between topics,
  // partitions, or connections within the same top-level tab — neither
  // App.tsx's <TopicDetailPanel>/<PartitionDetailPanel> nor this component
  // are keyed by topic/partition, only by the top-level tab. Without this,
  // a filter (or a leftover "Search messages" quick-filter) entered while
  // looking at one topic would silently carry over and hide/skew results
  // after switching to a completely different topic — e.g. leftover search
  // text that doesn't match any of the new topic's rows makes a
  // successful Fetch look like it returned nothing.
  useEffect(() => {
    setForm(
      partitionId === undefined ? emptyFilterForm() : { ...emptyFilterForm(), partitions: String(partitionId) },
    );
    setSearchText("");
    setError(null);
  }, [connectionId, topicName, partitionId]);

  function updateForm(patch: Partial<FilterFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handlePlay() {
    setError(null);
    setIsPlaying(true);
    stoppedRef.current = false;
    try {
      const result = await fetchMessages.mutateAsync({
        connectionId,
        topic: topicName,
        filter: toMessageFilter(form),
      });
      if (!stoppedRef.current) {
        setTabMessages(tabKey, result);
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
    });
    const updated = result.find((m) => m.partition === row.partition && m.offset === row.offset);
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
          placeholder="Search…"
        />
      </label>

      <div className="data-tab-grid" data-testid="message-grid">
        <AgGridReact<TopicMessage>
          theme={APP_GRID_THEME}
          rowData={messages}
          columnDefs={COLUMN_DEFS}
          defaultColDef={DEFAULT_COL_DEF}
          quickFilterText={searchText}
          context={gridContext}
          overlayNoRowsTemplate="<span class='data-tab-no-rows'>No messages</span>"
          onRowClicked={(event) => {
            // AG Grid's row-click detection runs regardless of stopPropagation
            // on the Value column's "Fetch payload" button, so guard here
            // instead — otherwise clicking it also opens the viewer with
            // whatever (possibly payload-less) row data existed at click
            // time, racing the in-flight per-row fetch.
            const target = event.event?.target;
            if (target instanceof HTMLElement && target.closest("button")) return;
            if (event.data) viewMessage(event.data, connectionId, topicName);
          }}
        />
      </div>
    </div>
  );
}
