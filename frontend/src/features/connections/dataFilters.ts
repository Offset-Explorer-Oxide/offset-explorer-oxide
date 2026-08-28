import { MessageFilter } from "../../lib/tauri";
import { VALUE_PREVIEW_BYTES } from "./payloadDecoding";

/** Editable form state for the topic Data tab's filter inputs. */
export interface FilterFormState {
  maxMessagesPerPartition: string;
  maxTotalMessages: string;
  /** Comma-separated partition ids, e.g. "0, 2, 5". */
  partitions: string;
  /** `<input type="datetime-local">` value. */
  fromDate: string;
  toDate: string;
  /** An explicit starting offset — takes priority over fromDate on the backend when both are set. */
  offset: string;
  /** The "Load message payload" checkbox below Play. */
  includePayload: boolean;
}

/** Matches the backend's own fallback (`DEFAULT_MESSAGE_CAP` in `messages.rs`) — shown as the field's actual starting value rather than left blank, so the cap that's about to be applied is visible up front instead of only discoverable after a fetch returns fewer rows than expected. */
const DEFAULT_MAX_MESSAGES_PER_PARTITION = "100";

/**
 * The overall budget a fetch spends, prefilled for the same reason the
 * per-partition cap is: so the limit about to be applied is visible before
 * the fetch rather than inferred from the result.
 *
 * Prefilled rather than left blank because blank means "no overall budget",
 * and without one a fetch costs "max messages per partition" x however many
 * partitions the topic has — 100 on a 12-partition topic reads 1,200
 * messages to show you 100 of them, and on a topic of multi-megabyte records
 * that is the difference between a fetch that returns and one that appears
 * to hang. Clear the field deliberately to read the full per-partition
 * window from every partition.
 */
const DEFAULT_MAX_TOTAL_MESSAGES = "100";

export function emptyFilterForm(): FilterFormState {
  return {
    maxMessagesPerPartition: DEFAULT_MAX_MESSAGES_PER_PARTITION,
    maxTotalMessages: DEFAULT_MAX_TOTAL_MESSAGES,
    partitions: "",
    fromDate: "",
    toDate: "",
    offset: "",
    includePayload: false,
  };
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePartitions(value: string): number[] | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = trimmed
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
  return parsed.length > 0 ? parsed : null;
}

function parseDate(value: string): number | null {
  if (value.trim().length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Validates the From/To date filter inputs — returns an error message if both are set and To isn't strictly after From, otherwise null. */
export function validateDateRange(form: FilterFormState): string | null {
  const fromMs = parseDate(form.fromDate);
  const toMs = parseDate(form.toDate);
  if (fromMs !== null && toMs !== null && toMs <= fromMs) {
    return "\"To\" date must be after \"From\" date";
  }
  return null;
}

/** Max messages per partition is pre-filled by `emptyFilterForm` specifically so the cap about to be applied is always visible — clearing it back to blank would silently defer to the backend's own default cap instead, undoing that visibility, so it's rejected here rather than allowed through. */
export function validateMaxMessagesPerPartition(form: FilterFormState): string | null {
  if (form.maxMessagesPerPartition.trim().length === 0) {
    return "\"Max messages per partition\" is required";
  }
  return null;
}

/** Converts the filter form into the wire-format MessageFilter — a blank field becomes `null` (no filter) for every field except `maxMessagesPerPartition`, which `validateMaxMessagesPerPartition` requires to always be set before this is called from the Fetch flow. */
export function toMessageFilter(form: FilterFormState): MessageFilter {
  return {
    partitions: parsePartitions(form.partitions),
    maxMessagesPerPartition: parsePositiveInt(form.maxMessagesPerPartition),
    maxTotalMessages: parsePositiveInt(form.maxTotalMessages),
    fromTimestampMs: parseDate(form.fromDate),
    toTimestampMs: parseDate(form.toDate),
    offset: parsePositiveInt(form.offset),
    includePayload: form.includePayload,
    // Never the whole payload: this filter only ever feeds the grid, whose
    // Value column shows one line and whose search reads no further than
    // this. The full bytes are fetched per message, when one is opened.
    maxPayloadPreviewBytes: VALUE_PREVIEW_BYTES,
  };
}
