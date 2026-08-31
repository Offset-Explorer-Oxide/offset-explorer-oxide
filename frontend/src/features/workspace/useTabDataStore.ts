import { create } from "zustand";
import { TopicMessage } from "../../lib/tauri";

/** The store key for a Data tab rendered before any real top-level tab exists yet. */
export const UNASSIGNED_TAB_KEY = "unassigned";

/**
 * A stable "no messages cached" fallback. A selector like
 * `s.messagesByTab[tabKey] ?? []` would otherwise hand back a fresh array
 * literal on every call, which zustand's reference-equality check reads as
 * "the state changed" on every render — an infinite render loop.
 */
export const EMPTY_TAB_MESSAGES: TopicMessage[] = [];

export function tabDataKey(activeTabId: string | null): string {
  return activeTabId ?? UNASSIGNED_TAB_KEY;
}

/**
 * A Data tab's cache key, scoped by top-level tab AND by what it's showing
 * (connection/topic, and partition when viewing a single partition's Data
 * tab) — without the topic/partition component, switching from one topic
 * (or a topic's Data tab to one of its partitions') to another within the
 * same top-level tab would show the previous topic/partition's stale
 * cached rows until Fetch was clicked again.
 */
export function dataTabCacheKey(
  activeTabId: string | null,
  connectionId: string,
  topicName: string,
  partitionId?: number,
): string {
  return `${tabDataKey(activeTabId)}:${connectionId}:${topicName}:${partitionId ?? "all"}`;
}

/**
 * Whether a `dataTabCacheKey` belongs to a given connection.
 *
 * The key is `<tab>:<connectionId>:<topic>:<partition>`, so the connection is
 * always segment 1 — a topic name containing colons only ever adds segments
 * after it. Shared by every store keyed this way (`useTabDataStore`,
 * `useDataTabFiltersStore`, `useDataTabGridStateStore`) so that "forget this
 * cluster" means the same thing in all of them.
 */
export function dataTabKeyBelongsTo(key: string, connectionId: string): boolean {
  return key.split(":")[1] === connectionId;
}

/**
 * Every `dataTabCacheKey` minted for a given top-level tab shares this
 * prefix, regardless of which connection/topic/partition it's for — lets
 * the bottom panel total up (or clear) everything a tab has cached across
 * every topic it's ever fetched, not just whichever one happens to be
 * selected right now.
 */
export function tabDataPrefix(activeTabId: string | null): string {
  return `${tabDataKey(activeTabId)}:`;
}

