import { create } from "zustand";
import { api, Tab } from "../../lib/tauri";
import { useTabOrderStore } from "./useTabOrderStore";

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  error: string | null;
  loadTabs: () => Promise<void>;
  addTab: (name: string) => Promise<void>;
  renameTab: (id: string, name: string) => Promise<void>;
  deleteTab: (id: string) => Promise<void>;
  selectTab: (id: string) => void;
  /** Local-only, live reorder while dragging a tab — moves `draggedId` to sit where `overId` currently is. */
  moveTab: (draggedId: string, overId: string) => void;
  /** Persists the current `tabs` order (call once, on drag end). */
  commitTabOrder: () => Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  error: null,
  loadTabs: async () => {
    try {
      let tabs = await api.listTabs();
      // A fresh install (or a user who's closed every tab) should never land
      // on an empty tab bar with no way to open a connection into anything —
      // always guarantee at least one tab exists.
      if (tabs.length === 0) {
        tabs = [await api.createTab("Tab 1")];
      }
      for (const tab of tabs) {
        useTabOrderStore.getState().registerRoot(tab.id);
      }
      set({
        tabs,
        activeTabId: get().activeTabId ?? tabs[0]?.id ?? null,
        error: null,
      });
    } catch (err) {
      set({ error: errorMessage(err, "Failed to load tabs") });
    }
  },
  addTab: async (name: string) => {
    const activeBefore = get().activeTabId;
    try {
      const tab = await api.createTab(name);
      useTabOrderStore.getState().registerAfter(tab.id, activeBefore);
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, error: null }));
    } catch (err) {
      set({ error: errorMessage(err, "Failed to create tab") });
    }
  },
  renameTab: async (id: string, name: string) => {
    try {
      await api.renameTab(id, name);
      set((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab)),
        error: null,
      }));
    } catch (err) {
      set({ error: errorMessage(err, "Failed to rename tab") });
    }
  },
  deleteTab: async (id: string) => {
    try {
      await api.deleteTab(id);
      useTabOrderStore.getState().remove(id);
      set((state) => {
        const tabs = state.tabs.filter((tab) => tab.id !== id);
        if (state.activeTabId !== id) {
          return { tabs, error: null };
        }
        const closedIndex = state.tabs.findIndex((tab) => tab.id === id);
        const fallback = state.tabs[closedIndex - 1] ?? state.tabs[closedIndex + 1] ?? null;
        return { tabs, activeTabId: fallback?.id ?? null, error: null };
      });
    } catch (err) {
      set({ error: errorMessage(err, "Failed to delete tab") });
    }
  },
  selectTab: (id: string) => set({ activeTabId: id }),
  moveTab: (draggedId: string, overId: string) => {
    if (draggedId === overId) return;
    set((state) => {
      const fromIndex = state.tabs.findIndex((tab) => tab.id === draggedId);
      const toIndex = state.tabs.findIndex((tab) => tab.id === overId);
      if (fromIndex === -1 || toIndex === -1) return state;
      const tabs = [...state.tabs];
      const [dragged] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, dragged);
      return { tabs };
    });
  },
  commitTabOrder: async () => {
    try {
      await api.reorderTabs(get().tabs.map((tab) => tab.id));
    } catch (err) {
      set({ error: errorMessage(err, "Failed to save tab order") });
    }
  },
}));
