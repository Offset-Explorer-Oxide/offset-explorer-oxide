import { create } from "zustand";
import { DEFAULT_THEME_ID, defaultThemeOfKind, findTheme, ThemeKind, themeKind } from "./themes";

interface ThemeState {
  appliedThemeId: string;
  /**
   * Which theme each side of the Light/Dark switch goes back to.
   *
   * Without this, flipping to Light and back to Dark dropped you on the
   * *default* dark theme rather than the one you had been using — so the
   * switch quietly discarded a choice every time it was used both ways.
   */
  lastByKind: Partial<Record<ThemeKind, string>>;
  setApplied: (id: string) => void;
  /** Flips between light and dark, restoring whichever theme that side was last on. */
  setKind: (kind: ThemeKind) => void;
}

// The `kafkaoxide.` prefix is the app's previous name, and it stays.
// Renaming these keys cannot help anyone: a browser key that survives the
// upgrade carries the user's settings forward, and one that doesn't is gone
// either way. Changing them would only guarantee the first case is lost too.
// See the localStorage note in .claude/CLAUDE.md.
const STORAGE_KEY = "kafkaoxide.theme";
const BY_KIND_STORAGE_KEY = "kafkaoxide.theme-by-kind";

/**
 * The stored theme, or the default if it names a theme that no longer exists.
 *
 * The id is written by whatever version of the app the user last ran, and a
 * theme dropped from `THEMES` since then would otherwise be set on
 * `<html data-theme>` with no stylesheet block behind it — every `--color-*`
 * undefined, which renders as black-on-black rather than as anything a user
 * could diagnose.
 */
function loadStoredTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && findTheme(stored) ? stored : DEFAULT_THEME_ID;
}

function loadStoredByKind(): Partial<Record<ThemeKind, string>> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(BY_KIND_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<ThemeKind, string>>) : {};
    const clean: Partial<Record<ThemeKind, string>> = {};
    // Same validation as above, and one step stricter: a remembered id must
    // still be of the kind it is remembered under, or the Light button would
    // apply a dark theme.
    for (const kind of ["light", "dark"] as ThemeKind[]) {
      const id = parsed[kind];
      if (id && findTheme(id)?.kind === kind) clean[kind] = id;
    }
    return clean;
  } catch {
    return {};
  }
}

function persistByKind(byKind: Partial<Record<ThemeKind, string>>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BY_KIND_STORAGE_KEY, JSON.stringify(byKind));
  } catch {
    // localStorage unavailable — the choice still applies for this run.
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  appliedThemeId: loadStoredTheme(),
  lastByKind: loadStoredByKind(),
  setApplied: (id) => {
    if (!findTheme(id)) return;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    const lastByKind = { ...get().lastByKind, [themeKind(id)]: id };
    persistByKind(lastByKind);
    set({ appliedThemeId: id, lastByKind });
  },
  setKind: (kind) => {
    if (themeKind(get().appliedThemeId) === kind) return;
    get().setApplied(get().lastByKind[kind] ?? defaultThemeOfKind(kind));
  },
}));
