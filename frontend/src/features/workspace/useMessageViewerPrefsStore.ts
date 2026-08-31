import { create } from "zustand";

/** The right pane's top-level tabs. */
export type PanelTabId = "headers" | "value";
/** How the Value tab renders the payload. */
export type ValueMode = "text" | "json" | "avro" | "xml";

export interface MessageViewerPrefs {
  panelTab: PanelTabId;
  valueMode: ValueMode;
}

/**
 * A stable default, for the same reason `EMPTY_TAB_MESSAGES` exists — a
 * `?? { ... }` literal in a zustand selector is a new object on every call,
 * which reference equality reads as a state change on every render.
 */
export const DEFAULT_MESSAGE_VIEWER_PREFS: MessageViewerPrefs = { panelTab: "value", valueMode: "text" };

/**
 * Which right-pane tab (Headers/Value) and which Value view mode
 * (Text/JSON/Avro/XML) the user last chose, per top-level tab.
 *
 * `MessagePayloadViewer` is rendered `key={activeTabId}` in `App.tsx`, so it
 * is torn down and rebuilt on every top-level tab switch. Held in its own
 * `useState`, the chosen mode died with it: you'd leave a message being read
 * as JSON, come back, and be looking at raw text again.
 *
 * Kept per tab rather than globally to match the viewed message itself
 * (`useMessageViewerStore.byTab`) — each tab's right pane is independent, so
 * its view mode is too.
 */
interface MessageViewerPrefsState {
  prefsByTab: Record<string, MessageViewerPrefs>;
  setPanelTab: (tabKey: string, panelTab: PanelTabId) => void;
  setValueMode: (tabKey: string, valueMode: ValueMode) => void;
}

export const useMessageViewerPrefsStore = create<MessageViewerPrefsState>((set) => ({
  prefsByTab: {},
  setPanelTab: (tabKey, panelTab) =>
    set((state) => ({
      prefsByTab: {
        ...state.prefsByTab,
        [tabKey]: { ...(state.prefsByTab[tabKey] ?? DEFAULT_MESSAGE_VIEWER_PREFS), panelTab },
      },
    })),
  setValueMode: (tabKey, valueMode) =>
    set((state) => ({
      prefsByTab: {
        ...state.prefsByTab,
        [tabKey]: { ...(state.prefsByTab[tabKey] ?? DEFAULT_MESSAGE_VIEWER_PREFS), valueMode },
      },
    })),
}));
