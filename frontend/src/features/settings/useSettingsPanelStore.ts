import { create } from "zustand";

interface SettingsPanelState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
