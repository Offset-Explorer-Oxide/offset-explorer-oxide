import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID } from "./themes";
import { useThemeStore } from "./useThemeStore";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID, lastByKind: {} });
});

describe("useThemeStore", () => {
  it("applies and persists a theme", () => {
    useThemeStore.getState().setApplied("one-light");

    expect(useThemeStore.getState().appliedThemeId).toBe("one-light");
    expect(localStorage.getItem("kafkaoxide.theme")).toBe("one-light");
  });

  // The id in storage was written by whatever version of the app ran last. A
  // theme since removed would be set on `<html data-theme>` with no
  // stylesheet block behind it — every `--color-*` undefined, which renders
  // as an unreadable window rather than as anything diagnosable.
  it("ignores a theme id that no longer exists", () => {
    useThemeStore.getState().setApplied("theme-from-a-past-release");

    expect(useThemeStore.getState().appliedThemeId).toBe(DEFAULT_THEME_ID);
  });

  describe("the light/dark switch", () => {
    it("moves to the default theme of the other kind", () => {
      useThemeStore.getState().setKind("light");

      expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    });

    it("does nothing when that kind is already applied", () => {
      useThemeStore.getState().setApplied("ayu-dark");
      useThemeStore.getState().setKind("dark");

      expect(useThemeStore.getState().appliedThemeId).toBe("ayu-dark");
    });

    // Without the per-kind memory, flipping to Light and back landed on the
    // *default* dark theme — so the switch silently discarded a choice every
    // time it was used both ways.
    it("returns to the theme each side was last on", () => {
      useThemeStore.getState().setApplied("gruvbox-dark-hard");
      useThemeStore.getState().setKind("light");
      useThemeStore.getState().setApplied("one-light");

      useThemeStore.getState().setKind("dark");
      expect(useThemeStore.getState().appliedThemeId).toBe("gruvbox-dark-hard");

      useThemeStore.getState().setKind("light");
      expect(useThemeStore.getState().appliedThemeId).toBe("one-light");
    });

    it("persists the per-kind memory", () => {
      useThemeStore.getState().setApplied("ayu-dark");

      expect(JSON.parse(localStorage.getItem("kafkaoxide.theme-by-kind") ?? "{}")).toMatchObject({
        dark: "ayu-dark",
      });
    });
  });
});

/**
 * The stored values are read once, at module load, so these reset the module
 * registry and re-import with localStorage already seeded — the only way to
 * exercise the path a real app start takes.
 */
describe("useThemeStore on startup", () => {
  async function loadWith(entries: Record<string, string>) {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    vi.resetModules();
    return (await import("./useThemeStore")).useThemeStore;
  }

  it("restores the stored theme", async () => {
    const store = await loadWith({ "kafkaoxide.theme": "ayu-dark" });

    expect(store.getState().appliedThemeId).toBe("ayu-dark");
  });

  // Otherwise `<html data-theme>` names a theme with no stylesheet block
  // behind it and every `--color-*` is undefined — an unreadable window.
  it("falls back to the default when the stored theme no longer exists", async () => {
    const store = await loadWith({ "kafkaoxide.theme": "theme-from-a-past-release" });

    expect(store.getState().appliedThemeId).toBe(DEFAULT_THEME_ID);
  });

  it("restores the per-kind memory", async () => {
    const store = await loadWith({
      "kafkaoxide.theme": "ayu-dark",
      "kafkaoxide.theme-by-kind": JSON.stringify({ dark: "ayu-dark", light: "one-light" }),
    });

    store.getState().setKind("light");
    expect(store.getState().appliedThemeId).toBe("one-light");
  });

  // A remembered id has to still be of the kind it is filed under, or the
  // Light button would apply a dark theme.
  it("drops a remembered id that is no longer of that kind", async () => {
    const store = await loadWith({
      "kafkaoxide.theme-by-kind": JSON.stringify({ light: "ayu-dark", dark: "no-such-theme" }),
    });

    store.getState().setKind("light");
    expect(store.getState().appliedThemeId).toBe("zed-light");
  });

  it("survives unparseable stored preferences", async () => {
    const store = await loadWith({ "kafkaoxide.theme-by-kind": "{not json" });

    expect(store.getState().lastByKind).toEqual({});
  });
});
