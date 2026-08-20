import { beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { PreferencesProvider } from "./PreferencesProvider";
import { usePreferencesStore } from "./usePreferencesStore";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX, fontFamilyCssValue } from "./fonts";

beforeEach(() => {
  localStorage.clear();
  usePreferencesStore.setState({
    appliedFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    previewFontFamilyId: null,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
  });
  document.documentElement.style.removeProperty("--font-family-base");
  document.documentElement.style.removeProperty("--font-size-base");
});

describe("PreferencesProvider", () => {
  it("applies the applied font family and size as CSS variables on mount", () => {
    render(
      <PreferencesProvider>
        <div>content</div>
      </PreferencesProvider>,
    );

    expect(document.documentElement.style.getPropertyValue("--font-family-base")).toBe(
      fontFamilyCssValue(DEFAULT_FONT_FAMILY_ID),
    );
    expect(document.documentElement.style.getPropertyValue("--font-size-base")).toBe(
      `${DEFAULT_FONT_SIZE_PX}px`,
    );
  });

  it("reacts to store updates after mount", () => {
    render(
      <PreferencesProvider>
        <div>content</div>
      </PreferencesProvider>,
    );

    act(() => {
      usePreferencesStore.getState().setFontSizePx(16);
    });

    expect(document.documentElement.style.getPropertyValue("--font-size-base")).toBe("16px");
  });
});
