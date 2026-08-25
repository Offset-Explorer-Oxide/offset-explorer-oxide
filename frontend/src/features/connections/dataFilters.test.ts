import { describe, expect, it } from "vitest";
import { emptyFilterForm, toMessageFilter, validateDateRange } from "./dataFilters";

describe("emptyFilterForm", () => {
  it("starts with every field blank and includePayload unchecked", () => {
    const form = emptyFilterForm();
    expect(form.maxMessagesPerPartition).toBe("");
    expect(form.maxTotalMessages).toBe("");
    expect(form.partitions).toBe("");
    expect(form.fromDate).toBe("");
    expect(form.toDate).toBe("");
    expect(form.offset).toBe("");
    expect(form.includePayload).toBe(false);
  });
});

describe("toMessageFilter", () => {
  it("converts an all-blank form to an all-null, no-payload filter (pull everything, metadata only)", () => {
    expect(toMessageFilter(emptyFilterForm())).toEqual({
      partitions: null,
      maxMessagesPerPartition: null,
      maxTotalMessages: null,
      fromTimestampMs: null,
      toTimestampMs: null,
      offset: null,
      includePayload: false,
    });
  });

  it("carries includePayload through when checked", () => {
    const form = { ...emptyFilterForm(), includePayload: true };
    expect(toMessageFilter(form).includePayload).toBe(true);
  });

  it("parses maxMessagesPerPartition and maxTotalMessages as numbers", () => {
    const form = { ...emptyFilterForm(), maxMessagesPerPartition: "50", maxTotalMessages: "500" };
    const filter = toMessageFilter(form);
    expect(filter.maxMessagesPerPartition).toBe(50);
    expect(filter.maxTotalMessages).toBe(500);
  });

  it("parses a comma-separated partitions list into numbers, ignoring extra whitespace", () => {
    const form = { ...emptyFilterForm(), partitions: " 0, 2 ,5" };
    expect(toMessageFilter(form).partitions).toEqual([0, 2, 5]);
  });

  it("converts fromDate/toDate datetime-local values to epoch milliseconds", () => {
    const form = { ...emptyFilterForm(), fromDate: "2026-01-01T00:00", toDate: "2026-01-02T00:00" };
    const filter = toMessageFilter(form);
    expect(filter.fromTimestampMs).toBe(new Date("2026-01-01T00:00").getTime());
    expect(filter.toTimestampMs).toBe(new Date("2026-01-02T00:00").getTime());
  });

  it("ignores an empty partitions string rather than producing [NaN]", () => {
    const form = { ...emptyFilterForm(), partitions: "   " };
    expect(toMessageFilter(form).partitions).toBeNull();
  });

  it("parses offset as a number", () => {
    const form = { ...emptyFilterForm(), offset: "100" };
    expect(toMessageFilter(form).offset).toBe(100);
  });
});

describe("validateDateRange", () => {
  it("passes when both dates are blank", () => {
    expect(validateDateRange(emptyFilterForm())).toBeNull();
  });

  it("passes when only From is set", () => {
    const form = { ...emptyFilterForm(), fromDate: "2026-01-01T00:00" };
    expect(validateDateRange(form)).toBeNull();
  });

  it("passes when only To is set", () => {
    const form = { ...emptyFilterForm(), toDate: "2026-01-01T00:00" };
    expect(validateDateRange(form)).toBeNull();
  });

  it("passes when To is after From", () => {
    const form = { ...emptyFilterForm(), fromDate: "2026-01-01T00:00", toDate: "2026-01-02T00:00" };
    expect(validateDateRange(form)).toBeNull();
  });

  it("fails when To equals From", () => {
    const form = { ...emptyFilterForm(), fromDate: "2026-01-01T00:00", toDate: "2026-01-01T00:00" };
    expect(validateDateRange(form)).toBe('"To" date must be after "From" date');
  });

  it("fails when To is before From", () => {
    const form = { ...emptyFilterForm(), fromDate: "2026-01-02T00:00", toDate: "2026-01-01T00:00" };
    expect(validateDateRange(form)).toBe('"To" date must be after "From" date');
  });
});
