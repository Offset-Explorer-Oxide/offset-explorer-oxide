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
