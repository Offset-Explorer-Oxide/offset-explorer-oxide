import { MouseEvent as ReactMouseEvent, useState } from "react";
import { ICellRendererParams } from "ag-grid-community";
import { TopicMessage } from "../../lib/tauri";

export interface ValueCellContext {
  /** Fetches just this one row's payload and writes it back into the cached tab data. */
  fetchPayload: (row: TopicMessage) => Promise<void>;
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
    // `params.value` is the Value column's `valueGetter` output — a bounded,
    // cached preview of the payload (see `decodeValuePreview`). Decoding the
    // payload again here would undo that: AG Grid renders a cell renderer per
    // visible row and again on every scroll, so a screenful of 2 MB messages
    // would decode tens of megabytes each time the grid repaints, to fill a
    // one-line cell.
    return <>{params.value}</>;
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
