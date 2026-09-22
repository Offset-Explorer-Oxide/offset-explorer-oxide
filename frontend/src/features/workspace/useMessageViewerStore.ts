import { create } from "zustand";
import { TopicMessage } from "../../lib/tauri";

interface ViewedMessage {
  message: TopicMessage;
  connectionId: string;
  topic: string;
  /** The Data tab's partition scope the message was viewed from — `undefined` for a topic-wide Data tab, a partition id for one of its partitions'. Lets a consumer tell "still the same topic-wide Data tab" apart from "moved to (or away from) one of its partitions' Data tab", which share the same `topic`. */
  partitionId?: number;
  /**
   * The whole payload, once it has been fetched.
   *
   * A Data tab row carries a bounded preview (or, with "Fetch message
   * payload" off, none at all), so opening such a message costs one
   * single-message fetch. The result belongs here rather than in the query
   * cache: `MessagePayloadViewer` is rendered `key={activeTabId}`, so every
   * top-level tab switch unmounts it, and the query it owned was dropped with
   * it — which meant going to another tab and back re-fetched the same
   * payload off the broker every time. Held per tab, it is still dropped by
   * "Clear memory" and when the connection goes away.
   */
  fullPayloadBase64?: string;
}

interface MessageViewerState {
  /** The active tab's viewed message — kept in sync with `byTab[activeTabId]` by `setActiveTab`. */
  message: TopicMessage | null;
  /** The connection/topic the viewed message came from — needed to decode it (e.g. Avro) on demand. */
  connectionId: string | null;
  topic: string | null;
  partitionId: number | undefined;
  /** The active tab's fetched full payload, if one has been fetched. */
  fullPayloadBase64: string | undefined;
  activeTabId: string | null;
  /** Per-tab cache, so each tab's right pane stays independent. */
  byTab: Record<string, ViewedMessage | null>;
  /** Called whenever the active tab changes, so writes below land in the right tab's slot. */
  setActiveTab: (tabId: string | null) => void;
  viewMessage: (message: TopicMessage, connectionId: string, topic: string, partitionId?: number) => void;
  /** Remembers a payload the viewer had to fetch, so returning to this tab does not fetch it again. */
  setFullPayload: (payloadBase64: string) => void;
  clear: () => void;
  /** Resets a tab's cached message back to blank — the Bottom panel's "Clear memory" button. Defaults to the active tab. */
  clearTabMemory: (tabId?: string) => void;
  /** Clears this connection's viewed message from every tab — called after a connection is deleted, so the right pane can't keep showing a message from a connection that no longer exists. */
  clearForConnection: (connectionId: string) => void;
}

/** Backs the right pane's payload viewer — set when a row is clicked in the topic Data tab's grid. */
export const useMessageViewerStore = create<MessageViewerState>((set, get) => {
  function write(viewed: ViewedMessage | null) {
    const tabId = get().activeTabId;
    set((state) => ({
      message: viewed?.message ?? null,
      connectionId: viewed?.connectionId ?? null,
      topic: viewed?.topic ?? null,
      partitionId: viewed?.partitionId,
      fullPayloadBase64: viewed?.fullPayloadBase64,
      byTab: tabId ? { ...state.byTab, [tabId]: viewed } : state.byTab,
    }));
  }

  return {
    message: null,
    connectionId: null,
    topic: null,
    partitionId: undefined,
    fullPayloadBase64: undefined,
    activeTabId: null,
    byTab: {},
    setActiveTab: (tabId) => {
      const viewed = (tabId ? get().byTab[tabId] : null) ?? null;
      set({
        activeTabId: tabId,
        message: viewed?.message ?? null,
        connectionId: viewed?.connectionId ?? null,
        topic: viewed?.topic ?? null,
        partitionId: viewed?.partitionId,
        fullPayloadBase64: viewed?.fullPayloadBase64,
      });
    },
    viewMessage: (message, connectionId, topic, partitionId) => write({ message, connectionId, topic, partitionId }),
    clear: () => write(null),
    setFullPayload: (payloadBase64) => {
      const tabId = get().activeTabId;
      const viewed = tabId ? get().byTab[tabId] : null;
      // Only ever attached to the message that is actually on screen: by the
      // time a fetch lands the reader may have clicked a different row, and
      // hanging its payload off that one would show the wrong bytes.
      if (!tabId || !viewed) return;
      write({ ...viewed, fullPayloadBase64: payloadBase64 });
    },
    clearTabMemory: (tabId) => {
      const target = tabId ?? get().activeTabId;
      if (!target) return;
      set((state) => ({
        byTab: { ...state.byTab, [target]: null },
        message: state.activeTabId === target ? null : state.message,
        connectionId: state.activeTabId === target ? null : state.connectionId,
        topic: state.activeTabId === target ? null : state.topic,
        partitionId: state.activeTabId === target ? undefined : state.partitionId,
        fullPayloadBase64: state.activeTabId === target ? undefined : state.fullPayloadBase64,
      }));
    },
    clearForConnection: (connectionId) => {
      set((state) => {
        const byTab = { ...state.byTab };
        for (const tabId of Object.keys(byTab)) {
          if (byTab[tabId]?.connectionId === connectionId) {
            byTab[tabId] = null;
          }
        }
        const activeBelongs = state.connectionId === connectionId;
        return {
          byTab,
          message: activeBelongs ? null : state.message,
          connectionId: activeBelongs ? null : state.connectionId,
          topic: activeBelongs ? null : state.topic,
          partitionId: activeBelongs ? undefined : state.partitionId,
          fullPayloadBase64: activeBelongs ? undefined : state.fullPayloadBase64,
        };
      });
    },
  };
});
