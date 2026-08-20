import { create } from "zustand";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "./fonts";

interface PreferencesState {
  appliedFontFamilyId: string;
  previewFontFamilyId: string | null;
  fontSizePx: number;
  setAppliedFontFamily: (id: string) => void;
  setPreviewFontFamily: (id: string | null) => void;
  setFontSizePx: (px: number) => void;
}

const STORAGE_KEY = "kafkaoxide.preferences";

interface StoredPreferences {
  fontFamilyId: string;
  fontSizePx: number;
}

export function loadStoredPreferences(): StoredPreferences {
  if (typeof localStorage === "undefined") {
    return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return {
      fontFamilyId: parsed.fontFamilyId ?? DEFAULT_FONT_FAMILY_ID,
      fontSizePx: parsed.fontSizePx ?? DEFAULT_FONT_SIZE_PX,
    };
  } catch {
    return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
  }
}

function persist(patch: Partial<StoredPreferences>) {
  if (typeof localStorage === "undefined") return;
  const current = loadStoredPreferences();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

function clampFontSize(px: number): number {
  return Math.min(Math.max(px, MIN_FONT_SIZE_PX), MAX_FONT_SIZE_PX);
}

const initial = loadStoredPreferences();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  appliedFontFamilyId: initial.fontFamilyId,
  previewFontFamilyId: null,
  fontSizePx: clampFontSize(initial.fontSizePx),
  setAppliedFontFamily: (id) => {
    persist({ fontFamilyId: id });
    set({ appliedFontFamilyId: id, previewFontFamilyId: null });
  },
  setPreviewFontFamily: (id) => set({ previewFontFamilyId: id }),
  setFontSizePx: (px) => {
    const clamped = clampFontSize(px);
    persist({ fontSizePx: clamped });
    set({ fontSizePx: clamped });
  },
}));

export function activeFontFamilyId(
  state: Pick<PreferencesState, "appliedFontFamilyId" | "previewFontFamilyId">,
): string {
  return state.previewFontFamilyId ?? state.appliedFontFamilyId;
}
