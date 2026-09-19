import { create } from "zustand";

/** The right pane's top-level tabs. */
export type PanelTabId = "headers" | "value";
/**
 * How the Value tab renders the payload.
 *
 * Split into two groups by the format dropdown: the *structured* readings of
 * a payload (JSON/XML/Avro), which can fail — the bytes have to actually be
 * that format — and the three *literal* renderings (Raw/Hex/Base64), which
 * always work because they describe the bytes themselves. The dropdown keeps
 * them in that order with a rule between them; see `VALUE_FORMATS`.
 */
export type ValueMode = "json" | "xml" | "avro" | "protobuf" | "raw" | "hex" | "base64";

/** Where the message payload viewer sits relative to the middle pane. */
export type ViewerPlacement = "right" | "bottom";

export interface MessageViewerPrefs {
  panelTab: PanelTabId;
  valueMode: ValueMode;
}

const STORAGE_KEY = "kafkaoxide.message-viewer-prefs";

interface StoredPrefs {
  valueMode?: ValueMode;
  placement?: ViewerPlacement;
}

/**
 * Every value the stored format may take.
 *
 * Exported so a test can pin it against the dropdown's own `VALUE_FORMATS`.
 * The two lists are separate — this one guards what comes back out of
 * localStorage, that one drives the menu — and a format present in the menu
 * but missing here would be choosable and then silently reset to Raw on the
 * next run, which reads as "my choice doesn't stick" rather than as a typo in
 * an array.
 */
export const VALUE_MODES: ValueMode[] = ["json", "xml", "avro", "protobuf", "raw", "hex", "base64"];

function readStored(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredPrefs) : {};
    // Anything not in the current enum is dropped rather than trusted: the
    // value in storage was written by whatever version of the app the user
    // last ran, and "text" (this list's name for "raw" before the dropdown
    // replaced the button row) would otherwise match no view and render a
    // blank pane.
    return {
      valueMode: parsed.valueMode && VALUE_MODES.includes(parsed.valueMode) ? parsed.valueMode : undefined,
      placement: parsed.placement === "bottom" || parsed.placement === "right" ? parsed.placement : undefined,
    };
  } catch {
    return {};
  }
}

function persist(patch: StoredPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), ...patch }));
  } catch {
    // localStorage unavailable — the preference still applies for this run.
  }
}

/**
 * A stable default, for the same reason `EMPTY_TAB_MESSAGES` exists — a
 * `?? { ... }` literal in a zustand selector is a new object on every call,
 * which reference equality reads as a state change on every render.
 *
 * Rebuilt once at module load from the persisted format so a tab that has
 * never been touched opens in the format the user last chose, not in Raw.
 */
export const DEFAULT_MESSAGE_VIEWER_PREFS: MessageViewerPrefs = {
  panelTab: "value",
  valueMode: readStored().valueMode ?? "raw",
};

/**
 * Which right-pane tab (Headers/Value) and which Value format the user last
 * chose, per top-level tab — plus where the pane itself sits.
 *
 * `MessagePayloadViewer` is rendered `key={activeTabId}` in `App.tsx`, so it
 * is torn down and rebuilt on every top-level tab switch. Held in its own
 * `useState`, the chosen format died with it: you'd leave a message being
 * read as JSON, come back, and be looking at raw text again.
 *
 * Kept per tab rather than globally to match the viewed message itself
 * (`useMessageViewerStore.byTab`) — each tab's right pane is independent, so
 * its format is too. The *last* format chosen is nevertheless written to
 * localStorage and becomes the default for tabs that haven't chosen one and
 * for the next run of the app, so "always show me JSON" is a decision the
 * user makes once rather than per tab, per session.
 *
 * `placement` is deliberately app-wide rather than per tab: it changes the
 * shape of the whole window, and a layout that rearranged itself on every
 * tab switch would read as the app losing track of itself.
 */
export interface MessageViewerPrefsState {
  prefsByTab: Record<string, MessageViewerPrefs>;
  /** The format any tab without an explicit choice opens in — the last one chosen anywhere, restored from localStorage. */
  defaultValueMode: ValueMode;
  placement: ViewerPlacement;
  setPanelTab: (tabKey: string, panelTab: PanelTabId) => void;
  setValueMode: (tabKey: string, valueMode: ValueMode) => void;
  setPlacement: (placement: ViewerPlacement) => void;
  togglePlacement: () => void;
}

export const useMessageViewerPrefsStore = create<MessageViewerPrefsState>((set, get) => ({
  prefsByTab: {},
  defaultValueMode: DEFAULT_MESSAGE_VIEWER_PREFS.valueMode,
  placement: readStored().placement ?? "right",
  setPanelTab: (tabKey, panelTab) =>
    set((state) => ({
      prefsByTab: {
        ...state.prefsByTab,
        [tabKey]: { ...(state.prefsByTab[tabKey] ?? defaultsFor(state)), panelTab },
      },
    })),
  setValueMode: (tabKey, valueMode) => {
    persist({ valueMode });
    set((state) => ({
      defaultValueMode: valueMode,
      prefsByTab: {
        ...state.prefsByTab,
        [tabKey]: { ...(state.prefsByTab[tabKey] ?? defaultsFor(state)), valueMode },
      },
    }));
  },
  setPlacement: (placement) => {
    persist({ placement });
    set({ placement });
  },
  togglePlacement: () => get().setPlacement(get().placement === "right" ? "bottom" : "right"),
}));

function defaultsFor(state: Pick<MessageViewerPrefsState, "defaultValueMode">): MessageViewerPrefs {
  return { panelTab: DEFAULT_MESSAGE_VIEWER_PREFS.panelTab, valueMode: state.defaultValueMode };
}

/**
 * The prefs a given tab is showing under — its own if it has made a choice,
 * otherwise the app-wide default format.
 *
 * A selector rather than a `??` at each call site because the fallback is no
 * longer a constant: it tracks `defaultValueMode`, so a component reading it
 * has to subscribe to that too or it will keep rendering a stale format. The
 * fallback objects are cached per format for the reason
 * `DEFAULT_MESSAGE_VIEWER_PREFS` exists — a fresh literal every call is a new
 * reference, which zustand's reference equality reads as a state change on
 * every render.
 */
const defaultsCache = new Map<ValueMode, MessageViewerPrefs>();

export function selectTabPrefs(state: MessageViewerPrefsState, tabKey: string): MessageViewerPrefs {
  const own = state.prefsByTab[tabKey];
  if (own) return own;
  const cached = defaultsCache.get(state.defaultValueMode);
  if (cached) return cached;
  const fresh = defaultsFor(state);
  defaultsCache.set(state.defaultValueMode, fresh);
  return fresh;
}
