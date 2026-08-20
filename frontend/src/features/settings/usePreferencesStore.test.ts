import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore, activeFontFamilyId, loadStoredPreferences } from "./usePreferencesStore";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX } from "./fonts";

const STORAGE_KEY = "kafkaoxide.preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferencesStore.setState({
    appliedFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    previewFontFamilyId: null,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
  });
});

describe("usePreferencesStore", () => {
  it("defaults to system-ui at 13px when nothing is stored", () => {
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
    expect(usePreferencesStore.getState().fontSizePx).toBe(DEFAULT_FONT_SIZE_PX);
  });

  it("previews a font family without committing it", () => {
    usePreferencesStore.getState().setPreviewFontFamily("inter");
    expect(activeFontFamilyId(usePreferencesStore.getState())).toBe("inter");
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("reverts to the applied family when preview is cleared", () => {
    usePreferencesStore.getState().setPreviewFontFamily("inter");
    usePreferencesStore.getState().setPreviewFontFamily(null);
    expect(activeFontFamilyId(usePreferencesStore.getState())).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("commits a font family and persists it to localStorage", () => {
    usePreferencesStore.getState().setAppliedFontFamily("jetbrains-mono");

    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe("jetbrains-mono");
    expect(usePreferencesStore.getState().previewFontFamilyId).toBeNull();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.fontFamilyId).toBe("jetbrains-mono");
  });

  it("commits a font size and persists it to localStorage", () => {
    usePreferencesStore.getState().setFontSizePx(16);

    expect(usePreferencesStore.getState().fontSizePx).toBe(16);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.fontSizePx).toBe(16);
  });

  it("reads persisted preferences via the store's storage-read helper", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontFamilyId: "menlo", fontSizePx: 15 }));

    expect(loadStoredPreferences()).toEqual({ fontFamilyId: "menlo", fontSizePx: 15 });
  });
});
