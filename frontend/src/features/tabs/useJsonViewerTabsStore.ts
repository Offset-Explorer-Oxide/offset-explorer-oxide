import { create } from "zustand";
import { useTabOrderStore } from "./useTabOrderStore";
import { useTabsStore } from "./useTabsStore";

export type JsonViewerTabKind = "json" | "xml";

export interface JsonViewerTab {
  id: string;
  /** Descriptive header text shown in the panel, e.g. "Partition 2 · Offset 7" — never changes. */
  title: string;
  /** Short, user-renamable label shown in the tab strip — defaults to "Json"/"Xml". */
  name: string;
  kind: JsonViewerTabKind;
  value: unknown;
}

interface JsonViewerTabsState {
  tabs: JsonViewerTab[];
  /** Creates a new ephemeral viewer tab and returns its id — doesn't activate it, callers do that via useTabsStore.selectTab. */
  openTab: (title: string, value: unknown, kind?: JsonViewerTabKind) => string;
  closeTab: (id: string) => void;
  /** Renames the tab strip's short label — the panel header (title) is unaffected. */
  renameTab: (id: string, name: string) => void;
}

function generateId(): string {
  return `json-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultName(kind: JsonViewerTabKind): string {
  return kind === "xml" ? "Xml" : "Json";
}

/**
 * "Open in new tab" on a JSON/XML value opens it as a tab in the app's own
 * tab bar (there's no browser to open a real new tab in — this is a desktop
 * webview). These tabs are local-only, ephemeral scratch views — unlike
 * useTabsStore's tabs, they're never persisted to the backend, so a
 * "Fetch payload" click doesn't need a delete/rename/reorder round trip
 * for something meant to be glanced at and closed.
 */
export const useJsonViewerTabsStore = create<JsonViewerTabsState>((set) => ({
  tabs: [],
  openTab: (title, value, kind = "json") => {
    const id = generateId();
    useTabOrderStore.getState().registerAfter(id, useTabsStore.getState().activeTabId);
    set((state) => ({ tabs: [...state.tabs, { id, title, value, kind, name: defaultName(kind) }] }));
    return id;
  },
  closeTab: (id) => {
    useTabOrderStore.getState().remove(id);
    set((state) => ({ tabs: state.tabs.filter((tab) => tab.id !== id) }));
  },
  renameTab: (id, name) => {
    set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab)) }));
  },
}));