interface TabDataState {
  /**
   * Per-tab cache of the Data tab's last-fetched message rows. Without
   * this, the fetched grid lived only in DataTab's local state and was
   * lost whenever the tab was switched away from and back (the middle
   * pane remounts per tab) — this is also what makes the bottom panel's
   * "Tab memory" size estimate meaningful.
   */
  messagesByTab: Record<string, TopicMessage[]>;
  /**
   * How many messages matched the last fetch's filter in total, uncapped by
   * "max messages per partition"/"total max messages" — lets the Data tab
   * show "42 loaded of 150 matching" instead of a bare loaded count, so
   * returning to a tab you've already fetched still shows whether more
   * remained beyond what was loaded. `undefined` means this tab has never
   * been fetched.
   */
  totalMatchingByTab: Record<string, number>;
  /**
   * Payload bytes this tab is currently holding, charged against General
   * settings > Messages > Max Total Fetch Size.
   *
   * The backend enforces that budget within a single Fetch, but a Data tab
   * has a second way of pulling payloads into the same cached rows: the
   * Value column's per-row "Fetch payload" button, which is its own fetch
   * with its own fresh budget. Left uncounted, the setting bounded one route
   * into the webview's memory and left the other unbounded — one click at a
   * time, without limit. This is the running total across both.
   *
   * Counts bytes *read*, matching `MessageFetchResult.payloadBytesRead`, and
   * therefore counts nothing for a fetch made with "Fetch message payload"
   * off — that browse keeps no payloads.
   */
  payloadBytesByTab: Record<string, number>;
  /**
   * When each view was last fetched into or looked at, for eviction order.
   *
   * The ceiling is app-wide but the memory belongs to individual views, so
   * something has to decide which one gives it up. Least-recently-used is the
   * right answer here because every evicted view is re-fetchable: the cost of
   * a wrong guess is one round trip, and the view the user is actually
   * working in is the one they touched most recently.
   */
  lastUsedByTab: Record<string, number>;
  /**
   * Views whose rows were dropped to stay under the ceiling, so the Data tab
   * can say so instead of quietly showing an empty grid where fetched
   * messages used to be. Cleared when the view is fetched again.
   */
  evictedTabs: Record<string, true>;
  setTabMessages: (tabId: string, messages: TopicMessage[]) => void;
  /** Replaces a tab's payload-byte total — what a completed Fetch reports, which supersedes rather than adds to whatever the previous fetch left. */
  setTabPayloadBytes: (tabId: string, bytes: number) => void;
  /** Adds to a tab's payload-byte total — one per-row "Fetch payload" click, which retains bytes on top of what the last Fetch already did. */
  addTabPayloadBytes: (tabId: string, bytes: number) => void;
  /** Records the last Fetch's total-matching count separately from the row cache — a single-row payload patch (`fetchPayloadForRow`) replaces a tab's cached rows without knowing (or wanting to overwrite) the total the original Fetch found. */
  setTabTotalMatching: (tabId: string, totalMatching: number) => void;
  /** Appends one streamed message onto a tab's rows — backs the Data tab's live-streaming Fetch, which paints rows in as they arrive instead of waiting for the whole fetch to finish. */
  appendTabMessage: (tabId: string, message: TopicMessage) => void;
  /**
   * Appends a batch of streamed messages in one update.
   *
   * The Data tab buffers arrivals and flushes them on a timer rather than
   * calling `appendTabMessage` per message: every call here rebuilds the tab's
   * array and re-renders the grid, so one-at-a-time is quadratic in both.
   * Measured over 20,000 streamed messages: 20,000 store updates and ~1.15s of
   * copying, against 100 updates and ~11ms batched.
   */
  appendTabMessages: (tabId: string, messages: TopicMessage[]) => void;
  clearTabMessages: (tabId: string) => void;
  /** Clears every entry cached under a tab's prefix (every topic/partition it's ever fetched), not just one exact key — backs the bottom panel's "Clear memory", which now clears the full total it displays. */
  clearAllMessagesForTab: (activeTabId: string | null) => void;
  /**
   * Drops every row this connection has cached, in every tab and for every
   * topic and partition of it. Called when the cluster disconnects: those
   * rows are a snapshot of a cluster the app is no longer talking to, and
   * they are the bulk of what the app holds for it.
   */
  clearForConnection: (connectionId: string) => void;
  /** Records that a view is being used, so eviction picks the coldest one rather than this one. */
  touchTab: (tabId: string) => void;
  /**
   * Drops cached rows, least-recently-used first, until the app-wide retained
   * total fits inside `limitBytes`. Returns the keys it dropped.
   *
   * `protectedTabId` is never evicted: it is the view whose fetch just ran,
   * and evicting it would mean a fetch discarding its own results the instant
   * they arrived. If it alone exceeds the limit, this stops with the total
   * still over — the Data tab says so rather than the app looping forever
   * trying to free memory that only the user can (by lowering the fetch caps
   * or raising the setting).
   *
   * Only the rows go. The view's filter form, sort, column filters and search
   * box are the user's working context, cost nothing to keep, and would be
   * infuriating to lose to a background eviction — so they stay, and a
   * re-Fetch reproduces exactly what was there.
   */
  evictToFit: (limitBytes: number, protectedTabId: string) => string[];
}

/** The app-wide retained payload total — the number the ceiling is actually about, since every tab shares one webview process. */
export function totalRetainedPayloadBytes(payloadBytesByTab: Record<string, number>): number {
  return Object.values(payloadBytesByTab).reduce((total, bytes) => total + bytes, 0);
}

