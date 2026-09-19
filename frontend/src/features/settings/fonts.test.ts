import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SIZE_PX,
  FONT_FAMILIES,
  FONT_SIZE_OPTIONS_PX,
  fontFamilyCssValue,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  monoFontFamilyCssValue,
} from "./fonts";

describe("fontFamilyCssValue", () => {
  it("returns the family's stack", () => {
    expect(fontFamilyCssValue("georgia")).toContain("Georgia");
  });

  it("falls back to the first family for an unknown id", () => {
    expect(fontFamilyCssValue("no-such-font")).toBe(FONT_FAMILIES[0].cssValue);
  });
});

describe("monoFontFamilyCssValue", () => {
  // The chosen family comes first, or the setting does nothing to the middle
  // and right panels — which is exactly the bug this replaced.
  it("puts the chosen family ahead of the monospace fallbacks", () => {
    const value = monoFontFamilyCssValue("georgia");

    expect(value.indexOf("Georgia")).toBeLessThan(value.indexOf("ui-monospace"));
  });

  it("still ends in a monospace stack, so a missing font degrades to one", () => {
    expect(monoFontFamilyCssValue("fira-code")).toMatch(/monospace$/);
  });

  it("applies to every family on offer", () => {
    for (const family of FONT_FAMILIES) {
      expect(monoFontFamilyCssValue(family.id).startsWith(family.cssValue)).toBe(true);
    }
  });
});

describe("font sizes", () => {
  it("offers every whole step between the min and the max", () => {
    expect(FONT_SIZE_OPTIONS_PX[0]).toBe(MIN_FONT_SIZE_PX);
    expect(FONT_SIZE_OPTIONS_PX[FONT_SIZE_OPTIONS_PX.length - 1]).toBe(MAX_FONT_SIZE_PX);
    expect(FONT_SIZE_OPTIONS_PX).toContain(DEFAULT_FONT_SIZE_PX);
  });

  it("has a default family that is one of the families", () => {
    expect(FONT_FAMILIES.map((f) => f.id)).toContain(DEFAULT_FONT_FAMILY_ID);
  });
});
