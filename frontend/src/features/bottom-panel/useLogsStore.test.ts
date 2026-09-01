import { beforeEach, describe, expect, it } from "vitest";
import { useLogsStore } from "./useLogsStore";

beforeEach(() => {
  useLogsStore.setState({ entries: [], isExpanded: false });
});

describe("useLogsStore isExpanded", () => {
  it("defaults to collapsed", () => {
    expect(useLogsStore.getState().isExpanded).toBe(false);
  });

  it("toggles expanded state", () => {
    useLogsStore.getState().toggleExpanded();
    expect(useLogsStore.getState().isExpanded).toBe(true);

    useLogsStore.getState().toggleExpanded();
    expect(useLogsStore.getState().isExpanded).toBe(false);
  });
});

describe("useLogsStore entries", () => {
  it("clears every entry", () => {
    useLogsStore.getState().addEntry({ timestamp: "12:00:00", level: "info", message: "first" });
    useLogsStore.getState().addEntry({ timestamp: "12:00:01", level: "warn", message: "second" });

    useLogsStore.getState().clearEntries();

    expect(useLogsStore.getState().entries).toEqual([]);
  });
});
