import { beforeEach, describe, expect, it } from "vitest";
import { dataTabCacheKey, tabDataKey, tabDataPrefix, UNASSIGNED_TAB_KEY, useTabDataStore } from "./useTabDataStore";

const sample = [{ partition: 0, offset: 1, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];

beforeEach(() => {
  useTabDataStore.setState({ messagesByTab: {} });
});

describe("tabDataKey", () => {
  it("passes through a real tab id", () => {
    expect(tabDataKey("tab-1")).toBe("tab-1");
  });

  it("falls back to the unassigned key when there is no active tab", () => {
    expect(tabDataKey(null)).toBe(UNASSIGNED_TAB_KEY);
  });
});

describe("dataTabCacheKey", () => {
  it("differs for different topics in the same tab", () => {
    expect(dataTabCacheKey("tab-1", "conn-1", "orders")).not.toBe(dataTabCacheKey("tab-1", "conn-1", "payments"));
  });

  it("differs for a topic's Data tab vs. one of its partitions'", () => {
    expect(dataTabCacheKey("tab-1", "conn-1", "orders")).not.toBe(dataTabCacheKey("tab-1", "conn-1", "orders", 0));
  });

  it("differs for different partitions of the same topic", () => {
    expect(dataTabCacheKey("tab-1", "conn-1", "orders", 0)).not.toBe(dataTabCacheKey("tab-1", "conn-1", "orders", 1));
  });

  it("is stable for the same inputs", () => {
    expect(dataTabCacheKey("tab-1", "conn-1", "orders", 0)).toBe(dataTabCacheKey("tab-1", "conn-1", "orders", 0));
  });
});

describe("useTabDataStore", () => {
  it("starts with no cached messages for any tab", () => {
    expect(useTabDataStore.getState().messagesByTab).toEqual({});
  });

  it("caches messages under the given tab id", () => {
    useTabDataStore.getState().setTabMessages("tab-1", sample);
    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toEqual(sample);
  });

  it("keeps each tab's cached messages independent", () => {
    const other = [{ partition: 1, offset: 9, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] }];
    useTabDataStore.getState().setTabMessages("tab-1", sample);
    useTabDataStore.getState().setTabMessages("tab-2", other);

    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toEqual(sample);
    expect(useTabDataStore.getState().messagesByTab["tab-2"]).toEqual(other);
  });

  it("clears only the given tab's cached messages", () => {
    useTabDataStore.getState().setTabMessages("tab-1", sample);
    useTabDataStore.getState().setTabMessages("tab-2", sample);

    useTabDataStore.getState().clearTabMessages("tab-1");

    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toBeUndefined();
    expect(useTabDataStore.getState().messagesByTab["tab-2"]).toEqual(sample);
  });

  it("appends a streamed message onto a tab with no cached rows yet", () => {
    useTabDataStore.getState().appendTabMessage("tab-1", sample[0]);
    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toEqual(sample);
  });

  it("appends a streamed message after a tab's existing cached rows", () => {
    const second = { partition: 1, offset: 9, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] };
    useTabDataStore.getState().setTabMessages("tab-1", sample);
    useTabDataStore.getState().appendTabMessage("tab-1", second);

    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toEqual([sample[0], second]);
  });

  it("keeps appended messages scoped to their own tab", () => {
    const other = { partition: 1, offset: 9, timestampMs: null, keyBase64: null, payloadBase64: null, headers: [] };
    useTabDataStore.getState().appendTabMessage("tab-1", sample[0]);
    useTabDataStore.getState().appendTabMessage("tab-2", other);

    expect(useTabDataStore.getState().messagesByTab["tab-1"]).toEqual(sample);
    expect(useTabDataStore.getState().messagesByTab["tab-2"]).toEqual([other]);
  });

  it("clears every cached entry for a tab (every topic/partition it holds), leaving other tabs untouched", () => {
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("tab-1", "1", "orders"), sample);
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("tab-1", "1", "payments"), sample);
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("tab-1", "1", "orders", 0), sample);
    useTabDataStore.getState().setTabMessages(dataTabCacheKey("tab-2", "1", "orders"), sample);

    useTabDataStore.getState().clearAllMessagesForTab("tab-1");

    expect(useTabDataStore.getState().messagesByTab).toEqual({
      [dataTabCacheKey("tab-2", "1", "orders")]: sample,
    });
  });
});

describe("tabDataPrefix", () => {
  it("matches every dataTabCacheKey minted for the same tab", () => {
    const prefix = tabDataPrefix("tab-1");
    expect(dataTabCacheKey("tab-1", "1", "orders").startsWith(prefix)).toBe(true);
    expect(dataTabCacheKey("tab-1", "1", "orders", 0).startsWith(prefix)).toBe(true);
  });

  it("does not match a different tab's keys", () => {
    const prefix = tabDataPrefix("tab-1");
    expect(dataTabCacheKey("tab-2", "1", "orders").startsWith(prefix)).toBe(false);
  });
});
