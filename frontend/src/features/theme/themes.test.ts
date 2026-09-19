import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, defaultThemeOfKind, findTheme, THEMES, themeKind, themesOfKind } from "./themes";

describe("themes", () => {
  it("splits every theme into exactly one of light or dark", () => {
    expect([...themesOfKind("light"), ...themesOfKind("dark")]).toHaveLength(THEMES.length);
  });

  it("has a stylesheet-friendly id and a label for each", () => {
    for (const theme of THEMES) {
      expect(theme.id).toMatch(/^[a-z0-9-]+$/);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });

  it("finds a theme by id, and nothing for one that isn't there", () => {
    expect(findTheme(DEFAULT_THEME_ID)?.label).toBe("Zed Dark");
    expect(findTheme("no-such-theme")).toBeUndefined();
  });

  // Every caller of this uses the answer to decide which side of the
  // Light/Dark switch is lit, so an unknown id has to resolve to something
  // rather than to `undefined`.
  it("reports the default's kind for an unknown id", () => {
    expect(themeKind("no-such-theme")).toBe(themeKind(DEFAULT_THEME_ID));
  });

  // Derived from the list rather than hard-coded a second time, so a list
  // that gains a theme at the top or loses the one named can't leave the
  // switch pointing at nothing.
  it("defaults each side to the first theme of that kind", () => {
    expect(defaultThemeOfKind("dark")).toBe(themesOfKind("dark")[0].id);
    expect(defaultThemeOfKind("light")).toBe(themesOfKind("light")[0].id);
  });
});
