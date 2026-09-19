export type ThemeKind = "light" | "dark";

export interface ThemeDef {
  id: string;
  label: string;
  kind: ThemeKind;
}

export const THEMES: ThemeDef[] = [
  { id: "zed-dark", label: "Zed Dark", kind: "dark" },
  { id: "zed-light", label: "Zed Light", kind: "light" },
  { id: "ayu-dark", label: "Ayu Dark", kind: "dark" },
  { id: "one-light", label: "One Light", kind: "light" },
  { id: "one-dark", label: "One Dark", kind: "dark" },
  { id: "gruvbox-light-soft", label: "Gruvbox Light Soft", kind: "light" },
  { id: "gruvbox-light-hard", label: "Gruvbox Light Hard", kind: "light" },
  { id: "gruvbox-dark-soft", label: "Gruvbox Dark Soft", kind: "dark" },
  { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard", kind: "dark" },
];

export const DEFAULT_THEME_ID = "zed-dark";

/** The themes the Light/Dark switch offers, in the order they're listed. */
export function themesOfKind(kind: ThemeKind): ThemeDef[] {
  return THEMES.filter((theme) => theme.kind === kind);
}

export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((theme) => theme.id === id);
}

/** Light or dark — the kind of the applied theme, falling back to the default's. */
export function themeKind(id: string): ThemeKind {
  return findTheme(id)?.kind ?? (findTheme(DEFAULT_THEME_ID)?.kind ?? "dark");
}

/**
 * Where the Light/Dark switch lands when that side has no remembered choice:
 * the first theme of that kind in [`THEMES`].
 *
 * Deliberately derived rather than a second hard-coded pair of ids — a list
 * that gained a theme at the top, or lost the one named here, would otherwise
 * leave the switch pointing at nothing.
 */
export function defaultThemeOfKind(kind: ThemeKind): string {
  return themesOfKind(kind)[0]?.id ?? DEFAULT_THEME_ID;
}
