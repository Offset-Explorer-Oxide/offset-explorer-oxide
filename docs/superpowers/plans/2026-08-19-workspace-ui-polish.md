# Workspace UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the rough edges in the current workspace UI: closable/bigger tabs, a new gear-icon Settings surface (theme dropdown with checkmark, live-preview font family/size preferences), a collapsed-by-default logs panel with a Zed-style toggle, a permanently visible left/middle divider, a right pane that only appears when a message is selected, and a New Connection modal that stops resizing/repositioning on tab switch and can be dragged by its header.

**Architecture:** Frontend-only (React + TypeScript + zustand + vitest/RTL), no backend/Tauri command changes. Every new piece of persisted state follows the codebase's existing manual-`localStorage` zustand pattern (as seen in `useThemeStore`/`useResizablePanes` — no `persist` middleware). Hover-preview (font family) reuses the exact `previewX`/`appliedX` + `setPreview`/`setApplied` shape already proven in `useThemeStore`.

**Tech Stack:** React 18, TypeScript, zustand, Vite, Vitest, @testing-library/react, @testing-library/user-event.

**Spec:** `docs/superpowers/specs/2026-08-19-workspace-ui-polish-design.md`

---

## File Structure

New files:
- `frontend/src/features/tabs/useTabsStore.test.ts` — new dedicated store-level tests for `deleteTab` (existing tab tests are all at the `TabBar` component level; delete logic is store-level so gets its own file, following the split already used elsewhere e.g. `dataFilters.test.ts` alongside component tests).
- `frontend/src/features/settings/fonts.ts` — curated font family list (mirrors `features/theme/themes.ts`).
- `frontend/src/features/settings/usePreferencesStore.ts` — font family (applied/preview) + font size state, localStorage-persisted.
- `frontend/src/features/settings/usePreferencesStore.test.ts`
- `frontend/src/features/settings/PreferencesProvider.tsx` — applies `--font-family-base`/`--font-size-base` CSS variables (mirrors `ThemeProvider.tsx`).
- `frontend/src/features/settings/PreferencesProvider.test.tsx`
- `frontend/src/features/settings/useSettingsPanelStore.ts` — tiny `isOpen` boolean store driving the Settings pseudo-tab.
- `frontend/src/features/settings/SettingsPanel.tsx` — the panel itself: theme dropdown, font family dropdown (hover-preview), font size slider.
- `frontend/src/features/settings/SettingsPanel.test.tsx`
- `frontend/src/features/theme/ThemeDropdown.tsx` — replaces `ThemeSwitcher.tsx` (native `<select>`, checkmark on selected option, immediate apply, no hover-preview).
- `frontend/src/features/theme/ThemeDropdown.test.tsx` — replaces the `ThemeSwitcher`-specific cases in `theme.test.tsx`.
- `frontend/src/features/connections/modal/useDraggableModal.ts`
- `frontend/src/features/connections/modal/useDraggableModal.test.ts`

Modified files:
- `frontend/src/features/tabs/useTabsStore.ts` — add `deleteTab`.
- `frontend/src/features/tabs/TabBar.tsx` — add close button per tab, render the Settings pill.
- `frontend/src/features/tabs/TabBar.test.tsx` — add close-button and Settings-pill tests.
- `frontend/src/features/bottom-panel/useLogsStore.ts` — add `isExpanded` + `toggleExpanded`.
- `frontend/src/features/bottom-panel/useLogsStore.test.ts` (new — logs store currently has no dedicated test file, only covered indirectly via `BottomPanel.test.tsx`; the new toggle logic gets its own).
- `frontend/src/features/bottom-panel/BottomPanel.tsx` — status strip + toggle icon, conditional `LogsPanel`.
- `frontend/src/features/bottom-panel/BottomPanel.test.tsx` — update for collapsed-by-default + toggle.
- `frontend/src/features/layout/ResizableShell.tsx` — omit right pane + its divider entirely when `right` is not passed.
- `frontend/src/features/layout/ResizableShell.test.tsx` — replace the "keeps the right pane... with a placeholder" test.
- `frontend/src/features/connections/modal/ConnectionModal.tsx` — fixed height, draggable header.
- `frontend/src/features/connections/modal/ConnectionModal.test.tsx` — add drag test.
- `frontend/src/App.tsx` — gear icon (replaces `<ThemeSwitcher />`), Settings-panel branch in the middle pane, conditional `right` prop wired to `useMessageViewerStore`, wrap in `<PreferencesProvider>`.
- `frontend/src/App.test.tsx` — update for gear icon + conditional right pane.
- `frontend/src/features/theme/useThemeStore.ts` — remove now-unused `previewThemeId`/`setPreview`/`activeThemeId` (dead once `ThemeSwitcher` is deleted — no other consumer).
- `frontend/src/features/theme/theme.test.tsx` — remove the hover-preview cases (superseded by `ThemeDropdown.test.tsx`), keep/adjust the "applies default theme on mount" `ThemeProvider` case.
- `frontend/src/features/theme/ThemeProvider.tsx` — read `appliedThemeId` directly (no more preview resolution).
- `frontend/src/styles/global.css` — tab sizing, tab close button, Settings pill/panel, font CSS variables on `body`, persistent left/middle divider, bottom-panel status strip, connection-modal fixed height + draggable cursor.

Deleted files:
- `frontend/src/features/theme/ThemeSwitcher.tsx` (replaced by `ThemeDropdown.tsx`).

---

## Task 1: Tab bar — close button

**Files:**
- Modify: `frontend/src/features/tabs/useTabsStore.ts`
- Create: `frontend/src/features/tabs/useTabsStore.test.ts`
- Modify: `frontend/src/features/tabs/TabBar.tsx`
- Modify: `frontend/src/features/tabs/TabBar.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the failing store test**

Create `frontend/src/features/tabs/useTabsStore.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandlers } from "../../lib/testInvoke";
import { useTabsStore } from "./useTabsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null, error: null });
});

