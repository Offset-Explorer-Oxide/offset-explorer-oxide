import { create } from "zustand";
import { TopicMessage } from "../../lib/tauri";

interface ViewedMessage {
  message: TopicMessage;
  connectionId: string;
  topic: string;
}

interface MessageViewerState {
  /** The active tab's viewed message — kept in sync with `byTab[activeTabId]` by `setActiveTab`. */
  message: TopicMessage | null;
  /** The connection/topic the viewed message came from — needed to decode it (e.g. Avro) on demand. */
  connectionId: string | null;
  topic: string | null;
  activeTabId: string | null;
  /** Per-tab cache, so each tab's right pane stays independent. */
  byTab: Record<string, ViewedMessage | null>;
  /** Called whenever the active tab changes, so writes below land in the right tab's slot. */
  setActiveTab: (tabId: string | null) => void;
  viewMessage: (message: TopicMessage, connectionId: string, topic: string) => void;
  clear: () => void;
  /** Resets a tab's cached message back to blank — the Bottom panel's "Clear memory" button. Defaults to the active tab. */
  clearTabMemory: (tabId?: string) => void;
  /** Clears this connection's viewed message from every tab — called after a connection is deleted, so the right pane can't keep showing a message from a connection that no longer exists. */
  clearForConnection: (connectionId: string) => void;
}

/** Drives the right pane's payload viewer — set when a row is clicked in the topic Data tab's grid. */
export const useMessageViewerStore = create<MessageViewerState>((set, get) => {
  function write(viewed: ViewedMessage | null) {
    const tabId = get().activeTabId;
    set((state) => ({
      message: viewed?.message ?? null,
      connectionId: viewed?.connectionId ?? null,
      topic: viewed?.topic ?? null,
      byTab: tabId ? { ...state.byTab, [tabId]: viewed } : state.byTab,
    }));
  }

  return {
    message: null,
    connectionId: null,
    topic: null,
    activeTabId: null,
    byTab: {},
    setActiveTab: (tabId) => {
      const viewed = (tabId ? get().byTab[tabId] : null) ?? null;
      set({
        activeTabId: tabId,
        message: viewed?.message ?? null,
        connectionId: viewed?.connectionId ?? null,
        topic: viewed?.topic ?? null,
      });
    },
    viewMessage: (message, connectionId, topic) => write({ message, connectionId, topic }),
    clear: () => write(null),
    clearTabMemory: (tabId) => {
      const target = tabId ?? get().activeTabId;
      if (!target) return;
      set((state) => ({
        byTab: { ...state.byTab, [target]: null },
        message: state.activeTabId === target ? null : state.message,
        connectionId: state.activeTabId === target ? null : state.connectionId,
        topic: state.activeTabId === target ? null : state.topic,
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
        };
      });
    },
  };
});
