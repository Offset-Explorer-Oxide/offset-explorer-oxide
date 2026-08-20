import { MessageFilter } from "../../lib/tauri";

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

export function emptyFilterForm(): FilterFormState {
  return {
    maxMessagesPerPartition: "",
    maxTotalMessages: "",
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

/** Converts the filter form into the wire-format MessageFilter — an all-blank form becomes an all-null filter (pull everything). */
export function toMessageFilter(form: FilterFormState): MessageFilter {
  return {
    partitions: parsePartitions(form.partitions),
    maxMessagesPerPartition: parsePositiveInt(form.maxMessagesPerPartition),
    maxTotalMessages: parsePositiveInt(form.maxTotalMessages),
    fromTimestampMs: parseDate(form.fromDate),
    toTimestampMs: parseDate(form.toDate),
    offset: parsePositiveInt(form.offset),
    includePayload: form.includePayload,
  };
}
