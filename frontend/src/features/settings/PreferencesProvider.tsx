import { useEffect } from "react";
import { fontFamilyCssValue } from "./fonts";
import { activeFontFamilyId, usePreferencesStore } from "./usePreferencesStore";

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const appliedFontFamilyId = usePreferencesStore((s) => s.appliedFontFamilyId);
  const previewFontFamilyId = usePreferencesStore((s) => s.previewFontFamilyId);
  const fontSizePx = usePreferencesStore((s) => s.fontSizePx);
  const fontFamilyId = activeFontFamilyId({ appliedFontFamilyId, previewFontFamilyId });

  useEffect(() => {
    document.documentElement.style.setProperty("--font-family-base", fontFamilyCssValue(fontFamilyId));
  }, [fontFamilyId]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", `${fontSizePx}px`);
  }, [fontSizePx]);

  return <>{children}</>;
}
