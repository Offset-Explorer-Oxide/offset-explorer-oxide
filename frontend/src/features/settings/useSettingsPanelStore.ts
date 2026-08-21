import { create } from "zustand";
import { useTabsStore } from "../tabs/useTabsStore";

/** Fixed id for the single Settings tab — unlike JSON/XML viewer tabs, there's never more than one open at once. */
export const SETTINGS_TAB_ID = "settings";

interface SettingsPanelState {
  /** Whether the Settings tab currently exists in the tab bar — open, whether or not it's the *active* tab (that's `activeTabId === SETTINGS_TAB_ID`). Mirrors useJsonViewerTabsStore's `tabs` array, just for a single fixed-id tab instead of an array. */
  isOpen: boolean;
  /** Opens (if not already) and activates the Settings tab — it then behaves like a JSON/XML viewer tab: switching to another tab leaves it open in the tab bar rather than closing it, and clicking it again reactivates it. */
  open: () => void;
  /** Removes the Settings tab from the tab bar. Doesn't decide what becomes active next — the caller (TabBar) falls back the same way it does for a closed JSON tab. */
  close: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
    useTabsStore.getState().selectTab(SETTINGS_TAB_ID);
  },
  close: () => set({ isOpen: false }),
}));
