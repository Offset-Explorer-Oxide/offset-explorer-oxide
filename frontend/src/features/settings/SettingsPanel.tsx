import { THEMES } from "../theme/themes";
import { useThemeStore } from "../theme/useThemeStore";
import { FONT_FAMILIES, FONT_SIZE_OPTIONS_PX } from "./fonts";
import { Dropdown } from "../../components/Dropdown";
import { activeFontFamilyId, usePreferencesStore } from "./usePreferencesStore";

const THEME_OPTIONS = THEMES.map((theme) => ({ id: theme.id, label: theme.label }));
const FONT_FAMILY_OPTIONS = FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label }));
const FONT_SIZE_OPTIONS = FONT_SIZE_OPTIONS_PX.map((px) => ({ id: String(px), label: `${px}px` }));

export function SettingsPanel() {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const setAppliedTheme = useThemeStore((s) => s.setApplied);

  const appliedFontFamilyId = usePreferencesStore((s) => s.appliedFontFamilyId);
  const previewFontFamilyId = usePreferencesStore((s) => s.previewFontFamilyId);
  const setPreviewFontFamily = usePreferencesStore((s) => s.setPreviewFontFamily);
  const setAppliedFontFamily = usePreferencesStore((s) => s.setAppliedFontFamily);
  const fontSizePx = usePreferencesStore((s) => s.fontSizePx);
  const setFontSizePx = usePreferencesStore((s) => s.setFontSizePx);

  const displayedFontFamilyId = activeFontFamilyId({ appliedFontFamilyId, previewFontFamilyId });

  return (
    <div className="settings-panel">
      <h2>Settings</h2>

      <Dropdown
        label="Theme"
        ariaLabel="Theme"
        options={THEME_OPTIONS}
        displayedId={appliedThemeId}
        appliedId={appliedThemeId}
        onCommit={setAppliedTheme}
      />

      <Dropdown
        label="Font style"
        ariaLabel="Font style"
        options={FONT_FAMILY_OPTIONS}
        displayedId={displayedFontFamilyId}
        appliedId={appliedFontFamilyId}
        onCommit={setAppliedFontFamily}
        onPreview={setPreviewFontFamily}
      />

      <Dropdown
        label="Font size"
        ariaLabel="Font size"
        options={FONT_SIZE_OPTIONS}
        displayedId={String(fontSizePx)}
        appliedId={String(fontSizePx)}
        onCommit={(id) => setFontSizePx(Number(id))}
      />
    </div>
  );
}
