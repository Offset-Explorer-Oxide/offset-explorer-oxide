/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemePicker } from "./ThemePicker";
import { DEFAULT_THEME_ID, themesOfKind } from "./themes";
import { useThemeStore } from "./useThemeStore";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID, lastByKind: {} });
});

describe("ThemePicker", () => {
  it("offers a Light and a Dark side, with the applied theme's side checked", () => {
    render(<ThemePicker />);

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("lists only the themes of the side that is showing", () => {
    render(<ThemePicker />);

    for (const theme of themesOfKind("dark")) {
      expect(screen.getByRole("radio", { name: theme.label })).toBeInTheDocument();
    }
    for (const theme of themesOfKind("light")) {
      expect(screen.queryByRole("radio", { name: theme.label })).not.toBeInTheDocument();
    }
  });

  // Picking a side applies a theme rather than only filtering the list — the
  // window is the preview, so the answer to "what does light look like" is on
  // screen before the second click.
  it("applies a theme of that kind as soon as the side is picked", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    expect(screen.getByRole("radio", { name: "One Light" })).toBeInTheDocument();
  });

  it("applies a theme when its option is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("radio", { name: "One Dark" }));

    expect(useThemeStore.getState().appliedThemeId).toBe("one-dark");
    expect(screen.getByRole("radio", { name: "One Dark" })).toBeChecked();
  });

  // A swatch carries the theme's own `data-theme`, which is what pulls that
  // theme's palette in from themes.css — the alternative, a copy of every
  // palette in TypeScript, drifts the first time a colour is tweaked.
  it("paints each swatch with its own theme's palette", () => {
    const { container } = render(<ThemePicker />);

    const swatches = Array.from(container.querySelectorAll(".theme-swatch")).map((el) =>
      el.getAttribute("data-theme"),
    );
    expect(swatches).toEqual(themesOfKind("dark").map((theme) => theme.id));
  });

  it("gives only the checked option a tab stop, so Tab reaches the group and the arrows move inside it", () => {
    render(<ThemePicker />);

    expect(screen.getByRole("radio", { name: "Zed Dark" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Ayu Dark" })).toHaveAttribute("tabindex", "-1");
  });

  it("wraps around the end of the list with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    screen.getByRole("radio", { name: "Zed Dark" }).focus();
    await user.keyboard("{ArrowUp}");

    const darkThemes = themesOfKind("dark");
    expect(useThemeStore.getState().appliedThemeId).toBe(darkThemes[darkThemes.length - 1].id);
  });

  it("switches sides with the arrow keys too", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    screen.getByRole("radio", { name: "Dark" }).focus();
    await user.keyboard("{ArrowLeft}");

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
  });
});

describe("ThemePicker label legibility", () => {
  /**
   * The theme names are the only thing telling two variants of one family
   * apart, so the column they sit in has to scale with the font setting. A
   * fixed pixel minimum truncated "Gruvbox Dark Soft" and "Gruvbox Dark Hard"
   * to the same "Gruvbox Dark …" at 17px, leaving two options a user could
   * not choose between.
   */
  it("sizes the theme grid in font-relative units", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
    const block = css.slice(css.indexOf("\n.theme-list {"), css.indexOf("}", css.indexOf("\n.theme-list {")));

    expect(block).toMatch(/minmax\(\s*[\d.]+em/);
  });

  it("gives every theme a distinct label", () => {
    render(<ThemePicker />);

    const labels = screen.getAllByRole("radio").map((el) => el.textContent);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
