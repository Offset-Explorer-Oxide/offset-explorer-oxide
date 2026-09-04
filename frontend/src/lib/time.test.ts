import { describe, expect, it, vi } from "vitest";
import { formatLocalTimestamp, localTimeZoneLabel } from "./time";

const LOCAL_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

describe("formatLocalTimestamp", () => {
  it("renders an epoch-millisecond timestamp in the fixed local format", () => {
    expect(formatLocalTimestamp(Date.UTC(2026, 8, 2, 1, 6, 7, 123))).toMatch(LOCAL_FORMAT);
  });

  /**
   * The point of the whole module: the parts shown must be the machine's own
   * clock reading of that instant, not UTC's. Asserted against `Date`'s local
   * getters rather than a hard-coded string so the test states "local" in a
   * way that holds in whatever timezone it happens to run in — including a CI
   * box set to UTC, where the two only coincide.
   */
  it("shows the system's local wall-clock reading of the instant, not UTC", () => {
    const ms = Date.UTC(2026, 8, 2, 1, 6, 7, 123);
    const local = new Date(ms);

    expect(formatLocalTimestamp(ms)).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-` +
        `${String(local.getDate()).padStart(2, "0")} ` +
        `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}:` +
        `${String(local.getSeconds()).padStart(2, "0")}.123`,
    );
  });

  it("keeps milliseconds, which is what distinguishes two messages produced in the same second", () => {
    const second = Date.UTC(2026, 8, 2, 1, 6, 7, 0);
    expect(formatLocalTimestamp(second + 4)).toMatch(/\.004$/);
    expect(formatLocalTimestamp(second + 40)).toMatch(/\.040$/);
    expect(formatLocalTimestamp(second)).toMatch(/\.000$/);
  });

  /** The backend's log entries arrive as RFC 3339 strings, the grid's rows as numbers — the same instant either way. */
  it("renders a date string and its epoch-millisecond equivalent identically", () => {
    const ms = Date.UTC(2026, 8, 2, 1, 6, 7, 123);
    expect(formatLocalTimestamp(new Date(ms).toISOString())).toBe(formatLocalTimestamp(ms));
  });

  it("renders nothing for a message that carries no timestamp", () => {
    expect(formatLocalTimestamp(null)).toBe("");
    expect(formatLocalTimestamp(undefined)).toBe("");
    expect(formatLocalTimestamp("")).toBe("");
  });

  /** A log line is still worth showing as it arrived; a numeric NaN has nothing to show. */
  it("passes an unparseable string through and blanks an unparseable number", () => {
    expect(formatLocalTimestamp("12:00:00")).toBe("12:00:00");
    expect(formatLocalTimestamp(Number.NaN)).toBe("");
  });

  /** Epoch 0 is a real instant, and `!value` would have blanked it. */
  it("formats the epoch itself rather than treating 0 as absent", () => {
    expect(formatLocalTimestamp(0)).toMatch(LOCAL_FORMAT);
  });
});

describe("localTimeZoneLabel", () => {
  it("names the zone the formatter renders in", () => {
    expect(localTimeZoneLabel()).toBe(
      new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value,
    );
  });

  it("is a non-empty short name, so the column header can carry it", () => {
    expect(localTimeZoneLabel().length).toBeGreaterThan(0);
  });

  /** A header is not worth a blank grid — see the fallbacks in `localTimeZoneLabel`. */
  it("falls back to the IANA zone name when the platform offers no short name", () => {
    const real = Intl.DateTimeFormat;
    const stub = Object.assign(
      function () {
        return {
          formatToParts: () => [{ type: "literal", value: "" }],
          resolvedOptions: () => ({ timeZone: "Asia/Kolkata" }),
        };
      },
      { supportedLocalesOf: real.supportedLocalesOf },
    ) as unknown as typeof Intl.DateTimeFormat;

    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: stub });
    try {
      expect(localTimeZoneLabel()).toBe("Asia/Kolkata");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns an empty label rather than throwing when Intl is unusable", () => {
    vi.stubGlobal("Intl", {
      ...Intl,
      DateTimeFormat: () => {
        throw new Error("no ICU data");
      },
    });
    try {
      expect(localTimeZoneLabel()).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
