import { useEffect } from "react";
import { fontFamilyCssValue, monoFontFamilyCssValue } from "./fonts";
import { activeFontFamilyId, usePreferencesStore } from "./usePreferencesStore";

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const appliedFontFamilyId = usePreferencesStore((s) => s.appliedFontFamilyId);
  const previewFontFamilyId = usePreferencesStore((s) => s.previewFontFamilyId);
  const fontSizePx = usePreferencesStore((s) => s.fontSizePx);
  const fontFamilyId = activeFontFamilyId({ appliedFontFamilyId, previewFontFamilyId });

  useEffect(() => {
    document.documentElement.style.setProperty("--font-family-base", fontFamilyCssValue(fontFamilyId));
    // The code-ish surfaces (payloads, trees, logs) take the same choice with
    // a monospace stack behind it, so the setting reaches the middle and
    // right panels instead of stopping at the app chrome.
    document.documentElement.style.setProperty("--font-family-mono", monoFontFamilyCssValue(fontFamilyId));
  }, [fontFamilyId]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", `${fontSizePx}px`);
  }, [fontSizePx]);

  return <>{children}</>;
}