describe("useTabsStore deleteTab", () => {
  it("removes the tab from state and calls tab_delete", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["1"]);
    expect(invoke).toHaveBeenCalledWith("tab_delete", { id: "2" });
  });

  it("falls back activeTabId to the previous tab when the active tab is closed", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
        { id: "3", name: "Gamma", position: 2 },
      ],
      activeTabId: "2",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().activeTabId).toBe("1");
  });

  it("falls back activeTabId to the next tab when closing the first (active) tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().activeTabId).toBe("2");
  });

  it("sets activeTabId to null when closing the last remaining tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().activeTabId).toBeNull();
  });

  it("leaves activeTabId unchanged when closing a non-active tab", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("2");

    expect(useTabsStore.getState().activeTabId).toBe("1");
  });

  it("sets an error and leaves state unchanged when the backend call fails", async () => {
    setInvokeHandlers({
      tab_delete: () => {
        throw new Error("delete failed");
      },
    });
    useTabsStore.setState({
      tabs: [{ id: "1", name: "Alpha", position: 0 }],
      activeTabId: "1",
    });

    await useTabsStore.getState().deleteTab("1");

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().error).toBe("delete failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tabs/useTabsStore.test.ts`
Expected: FAIL — `useTabsStore.getState().deleteTab is not a function`

- [ ] **Step 3: Implement `deleteTab` in the store**

In `frontend/src/features/tabs/useTabsStore.ts`, add `deleteTab` to the `TabsState` interface (after `renameTab`):

```typescript
  renameTab: (id: string, name: string) => Promise<void>;
  deleteTab: (id: string) => Promise<void>;
  selectTab: (id: string) => void;
```

Add the implementation (after `renameTab`'s implementation, before `selectTab`):

```typescript
  deleteTab: async (id: string) => {
    try {
      await api.deleteTab(id);
      set((state) => {
        const tabs = state.tabs.filter((tab) => tab.id !== id);
        if (state.activeTabId !== id) {
          return { tabs, error: null };
        }
        const closedIndex = state.tabs.findIndex((tab) => tab.id === id);
        const fallback = state.tabs[closedIndex - 1] ?? state.tabs[closedIndex + 1] ?? null;
        return { tabs, activeTabId: fallback?.id ?? null, error: null };
      });
    } catch (err) {
      set({ error: errorMessage(err, "Failed to delete tab") });
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tabs/useTabsStore.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the failing TabBar close-button test**

In `frontend/src/features/tabs/TabBar.test.tsx`, add (inside the existing `describe("TabBar", ...)` block, after the "adds a new tab" test):

```typescript
  it("closes a tab via its close button without selecting it first", async () => {
    setInvokeHandlers({ tab_delete: () => undefined });
    useTabsStore.setState({
      tabs: [
        { id: "1", name: "Alpha", position: 0 },
        { id: "2", name: "Beta", position: 1 },
      ],
      activeTabId: "1",
    });
    const user = userEvent.setup();
    render(<TabBar />);

    await user.click(screen.getByLabelText("Close tab Beta"));

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["1"]);
    });
    expect(useTabsStore.getState().activeTabId).toBe("1");
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tabs/TabBar.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Close tab Beta`

- [ ] **Step 7: Add the close button to `TabBar`**

In `frontend/src/features/tabs/TabBar.tsx`, add `deleteTab` to the store selectors (after `addTab`):

```typescript
  const addTab = useTabsStore((s) => s.addTab);
  const deleteTab = useTabsStore((s) => s.deleteTab);
```

Replace the tab's inner content block (the `{editingId === tab.id ? (...) : (<span>{tab.name}</span>)}` section) with:

```typescript
            {editingId === tab.id ? (
              <input
                autoFocus
                value={draftName}
                aria-label={`Rename tab ${tab.name}`}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitEditing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing();
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <>
                <span>{tab.name}</span>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close tab ${tab.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTab(tab.id);
                  }}
                >
                  ×
                </button>
              </>
            )}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tabs/TabBar.test.tsx`
Expected: PASS — all tests including the new one

- [ ] **Step 9: Bump tab sizing and style the close button**

In `frontend/src/styles/global.css`, replace the `.tab` rule (currently at line 146):

```css
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 14px;
  border-radius: 4px;
  cursor: pointer;
}
.tab-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  opacity: 0.7;
}
.tab-close:hover {
  opacity: 1;
}
```

- [ ] **Step 10: Run the full frontend test suite and commit**

Run: `cd frontend && npx vitest run`
Expected: PASS (all tests, including the two files touched here)

```bash
git add frontend/src/features/tabs frontend/src/styles/global.css
git commit -m "feat(frontend): add tab close button and bigger tab sizing"
```

---

## Task 2: Font preferences store

**Files:**
- Create: `frontend/src/features/settings/fonts.ts`
- Create: `frontend/src/features/settings/usePreferencesStore.ts`
- Create: `frontend/src/features/settings/usePreferencesStore.test.ts`

- [ ] **Step 1: Create the curated font list**

Create `frontend/src/features/settings/fonts.ts`:

```typescript
export interface FontFamilyDef {
  id: string;
  label: string;
  cssValue: string;
}

export const FONT_FAMILIES: FontFamilyDef[] = [
  { id: "system-ui", label: "System UI", cssValue: '-apple-system, "Segoe UI", sans-serif' },
  { id: "inter", label: "Inter", cssValue: 'Inter, -apple-system, "Segoe UI", sans-serif' },
  { id: "jetbrains-mono", label: "JetBrains Mono", cssValue: '"JetBrains Mono", Menlo, Consolas, monospace' },
  { id: "menlo", label: "Menlo", cssValue: "Menlo, Consolas, monospace" },
];

export const DEFAULT_FONT_FAMILY_ID = "system-ui";

export const MIN_FONT_SIZE_PX = 11;
export const MAX_FONT_SIZE_PX = 18;
export const DEFAULT_FONT_SIZE_PX = 13;

export function fontFamilyCssValue(id: string): string {
  return FONT_FAMILIES.find((f) => f.id === id)?.cssValue ?? FONT_FAMILIES[0].cssValue;
}
```

- [ ] **Step 2: Write the failing store test**

Create `frontend/src/features/settings/usePreferencesStore.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore, activeFontFamilyId, loadStoredPreferences } from "./usePreferencesStore";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX } from "./fonts";

const STORAGE_KEY = "kafkaoxide.preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferencesStore.setState({
    appliedFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    previewFontFamilyId: null,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
  });
});