export const useTabDataStore = create<TabDataState>((set) => ({
  messagesByTab: {},
  totalMatchingByTab: {},
  payloadBytesByTab: {},
  lastUsedByTab: {},
  evictedTabs: {},
  setTabMessages: (tabId, messages) =>
    set((state) => ({
      messagesByTab: { ...state.messagesByTab, [tabId]: messages },
      lastUsedByTab: { ...state.lastUsedByTab, [tabId]: Date.now() },
    })),
  setTabPayloadBytes: (tabId, bytes) =>
    set((state) => ({ payloadBytesByTab: { ...state.payloadBytesByTab, [tabId]: bytes } })),
  addTabPayloadBytes: (tabId, bytes) =>
    set((state) => ({
      payloadBytesByTab: { ...state.payloadBytesByTab, [tabId]: (state.payloadBytesByTab[tabId] ?? 0) + bytes },
    })),
  setTabTotalMatching: (tabId, totalMatching) =>
    set((state) => ({ totalMatchingByTab: { ...state.totalMatchingByTab, [tabId]: totalMatching } })),
  appendTabMessage: (tabId, message) =>
    set((state) => ({
      messagesByTab: { ...state.messagesByTab, [tabId]: [...(state.messagesByTab[tabId] ?? []), message] },
    })),
  appendTabMessages: (tabId, messages) =>
    set((state) =>
      messages.length === 0
        ? state
        : {
            messagesByTab: {
              ...state.messagesByTab,
              [tabId]: [...(state.messagesByTab[tabId] ?? []), ...messages],
            },
            lastUsedByTab: { ...state.lastUsedByTab, [tabId]: Date.now() },
          },
    ),
  clearTabMessages: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.messagesByTab;
      const { [tabId]: _removedTotal, ...restTotal } = state.totalMatchingByTab;
      // The byte total describes the rows being dropped, so it goes with
      // them — otherwise a re-Fetch started against a budget already spent
      // by the fetch it is replacing.
      const { [tabId]: _removedBytes, ...restBytes } = state.payloadBytesByTab;
      const { [tabId]: _removedUsed, ...restUsed } = state.lastUsedByTab;
      // A view being fetched into again is no longer a view whose rows went
      // missing, so the eviction notice goes with the rows it described.
      const { [tabId]: _removedEvicted, ...restEvicted } = state.evictedTabs;
      return {
        messagesByTab: rest,
        totalMatchingByTab: restTotal,
        payloadBytesByTab: restBytes,
        lastUsedByTab: restUsed,
        evictedTabs: restEvicted,
      };
    }),
  clearAllMessagesForTab: (activeTabId) =>
    set((state) => {
      const prefix = tabDataPrefix(activeTabId);
      const messagesByTab = Object.fromEntries(
        Object.entries(state.messagesByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      const totalMatchingByTab = Object.fromEntries(
        Object.entries(state.totalMatchingByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      const payloadBytesByTab = Object.fromEntries(
        Object.entries(state.payloadBytesByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      const lastUsedByTab = Object.fromEntries(
        Object.entries(state.lastUsedByTab).filter(([key]) => !key.startsWith(prefix)),
      );
      const evictedTabs = Object.fromEntries(
        Object.entries(state.evictedTabs).filter(([key]) => !key.startsWith(prefix)),
      );
      return { messagesByTab, totalMatchingByTab, payloadBytesByTab, lastUsedByTab, evictedTabs };
    }),
  clearForConnection: (connectionId) =>
    set((state) => {
      const keep = <T,>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => !dataTabKeyBelongsTo(key, connectionId)));
      return {
        messagesByTab: keep(state.messagesByTab),
        totalMatchingByTab: keep(state.totalMatchingByTab),
        payloadBytesByTab: keep(state.payloadBytesByTab),
        lastUsedByTab: keep(state.lastUsedByTab),
        evictedTabs: keep(state.evictedTabs),
      };
    }),
  touchTab: (tabId) => set((state) => ({ lastUsedByTab: { ...state.lastUsedByTab, [tabId]: Date.now() } })),
  evictToFit: (limitBytes, protectedTabId) => {
    const evicted: string[] = [];
    set((state) => {
      const payloadBytesByTab = { ...state.payloadBytesByTab };
      const messagesByTab = { ...state.messagesByTab };
      const totalMatchingByTab = { ...state.totalMatchingByTab };
      const lastUsedByTab = { ...state.lastUsedByTab };
      const evictedTabs = { ...state.evictedTabs };

      while (totalRetainedPayloadBytes(payloadBytesByTab) > limitBytes) {
        // The coldest view still holding something. Views with nothing
        // cached are skipped: evicting them frees no memory, and without
        // this the loop would "evict" them forever without the total moving.
        const coldest = Object.keys(payloadBytesByTab)
          .filter((key) => key !== protectedTabId && (payloadBytesByTab[key] ?? 0) > 0)
          .sort((a, b) => (lastUsedByTab[a] ?? 0) - (lastUsedByTab[b] ?? 0))[0];
        // Nothing left to give up — the protected view alone is over the
        // limit. Its caller reports that; looping here would not free a byte.
        if (coldest === undefined) break;

        delete payloadBytesByTab[coldest];
        delete messagesByTab[coldest];
        delete totalMatchingByTab[coldest];
        delete lastUsedByTab[coldest];
        evictedTabs[coldest] = true;
        evicted.push(coldest);
      }

      return evicted.length === 0
        ? state
        : { messagesByTab, totalMatchingByTab, payloadBytesByTab, lastUsedByTab, evictedTabs };
    });
    return evicted;
  },
}));
