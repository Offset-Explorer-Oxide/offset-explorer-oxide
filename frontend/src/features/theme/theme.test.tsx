import { beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";
import { useThemeStore } from "./useThemeStore";
import { DEFAULT_THEME_ID } from "./themes";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID });
});

describe("ThemeProvider", () => {
  it("applies the applied theme on mount", () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe(DEFAULT_THEME_ID);
  });

  it("reacts to theme changes after mount", () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    act(() => {
      useThemeStore.getState().setApplied("zed-light");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("zed-light");
  });
});
