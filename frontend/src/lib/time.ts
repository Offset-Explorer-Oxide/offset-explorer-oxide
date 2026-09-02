/**
 * Every timestamp the app puts on screen, rendered in the machine's own
 * timezone.
 *
 * Kafka carries timestamps as epoch milliseconds, and the backend's log
 * entries as UTC RFC 3339 strings — both absolute instants with no timezone
 * of their own. Rendering them with `toISOString()` (which is what the Data
 * grid and the logs panel used to do) shows every one of them in UTC, so a
 * user in IST reading a message produced "just now" saw a time five and a
 * half hours behind their own clock, and the Data tab's From/To filter —
 * whose `datetime-local` inputs have always been read as *local* time — was
 * quietly working in a different timezone from the column it filters.
 *
 * Both are converted here instead, once, so the whole app agrees with the
 * system clock and with itself.
 */

/** Two-digit zero-padded, for the fixed-width parts of the format below. */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * `YYYY-MM-DD HH:mm:ss.SSS` in the system's local timezone.
 *
 * Deliberately not `toLocaleString()`, despite that being the obvious way to
 * ask for "the system's format": it drops milliseconds (which is the
 * difference between two messages produced in the same second being
 * distinguishable or not), and its output moves with the machine's locale —
 * `9/2/2026` in one place and `02/09/2026` in another for the same instant,
 * neither of which sorts or lines up in a column. The local *time* is what
 * the user asked for; the layout stays fixed-width and unambiguous.
 *
 * Accepts either an epoch-millisecond number (`TopicMessage.timestampMs`) or
 * a date string (the backend's RFC 3339 log timestamps). Anything that isn't
 * a real instant is passed straight back — a log line whose timestamp this
 * cannot parse is still better shown as it arrived than blanked.
 */
export function formatLocalTimestamp(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

/**
 * A short name for the timezone the formatter above renders in — "IST",
 * "GMT+5:30", "PDT" — for the Data grid's column header.
 *
 * The zone belongs in the header rather than repeated on every row: a
 * thousand rows all say the same thing, and a timestamp column is read by
 * scanning down it, which a per-row offset suffix makes harder. Falls back
 * to the IANA zone name, and then to nothing at all, rather than throwing —
 * a header is not worth a blank grid.
 */
export function localTimeZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (name) return name;
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
