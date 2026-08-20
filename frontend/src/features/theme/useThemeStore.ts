import { create } from "zustand";
import { DEFAULT_THEME_ID } from "./themes";

interface ThemeState {
  appliedThemeId: string;
  setApplied: (id: string) => void;
}

const STORAGE_KEY = "kafkaoxide.theme";

function loadStoredTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

export const useThemeStore = create<ThemeState>((set) => ({
  appliedThemeId: loadStoredTheme(),
  setApplied: (id) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    set({ appliedThemeId: id });
  },
}));