describe("usePreferencesStore", () => {
  it("defaults to system-ui at 13px when nothing is stored", () => {
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
    expect(usePreferencesStore.getState().fontSizePx).toBe(DEFAULT_FONT_SIZE_PX);
  });

  it("previews a font family without committing it", () => {
    usePreferencesStore.getState().setPreviewFontFamily("inter");
    expect(activeFontFamilyId(usePreferencesStore.getState())).toBe("inter");
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("reverts to the applied family when preview is cleared", () => {
    usePreferencesStore.getState().setPreviewFontFamily("inter");
    usePreferencesStore.getState().setPreviewFontFamily(null);
    expect(activeFontFamilyId(usePreferencesStore.getState())).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("commits a font family and persists it to localStorage", () => {
    usePreferencesStore.getState().setAppliedFontFamily("jetbrains-mono");

    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe("jetbrains-mono");
    expect(usePreferencesStore.getState().previewFontFamilyId).toBeNull();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.fontFamilyId).toBe("jetbrains-mono");
  });

  it("commits a font size and persists it to localStorage", () => {
    usePreferencesStore.getState().setFontSizePx(16);

    expect(usePreferencesStore.getState().fontSizePx).toBe(16);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.fontSizePx).toBe(16);
  });

  it("reads persisted preferences via the store's storage-read helper", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontFamilyId: "menlo", fontSizePx: 15 }));

    expect(loadStoredPreferences()).toEqual({ fontFamilyId: "menlo", fontSizePx: 15 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/settings/usePreferencesStore.test.ts`
Expected: FAIL — cannot find module `./usePreferencesStore`

- [ ] **Step 4: Implement the store**

Create `frontend/src/features/settings/usePreferencesStore.ts`:

```typescript
import { create } from "zustand";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "./fonts";

interface PreferencesState {
  appliedFontFamilyId: string;
  previewFontFamilyId: string | null;
  fontSizePx: number;
  setAppliedFontFamily: (id: string) => void;
  setPreviewFontFamily: (id: string | null) => void;
  setFontSizePx: (px: number) => void;
}

const STORAGE_KEY = "kafkaoxide.preferences";

interface StoredPreferences {
  fontFamilyId: string;
  fontSizePx: number;
}

export function loadStoredPreferences(): StoredPreferences {
  if (typeof localStorage === "undefined") {
    return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return {
      fontFamilyId: parsed.fontFamilyId ?? DEFAULT_FONT_FAMILY_ID,
      fontSizePx: parsed.fontSizePx ?? DEFAULT_FONT_SIZE_PX,
    };
  } catch {
    return { fontFamilyId: DEFAULT_FONT_FAMILY_ID, fontSizePx: DEFAULT_FONT_SIZE_PX };
  }
}

function persist(patch: Partial<StoredPreferences>) {
  if (typeof localStorage === "undefined") return;
  const current = loadStoredPreferences();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

function clampFontSize(px: number): number {
  return Math.min(Math.max(px, MIN_FONT_SIZE_PX), MAX_FONT_SIZE_PX);
}

const initial = loadStoredPreferences();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  appliedFontFamilyId: initial.fontFamilyId,
  previewFontFamilyId: null,
  fontSizePx: clampFontSize(initial.fontSizePx),
  setAppliedFontFamily: (id) => {
    persist({ fontFamilyId: id });
    set({ appliedFontFamilyId: id, previewFontFamilyId: null });
  },
  setPreviewFontFamily: (id) => set({ previewFontFamilyId: id }),
  setFontSizePx: (px) => {
    const clamped = clampFontSize(px);
    persist({ fontSizePx: clamped });
    set({ fontSizePx: clamped });
  },
}));

export function activeFontFamilyId(
  state: Pick<PreferencesState, "appliedFontFamilyId" | "previewFontFamilyId">,
): string {
  return state.previewFontFamilyId ?? state.appliedFontFamilyId;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/settings/usePreferencesStore.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/settings/fonts.ts frontend/src/features/settings/usePreferencesStore.ts frontend/src/features/settings/usePreferencesStore.test.ts
git commit -m "feat(frontend): add font preferences store"
```

---

## Task 3: PreferencesProvider — apply CSS variables

**Files:**
- Create: `frontend/src/features/settings/PreferencesProvider.tsx`
- Create: `frontend/src/features/settings/PreferencesProvider.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/settings/PreferencesProvider.test.tsx`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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

    usePreferencesStore.getState().setFontSizePx(16);

    expect(document.documentElement.style.getPropertyValue("--font-size-base")).toBe("16px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/settings/PreferencesProvider.test.tsx`
Expected: FAIL — cannot find module `./PreferencesProvider`

- [ ] **Step 3: Implement `PreferencesProvider`**

Create `frontend/src/features/settings/PreferencesProvider.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/settings/PreferencesProvider.test.tsx`
Expected: PASS — 2 tests

- [ ] **Step 5: Wire the CSS variables into the base font declaration**

In `frontend/src/styles/global.css`, replace the `body` rule (currently at line 12):

```css
body {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-family-base, -apple-system, "Segoe UI", sans-serif);
  font-size: var(--font-size-base, 13px);
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/settings/PreferencesProvider.tsx frontend/src/features/settings/PreferencesProvider.test.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): apply font preferences as CSS variables"
```

---

## Task 4: Theme dropdown (replaces swatch buttons)

**Files:**
- Create: `frontend/src/features/theme/ThemeDropdown.tsx`
- Create: `frontend/src/features/theme/ThemeDropdown.test.tsx`
- Modify: `frontend/src/features/theme/useThemeStore.ts`
- Modify: `frontend/src/features/theme/ThemeProvider.tsx`
- Modify: `frontend/src/features/theme/theme.test.tsx`
- Delete: `frontend/src/features/theme/ThemeSwitcher.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/theme/ThemeDropdown.test.tsx`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeDropdown } from "./ThemeDropdown";
import { useThemeStore } from "./useThemeStore";
import { DEFAULT_THEME_ID } from "./themes";

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID });
});

describe("ThemeDropdown", () => {
  it("marks the currently applied theme's option with a checkmark", () => {
    render(<ThemeDropdown />);
    const option = screen.getByRole("option", { name: "✓ Zed Dark" }) as HTMLOptionElement;
    expect(option.selected).toBe(true);
  });

  it("applies the selected theme immediately and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemeDropdown />);

    await user.selectOptions(screen.getByLabelText("Theme"), "zed-light");

    expect(useThemeStore.getState().appliedThemeId).toBe("zed-light");
    expect(localStorage.getItem("kafkaoxide.theme")).toBe("zed-light");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/theme/ThemeDropdown.test.tsx`
Expected: FAIL — cannot find module `./ThemeDropdown`

- [ ] **Step 3: Simplify `useThemeStore` (drop unused preview API)**

Replace `frontend/src/features/theme/useThemeStore.ts` entirely with:

```typescript
import { create } from "zustand";
import { DEFAULT_THEME_ID } from "./themes";

interface ThemeState {
  appliedThemeId: string;
  setApplied: (id: string) => void;
}

const STORAGE_KEY = "kafkaoxide.theme";

function loadStoredTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

export const useThemeStore = create<ThemeState>((set) => ({
  appliedThemeId: loadStoredTheme(),
  setApplied: (id) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    set({ appliedThemeId: id });
  },
}));
```

- [ ] **Step 4: Update `ThemeProvider` to drop preview resolution**

Replace `frontend/src/features/theme/ThemeProvider.tsx` entirely with:

```tsx
import { useEffect } from "react";
import { useThemeStore } from "./useThemeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appliedThemeId);
  }, [appliedThemeId]);

  return <>{children}</>;
}
```

- [ ] **Step 5: Create `ThemeDropdown`**

Create `frontend/src/features/theme/ThemeDropdown.tsx`:

```tsx
import { THEMES } from "./themes";
import { useThemeStore } from "./useThemeStore";

