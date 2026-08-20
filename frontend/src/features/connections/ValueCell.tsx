import { MouseEvent as ReactMouseEvent, useState } from "react";
import { ICellRendererParams } from "ag-grid-community";
import { TopicMessage } from "../../lib/tauri";
import { base64ToBytes, bytesToText, detectConfluentAvro } from "./payloadDecoding";

export interface ValueCellContext {
  /** Fetches just this one row's payload and writes it back into the cached tab data. */
  fetchPayload: (row: TopicMessage) => Promise<void>;
}

export function decodePayload(payloadBase64: string): string {
  const bytes = base64ToBytes(payloadBase64);
  const avro = detectConfluentAvro(bytes);
  if (avro) return `Avro (schema id: ${avro.schemaId})`;
  return bytesToText(bytes);
}

/**
 * The Data tab's Value column. Rows fetched without "Load message payload"
 * checked have no payload to show — rather than leaving the cell blank,
 * offer a per-row way to go back and fetch just that one message's payload
 * instead of re-running the whole filter with the checkbox on.
 */
export function ValueCell(params: ICellRendererParams<TopicMessage> & { context: ValueCellContext }) {
  const [isFetching, setIsFetching] = useState(false);
  const row = params.data;

  if (!row) return null;

  if (row.payloadBase64 !== null) {
    return <>{decodePayload(row.payloadBase64)}</>;
  }

  async function handleClick(e: ReactMouseEvent) {
    e.stopPropagation();
    setIsFetching(true);
    try {
      await params.context.fetchPayload(row!);
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <button type="button" className="value-cell-fetch-button" onClick={handleClick} disabled={isFetching}>
      {isFetching ? "Fetching…" : "Fetch payload"}
    </button>
  );
}