export function ThemeDropdown() {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const setApplied = useThemeStore((s) => s.setApplied);

  return (
    <label className="settings-field">
      <span>Theme</span>
      <select
        aria-label="Theme"
        value={appliedThemeId}
        onChange={(e) => setApplied(e.target.value)}
      >
        {THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.id === appliedThemeId ? `✓ ${theme.label}` : theme.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 6: Delete `ThemeSwitcher.tsx` and update `theme.test.tsx`**

Delete `frontend/src/features/theme/ThemeSwitcher.tsx`.

Replace `frontend/src/features/theme/theme.test.tsx` entirely with:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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

    useThemeStore.getState().setApplied("zed-light");

    expect(document.documentElement.getAttribute("data-theme")).toBe("zed-light");
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/theme`
Expected: PASS — `ThemeDropdown.test.tsx` (2 tests) and `theme.test.tsx` (2 tests)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/theme
git commit -m "feat(frontend): replace theme swatches with a checkmarked dropdown"
```

---

## Task 5: Settings panel + gear-icon entry point

**Files:**
- Create: `frontend/src/features/settings/useSettingsPanelStore.ts`
- Create: `frontend/src/features/settings/SettingsPanel.tsx`
- Create: `frontend/src/features/settings/SettingsPanel.test.tsx`
- Modify: `frontend/src/features/tabs/TabBar.tsx`
- Modify: `frontend/src/features/tabs/TabBar.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Create the tiny open/close store**

Create `frontend/src/features/settings/useSettingsPanelStore.ts`:

```typescript
import { create } from "zustand";

interface SettingsPanelState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
```

(No test file needed for this one — it's exercised through `SettingsPanel.test.tsx` and `App.test.tsx`, same as `useMessageViewerStore` is exercised through its consumers plus its own thin test; this one is thin enough it's covered end-to-end instead. See `useMessageViewerStore.test.ts` for the precedent of when a store *does* get a dedicated file — this one has zero branching logic, just two setters, so an end-to-end check is sufficient.)

- [ ] **Step 2: Write the failing SettingsPanel test**

Create `frontend/src/features/settings/SettingsPanel.test.tsx`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { usePreferencesStore } from "./usePreferencesStore";
import { useThemeStore } from "../theme/useThemeStore";
import { DEFAULT_FONT_FAMILY_ID, DEFAULT_FONT_SIZE_PX } from "./fonts";
import { DEFAULT_THEME_ID } from "../theme/themes";

beforeEach(() => {
  localStorage.clear();
  usePreferencesStore.setState({
    appliedFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    previewFontFamilyId: null,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
  });
  useThemeStore.setState({ appliedThemeId: DEFAULT_THEME_ID });
  document.documentElement.style.removeProperty("--font-family-base");
});

describe("SettingsPanel", () => {
  it("renders the theme dropdown, font family dropdown, and font size slider", () => {
    render(<SettingsPanel />);
    expect(screen.getByLabelText("Theme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /System UI/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Font size")).toBeInTheDocument();
  });

  it("marks the applied font family with a checkmark when the dropdown is open", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));

    expect(screen.getByRole("option", { name: "✓ System UI" })).toBeInTheDocument();
  });

  it("live-previews a font family on hover without committing it", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    await user.hover(screen.getByRole("option", { name: "Inter" }));

    expect(document.documentElement.style.getPropertyValue("--font-family-base")).toBe("");
    // The dropdown itself doesn't own CSS application (PreferencesProvider does,
    // tested separately) — what SettingsPanel owns is calling setPreviewFontFamily,
    // asserted directly against the store:
    expect(usePreferencesStore.getState().previewFontFamilyId).toBe("inter");
    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe(DEFAULT_FONT_FAMILY_ID);
  });

  it("commits a font family on click", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByRole("button", { name: /System UI/ }));
    await user.click(screen.getByRole("option", { name: "Inter" }));

    expect(usePreferencesStore.getState().appliedFontFamilyId).toBe("inter");
  });

  it("commits a font size change immediately", () => {
    render(<SettingsPanel />);
    const slider = screen.getByLabelText("Font size") as HTMLInputElement;

    fireEvent.change(slider, { target: { value: String(DEFAULT_FONT_SIZE_PX + 1) } });

    expect(usePreferencesStore.getState().fontSizePx).toBe(DEFAULT_FONT_SIZE_PX + 1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/settings/SettingsPanel.test.tsx`
Expected: FAIL — cannot find module `./SettingsPanel`

- [ ] **Step 4: Implement `SettingsPanel`**

Create `frontend/src/features/settings/SettingsPanel.tsx`:

```tsx
import { useState } from "react";
import { ThemeDropdown } from "../theme/ThemeDropdown";
import { FONT_FAMILIES, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX } from "./fonts";
import { activeFontFamilyId, usePreferencesStore } from "./usePreferencesStore";

export function SettingsPanel() {
  const appliedFontFamilyId = usePreferencesStore((s) => s.appliedFontFamilyId);
  const previewFontFamilyId = usePreferencesStore((s) => s.previewFontFamilyId);
  const setPreviewFontFamily = usePreferencesStore((s) => s.setPreviewFontFamily);
  const setAppliedFontFamily = usePreferencesStore((s) => s.setAppliedFontFamily);
  const fontSizePx = usePreferencesStore((s) => s.fontSizePx);
  const setFontSizePx = usePreferencesStore((s) => s.setFontSizePx);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

  const displayedFamily = FONT_FAMILIES.find(
    (f) => f.id === activeFontFamilyId({ appliedFontFamilyId, previewFontFamilyId }),
  )!;

  return (
    <div className="settings-panel">
      <h2>Settings</h2>

      <ThemeDropdown />

      <div className="settings-field">
        <span>Font style</span>
        <div className="settings-dropdown">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={fontMenuOpen}
            onClick={() => setFontMenuOpen((v) => !v)}
          >
            {displayedFamily.label} ▾
          </button>
          {fontMenuOpen && (
            <ul role="listbox" aria-label="Font style" onMouseLeave={() => setPreviewFontFamily(null)}>
              {FONT_FAMILIES.map((f) => (
                <li
                  key={f.id}
                  role="option"
                  aria-selected={f.id === appliedFontFamilyId}
                  onMouseEnter={() => setPreviewFontFamily(f.id)}
                  onClick={() => {
                    setAppliedFontFamily(f.id);
                    setFontMenuOpen(false);
                  }}
                >
                  {f.id === appliedFontFamilyId ? `✓ ${f.label}` : f.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <label className="settings-field">
        <span>Font size ({fontSizePx}px)</span>
        <input
          type="range"
          aria-label="Font size"
          min={MIN_FONT_SIZE_PX}
          max={MAX_FONT_SIZE_PX}
          step={1}
          value={fontSizePx}
          onChange={(e) => setFontSizePx(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/settings/SettingsPanel.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 6: Write the failing TabBar Settings-pill test**

In `frontend/src/features/tabs/TabBar.test.tsx`, add near the top:

```typescript
import { useSettingsPanelStore } from "../settings/useSettingsPanelStore";
```

Add inside `beforeEach`:

```typescript
  useSettingsPanelStore.setState({ isOpen: false });
```

Add a new test case:

```typescript
  it("shows a closable Settings pill when the settings panel is open", async () => {
    useSettingsPanelStore.setState({ isOpen: true });
    const user = userEvent.setup();
    render(<TabBar />);

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByLabelText("Close tab Settings"));

    expect(useSettingsPanelStore.getState().isOpen).toBe(false);
  });

  it("does not show the Settings pill when the settings panel is closed", () => {
    render(<TabBar />);
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tabs/TabBar.test.tsx`
Expected: FAIL — cannot find module `../settings/useSettingsPanelStore` (doesn't exist yet in this file's scope — it does exist as a file, this fails because TabBar itself doesn't render the pill, so `getByRole("tab", { name: "Settings" })` fails)

- [ ] **Step 8: Render the Settings pill in `TabBar`**

In `frontend/src/features/tabs/TabBar.tsx`, add the import:

```typescript
import { useSettingsPanelStore } from "../settings/useSettingsPanelStore";
```

Add selectors (after the `deleteTab` selector added in Task 1):

```typescript
  const settingsOpen = useSettingsPanelStore((s) => s.isOpen);
  const closeSettings = useSettingsPanelStore((s) => s.close);
```

Add the pill markup right after the `tabs.map(...)` block and before the `+` "New tab" button:

```tsx
        {settingsOpen && (
          <div role="tab" aria-selected="true" tabIndex={0} className="tab">
            <span>Settings</span>
            <button
              type="button"
              className="tab-close"
              aria-label="Close tab Settings"
              onClick={(e) => {
                e.stopPropagation();
                closeSettings();
              }}
            >
              ×
            </button>
          </div>
        )}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/tabs/TabBar.test.tsx`
Expected: PASS — all tests including the two new ones

- [ ] **Step 10: Wire the gear icon and Settings branch into `App.tsx`**

In `frontend/src/App.tsx`, replace the imports block's theme-related lines:

```typescript
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { ThemeSwitcher } from "./features/theme/ThemeSwitcher";
```

with:

```typescript
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { PreferencesProvider } from "./features/settings/PreferencesProvider";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { useSettingsPanelStore } from "./features/settings/useSettingsPanelStore";
```

In `AppShell`, add the settings-open selector (after `const selection = ...`):

```typescript
  const settingsOpen = useSettingsPanelStore((s) => s.isOpen);
  const openSettings = useSettingsPanelStore((s) => s.open);
```

Replace the header's `<ThemeSwitcher />` with a gear icon:

```tsx
      <header className="app-header">
        <TabBar />
        <button type="button" aria-label="Open settings" className="settings-gear" onClick={openSettings}>
          ⚙
        </button>
      </header>
```

Replace the `middle` prop's content — wrap the existing `<main className="app-main">...</main>` block so it only renders when Settings isn't open:

```tsx
          middle={
            settingsOpen ? (
              <SettingsPanel />
            ) : (
              <main className="app-main">
                {selection?.type === "connection" && <ClusterDetailPanel connectionId={selection.id} />}
                {selection?.type === "broker" && (
                  <BrokerDetailPanel connectionId={selection.connectionId} brokerId={selection.brokerId} />
                )}
                {selection?.type === "topic" && (
                  <TopicDetailPanel connectionId={selection.connectionId} topicName={selection.topicName} />
                )}
                {selection?.type === "consumerGroup" && (
                  <ConsumerGroupDetailPanel connectionId={selection.connectionId} groupId={selection.groupId} />
                )}
                {!selection && <p className="app-main-placeholder">Select a cluster, broker, or topic.</p>}
              </main>
            )
          }
```

Wrap `AppShell` in `PreferencesProvider` inside the `App` export:

```tsx
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PreferencesProvider>
          <AppShell />
        </PreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 11: Update `App.test.tsx` for the gear icon**

In `frontend/src/App.test.tsx`, the existing "renders the shell..." test doesn't reference `ThemeSwitcher` output directly, so it should keep passing. Add a new test at the end of the `describe("App", ...)` block:

```typescript
  it("opens the Settings panel via the gear icon and shows a closable Settings tab", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    await user.click(screen.getByLabelText("Open settings"));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close tab Settings"));

    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByText("Select a cluster, broker, or topic.")).toBeInTheDocument();
  });
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.test.tsx src/features/tabs src/features/settings`
Expected: PASS

- [ ] **Step 13: Style the gear icon, Settings pill, and Settings panel**

In `frontend/src/styles/global.css`, add after the `.tab-bar-error` rule (around line 160):

```css
.settings-gear {
  background: none;
  border: none;
  color: var(--color-fg-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}
.settings-gear:hover {
  color: var(--color-fg);
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 360px;
}
.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-fg-muted);
}
.settings-field select,
.settings-field input[type="range"] {
  font: inherit;
}
.settings-dropdown {
  position: relative;
}
.settings-dropdown > button {
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
}
.settings-dropdown ul {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: 2px 0 0;
  padding: 4px 0;
  list-style: none;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  z-index: 10;
}
.settings-dropdown li {
  padding: 6px 10px;
  cursor: pointer;
}
.settings-dropdown li:hover,
.settings-dropdown li[aria-selected="true"] {
  background: var(--color-accent);
  color: var(--color-bg);
}
```

- [ ] **Step 14: Run the full frontend test suite and commit**

Run: `cd frontend && npx vitest run`
Expected: PASS

```bash
git add frontend/src/features/settings frontend/src/features/tabs frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): add gear-icon Settings tab with theme and font preferences"
```

---

## Task 6: Logs panel — collapsed by default with a toggle

**Files:**
- Modify: `frontend/src/features/bottom-panel/useLogsStore.ts`
- Create: `frontend/src/features/bottom-panel/useLogsStore.test.ts`
- Modify: `frontend/src/features/bottom-panel/BottomPanel.tsx`
- Modify: `frontend/src/features/bottom-panel/BottomPanel.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the failing store test**

Create `frontend/src/features/bottom-panel/useLogsStore.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { useLogsStore } from "./useLogsStore";

beforeEach(() => {
  useLogsStore.setState({ entries: [], isExpanded: false });
});

describe("useLogsStore isExpanded", () => {
  it("defaults to collapsed", () => {
    expect(useLogsStore.getState().isExpanded).toBe(false);
  });

  it("toggles expanded state", () => {
    useLogsStore.getState().toggleExpanded();
    expect(useLogsStore.getState().isExpanded).toBe(true);

    useLogsStore.getState().toggleExpanded();
    expect(useLogsStore.getState().isExpanded).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/bottom-panel/useLogsStore.test.ts`
Expected: FAIL — `isExpanded` is `undefined`, `toggleExpanded` is not a function

- [ ] **Step 3: Add `isExpanded` to the store**

Replace `frontend/src/features/bottom-panel/useLogsStore.ts` entirely with:

```typescript
import { create } from "zustand";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface LogsState {
  entries: LogEntry[];
  isExpanded: boolean;
  addEntry: (entry: LogEntry) => void;
  toggleExpanded: () => void;
}

const STORAGE_KEY = "kafkaoxide.logs-expanded";

function loadStoredExpanded(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],
  isExpanded: loadStoredExpanded(),
  addEntry: (entry) => set((state) => ({ entries: [...state.entries, entry] })),
  toggleExpanded: () => {
    const next = !get().isExpanded;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(next));
    }
    set({ isExpanded: next });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/bottom-panel/useLogsStore.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Update the failing `BottomPanel` tests for collapsed-by-default**

Replace `frontend/src/features/bottom-panel/BottomPanel.test.tsx` entirely with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLogsStore } from "./useLogsStore";
import { BottomPanel } from "./BottomPanel";

let capturedHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: (event: { payload: unknown }) => void) => {
    capturedHandler = handler;
    return Promise.resolve(() => {});
  }),
}));

beforeEach(() => {
  localStorage.clear();
  useLogsStore.setState({ entries: [], isExpanded: false });
  capturedHandler = null;
});

describe("BottomPanel logs tool", () => {
  it("is collapsed by default", () => {
    render(<BottomPanel />);
    expect(screen.queryByText("No log entries yet.")).not.toBeInTheDocument();
  });

  it("expands when the toggle icon is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Toggle logs panel"));

    expect(screen.getByText("No log entries yet.")).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);

    await user.click(screen.getByLabelText("Toggle logs panel"));
    await user.click(screen.getByLabelText("Toggle logs panel"));

    expect(screen.queryByText("No log entries yet.")).not.toBeInTheDocument();
  });

  it("renders a log entry pushed over the tauri event channel once expanded", async () => {
    const user = userEvent.setup();
    render(<BottomPanel />);
    await user.click(screen.getByLabelText("Toggle logs panel"));

    await vi.waitFor(() => expect(capturedHandler).not.toBeNull());
    capturedHandler!({
      payload: {
        timestamp: "2026-08-18T00:00:00Z",
        level: "info",
        message: 'Created connection "Local Kafka"',
      },
    });

    expect(await screen.findByText('Created connection "Local Kafka"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/bottom-panel/BottomPanel.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Toggle logs panel`, and the "collapsed by default" test fails since `LogsPanel` currently always renders

- [ ] **Step 7: Add the toggle strip to `BottomPanel`**

Replace `frontend/src/features/bottom-panel/BottomPanel.tsx` entirely with:

```tsx
import { LogsPanel } from "./LogsPanel";
import { useLogsListener } from "./useLogsListener";
import { useLogsStore } from "./useLogsStore";

export function BottomPanel() {
  useLogsListener();
  const isExpanded = useLogsStore((s) => s.isExpanded);
  const toggleExpanded = useLogsStore((s) => s.toggleExpanded);

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-status-strip">
        <button
          type="button"
          aria-label="Toggle logs panel"
          aria-expanded={isExpanded}
          className="bottom-panel-toggle"
          onClick={toggleExpanded}
        >
          {isExpanded ? "▾" : "▸"} Logs
        </button>
      </div>
      {isExpanded && <div className="bottom-panel-content">{<LogsPanel />}</div>}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/bottom-panel`
Expected: PASS — `useLogsStore.test.ts` (2 tests) and `BottomPanel.test.tsx` (4 tests)

- [ ] **Step 9: Restyle the bottom panel as a slim status strip + conditional content**

In `frontend/src/styles/global.css`, replace the `.bottom-panel` rule (currently at line 134):

```css
.bottom-panel {
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  display: flex;
  flex-direction: column;
}
.bottom-panel-status-strip {
  display: flex;
  align-items: center;
  padding: 2px 8px;
}
.bottom-panel-toggle {
  background: none;
  border: none;
  color: var(--color-fg-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}
.bottom-panel-toggle:hover {
  color: var(--color-fg);
}
.bottom-panel-content {
  height: 160px;
  overflow: auto;
  border-top: 1px solid var(--color-border);
}
```

- [ ] **Step 10: Run the full frontend test suite and commit**

Run: `cd frontend && npx vitest run`
Expected: PASS

```bash
git add frontend/src/features/bottom-panel frontend/src/styles/global.css
git commit -m "feat(frontend): collapse logs panel by default with a status-strip toggle"
```

---

## Task 7: Persistent left/middle divider

**Files:**
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Make the left/middle divider permanently visible**

This is a CSS-only visual change with no new testable logic (the divider's drag behavior is already covered by `useResizablePanes.test.ts`), so there's no new test to write here — following the plan's own guidance to avoid `describe("renders correctly")`-style tests that don't test behavior.

In `frontend/src/features/layout/ResizableShell.tsx`, add a distinguishing class to the left/middle divider so it can be styled independently from the middle/right one. Change:

```tsx
      <div
        className="resizable-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel"
        onPointerDown={startResizingLeft}
      />
```

to:

```tsx
      <div
        className="resizable-divider resizable-divider--persistent"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel"
        onPointerDown={startResizingLeft}
      />
```

- [ ] **Step 2: Add the persistent-line style**

In `frontend/src/styles/global.css`, add right after the `.resizable-divider:hover, .resizable-divider:active` rule (currently ending at line 92):

```css
.resizable-divider--persistent {
  background: var(--color-border);
}
.resizable-divider--persistent:hover,
.resizable-divider--persistent:active {
  background: var(--color-accent);
}
```

- [ ] **Step 3: Run the existing `ResizableShell` tests to confirm nothing broke**

Run: `cd frontend && npx vitest run src/features/layout/ResizableShell.test.tsx`
Expected: PASS — the existing "renders a resize handle between the left and middle panes" test still passes since it only checks the `aria-label`, unaffected by the added class

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/layout/ResizableShell.tsx frontend/src/styles/global.css
git commit -m "feat(frontend): make the left/middle pane divider permanently visible"
```

---

## Task 8: Conditional right pane

**Files:**
- Modify: `frontend/src/features/layout/ResizableShell.tsx`
- Modify: `frontend/src/features/layout/ResizableShell.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Replace the outdated "keeps a placeholder" test with the new conditional-rendering behavior**

In `frontend/src/features/layout/ResizableShell.test.tsx`, replace this test:

```typescript
  it("keeps the right pane (and its resize handle) present with a placeholder when no content is given", () => {
    render(
      <ResizableShell storageKey="test-shell-5" left={<div>Left</div>} middle={<div>Middle</div>} />,
    );

    expect(screen.getByTestId("resizable-pane-right")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize right panel" })).toBeInTheDocument();
  });
```

with:

```typescript
  it("omits the right pane and its resize handle entirely when no content is given", () => {
    render(
      <ResizableShell storageKey="test-shell-5" left={<div>Left</div>} middle={<div>Middle</div>} />,
    );

    expect(screen.queryByTestId("resizable-pane-right")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/layout/ResizableShell.test.tsx`
Expected: FAIL — right pane is still present (the component doesn't yet omit it)

- [ ] **Step 3: Make the right pane conditional in `ResizableShell`**

Replace `frontend/src/features/layout/ResizableShell.tsx`'s return statement's final two elements (the middle/right divider and the right pane, currently lines 30-44) — i.e. replace from the second `<div className="resizable-divider" ...>` through the closing of the right `<div className="resizable-pane resizable-pane--right" ...>` — with:

```tsx
      {right && (
        <>
          <div
            className="resizable-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onPointerDown={startResizingRight}
          />
          <div
            className="resizable-pane resizable-pane--right"
            data-testid="resizable-pane-right"
            style={{ width: rightWidth }}
          >
            {right}
          </div>
        </>
      )}
```

The full file after this change:

```tsx
import { ReactNode } from "react";
import { useResizablePanes } from "./useResizablePanes";

export interface ResizableShellProps {
  left: ReactNode;
  middle: ReactNode;
  right?: ReactNode;
  /** Overridable for tests; defaults to a single shared app-wide layout. */
  storageKey?: string;
}

export function ResizableShell({ left, middle, right, storageKey = "kafkaoxide.pane-widths" }: ResizableShellProps) {
  const { leftWidth, rightWidth, startResizingLeft, startResizingRight } = useResizablePanes({ storageKey });

  return (
    <div className="resizable-shell">
      <div className="resizable-pane resizable-pane--left" data-testid="resizable-pane-left" style={{ width: leftWidth }}>
        {left}
      </div>
      <div
        className="resizable-divider resizable-divider--persistent"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel"
        onPointerDown={startResizingLeft}
      />
      <div className="resizable-pane resizable-pane--middle" data-testid="resizable-pane-middle">
        {middle}
      </div>
      {right && (
        <>
          <div
            className="resizable-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onPointerDown={startResizingRight}
          />
          <div
            className="resizable-pane resizable-pane--right"
            data-testid="resizable-pane-right"
            style={{ width: rightWidth }}
          >
            {right}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/layout/ResizableShell.test.tsx`
Expected: PASS — all tests including the rewritten one

- [ ] **Step 5: Wire `App.tsx`'s `right` prop to the message-viewer selection**

In `frontend/src/App.tsx`, add the import:

```typescript
import { useMessageViewerStore } from "./features/workspace/useMessageViewerStore";
```

In `AppShell`, add the selector (after `const settingsOpen = ...`):

```typescript
  const hasSelectedMessage = useMessageViewerStore((s) => s.message !== null);
```

Change the `<ResizableShell ... right={<MessagePayloadViewer />} />` prop to:

```tsx
          right={hasSelectedMessage ? <MessagePayloadViewer /> : undefined}
```

- [ ] **Step 6: Update `App.test.tsx` for the conditional right pane**

Add a new test at the end of the `describe("App", ...)` block in `frontend/src/App.test.tsx`:

```typescript
  it("does not render the right pane until a message is selected", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tab_list") return Promise.resolve([]);
      if (command === "connection_list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    render(<App />);
    await screen.findByText("No connections yet. Add one to get started.");

    expect(screen.queryByTestId("resizable-pane-right")).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/App.test.tsx src/features/layout`
Expected: PASS

- [ ] **Step 8: Run the full frontend test suite and commit**

Run: `cd frontend && npx vitest run`
Expected: PASS

```bash
git add frontend/src/features/layout frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): only render the right pane when a message is selected"
```

---

## Task 9: Draggable-modal hook

**Files:**
- Create: `frontend/src/features/connections/modal/useDraggableModal.ts`
- Create: `frontend/src/features/connections/modal/useDraggableModal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/connections/modal/useDraggableModal.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDraggableModal } from "./useDraggableModal";

function pointerEventAt(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type);
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

function drag(
  start: (e: ReactPointerEvent) => void,
  startAt: [number, number],
  endAt: [number, number],
) {
  act(() => {
    start({ clientX: startAt[0], clientY: startAt[1] } as unknown as ReactPointerEvent);
  });
  act(() => {
    window.dispatchEvent(pointerEventAt("pointermove", endAt[0], endAt[1]));
  });
}

function release() {
  act(() => {
    window.dispatchEvent(new Event("pointerup"));
  });
}

describe("useDraggableModal", () => {
  it("starts at a zero offset", () => {
    const { result } = renderHook(() => useDraggableModal());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  it("tracks pointer movement as an offset delta while dragging", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);

    expect(result.current.offset).toEqual({ x: 50, y: 30 });
  });

  it("stops updating the offset after pointerup", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);
    release();
    act(() => {
      window.dispatchEvent(pointerEventAt("pointermove", 400, 400));
    });

    expect(result.current.offset).toEqual({ x: 50, y: 30 });
  });

  it("accumulates offset across multiple drags rather than resetting", () => {
    const { result } = renderHook(() => useDraggableModal());

    drag(result.current.startDragging, [100, 100], [150, 130]);
    release();
    drag(result.current.startDragging, [150, 130], [120, 130]);

    expect(result.current.offset).toEqual({ x: 20, y: 30 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/connections/modal/useDraggableModal.test.ts`
Expected: FAIL — cannot find module `./useDraggableModal`

- [ ] **Step 3: Implement the hook**

Create `frontend/src/features/connections/modal/useDraggableModal.ts`:

```typescript
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

export interface DraggableModalOffset {
  x: number;
  y: number;
}

export interface UseDraggableModalResult {
  offset: DraggableModalOffset;
  startDragging: (e: ReactPointerEvent) => void;
}

/**
 * Delta-based drag tracking for the New Connection modal's header, mirroring
 * useResizablePanes' pointer-event pattern. The modal stays centered by CSS
 * flexbox; this only ever supplies an additive `transform: translate()`
 * offset on top of that, starting fresh at (0, 0) on every mount (the modal
 * unmounts on close, so there's nothing to reset explicitly).
 */
export function useDraggableModal(): UseDraggableModalResult {
  const [offset, setOffset] = useState<DraggableModalOffset>({ x: 0, y: 0 });

  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffset: DraggableModalOffset;
  } | null>(null);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset({
        x: drag.startOffset.x + (e.clientX - drag.startClientX),
        y: drag.startOffset.y + (e.clientY - drag.startClientY),
      });
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const startDragging = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startOffset: offset };
    },
    [offset],
  );

  return { offset, startDragging };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/connections/modal/useDraggableModal.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/connections/modal/useDraggableModal.ts frontend/src/features/connections/modal/useDraggableModal.test.ts
git commit -m "feat(frontend): add useDraggableModal pointer-drag hook"
```

---

## Task 10: Apply fixed size + dragging to the New Connection modal

**Files:**
- Modify: `frontend/src/features/connections/modal/ConnectionModal.tsx`
- Modify: `frontend/src/features/connections/modal/ConnectionModal.test.tsx`
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Write the failing drag test**

In `frontend/src/features/connections/modal/ConnectionModal.test.tsx`, add near the top (jsdom has no native `PointerEvent` constructor, so — following the same workaround already used in `useResizablePanes.test.ts` — a plain `Event` is dispatched with `clientX`/`clientY` attached; `fireEvent.pointerDown` was tried first and confirmed **not** to propagate `clientX` through React's synthetic event in this project's jsdom setup, so don't use it here):

```typescript
function pointerEventAt(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}
```

Add a new test at the end of the `describe("ConnectionModal", ...)` block:

```typescript
  it("moves with the pointer when dragged by its header", () => {
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New Connection" });
    const header = screen.getByText("New Connection").closest("header") as HTMLElement;

    header.dispatchEvent(pointerEventAt("pointerdown", 100, 100));
    window.dispatchEvent(pointerEventAt("pointermove", 140, 115));

    expect(dialog).toHaveStyle({ transform: "translate(40px, 15px)" });
  });

  it("does not move when clicking inside the body, only from the header", () => {
    renderWithClient(<ConnectionModal onAdd={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New Connection" });

    screen.getByLabelText("Cluster name").dispatchEvent(pointerEventAt("pointerdown", 100, 100));
    window.dispatchEvent(pointerEventAt("pointermove", 140, 115));

    expect(dialog).toHaveStyle({ transform: "translate(0px, 0px)" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/connections/modal/ConnectionModal.test.tsx`
Expected: FAIL — the modal has no `transform` style at all yet

- [ ] **Step 3: Wire `useDraggableModal` into `ConnectionModal`**

In `frontend/src/features/connections/modal/ConnectionModal.tsx`, add the import:

```typescript
import { useDraggableModal } from "./useDraggableModal";
```

In the component body, add (after the existing `const testConnection = useTestConnection();` line):

```typescript
  const { offset, startDragging } = useDraggableModal();
```

Change the modal's root `<div className="connection-modal" ...>` to apply the transform:

```tsx
      <div
        className="connection-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New Connection"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
```

Change the header to start dragging on pointer down and show a move cursor:

```tsx
        <header className="connection-modal-header" onPointerDown={startDragging}>
          <h2>New Connection</h2>
        </header>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/connections/modal/ConnectionModal.test.tsx`
Expected: PASS — all tests including the two new ones

- [ ] **Step 5: Fix the modal to a stable height and give the header a move cursor**

In `frontend/src/styles/global.css`, replace the `.connection-modal` rule (currently at line 454):

```css
.connection-modal {
  width: 480px;
  height: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
```

Update the `.connection-modal-header` rule (currently at line 466) to add the move cursor:

```css
.connection-modal-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: move;
  touch-action: none;
}
```

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — every test file in the project

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/connections/modal/ConnectionModal.tsx frontend/src/features/connections/modal/ConnectionModal.test.tsx frontend/src/styles/global.css
git commit -m "fix(frontend): fix New Connection modal height and make it header-draggable"
```

---

## Final verification

- [ ] Run the complete frontend test suite one more time: `cd frontend && npx vitest run` — expect all tests passing.
- [ ] Run the TypeScript compiler to catch any type errors the test suite wouldn't: `cd frontend && npx tsc --noEmit`.
- [ ] Manually smoke-test via `npm run dev` from the repo root (per the project's established run command) if a display is available: open Settings via the gear, switch font family (hover-preview, then click to commit), drag the font-size slider, switch theme, collapse/expand the logs panel, drag the New Connection modal by its header and confirm it doesn't resize when switching its Properties/Security/Advanced tabs, click a message row in a topic's Data tab and confirm the right pane appears (and disappears when nothing is selected).
- [ ] Push the branch: `git push origin feature/initial-mvp`.
