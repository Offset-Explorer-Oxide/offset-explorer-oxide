# Workspace UI Polish — Design Spec

Date: 2026-08-19

## Motivation

The current workspace UI has several rough edges reported directly by the user:

- Tabs can't be closed, and the tab bar reads as visually cramped.
- Theme switching lives as swatch buttons in the header with no clear "currently selected" indicator and no room to grow (e.g. font preferences).
- The logs panel is always rendered with no way to collapse it.
- The boundary between the left (connection tree) and middle (detail) panes is invisible until hovered, making the layout feel unstructured.
- The right pane (message payload viewer) is always rendered even when there's nothing to show, wasting space.
- There's no place to configure font size/family, and no settings surface at all.

This spec covers UI/UX and state-management changes only — no backend (Rust/Tauri command) changes are required. Every capability referenced already exists as a Tauri command or store; this is a frontend-only pass.

## Scope

In scope:
1. Tab bar: close button, larger sizing.
2. A new Settings surface (client-side pseudo-tab) with theme + font preferences.
3. Logs panel: collapsed-by-default with a persistent toggle.
4. A permanently visible left/middle pane divider.
5. Conditional rendering of the right pane based on message selection.
6. New Connection modal: fixed size (stop resizing/repositioning on tab switch) and header-draggable.

Out of scope (explicitly not requested): font preferences beyond family/size (no weight/line-height controls), a settings modal, changes to the middle/right divider's hover-only behavior, any backend/database changes, mobile/responsive layout changes.

## 1. Tab bar

**Current state** (`frontend/src/features/tabs/TabBar.tsx`, `useTabsStore.ts`): renders tabs with `loadTabs`/`addTab`/`renameTab`/`selectTab` actions. No `deleteTab` action exists in the store, even though the backend already exposes `tab_delete` (registered in `src-tauri/src/main.rs`, wired to `commands::tabs::tab_delete`) and `frontend/src/lib/tauri.ts` likely already has (or needs) an `api.deleteTab` wrapper matching the other tab API calls. CSS today (`global.css`): `.tab { padding: 2px 8px; }`, `.tab-bar { display: flex; gap: 4px; }`, no explicit font-size (inherits the 13px base).

**Changes:**
- Add `deleteTab(id)` to `useTabsStore`, calling the existing `api.deleteTab` (adding the wrapper in `lib/tauri.ts` if it isn't already there) and removing the tab from local state on success.
- Add an always-visible `×` close button to each rendered tab (not hover-only), wired to `deleteTab`. Clicking it must not also trigger tab selection (stop propagation).
- If the closed tab was the active tab, selection falls back to the nearest remaining tab (previous, or next if none before it), or to no selection if it was the last tab.
- Increase tab sizing: `padding: 6px 14px`, `font-size: 14px`.

## 2. Settings (new tab, gear icon)

**Entry point:** A gear icon replaces the current inline theme-swatch buttons in the app header (`App.tsx`). Clicking it opens/activates a client-side-only "Settings" pseudo-tab.

**Pseudo-tab mechanics:** Unlike regular tabs (backed by `tab_create`/`tab_list`/DB persistence), the Settings tab is not persisted to the backend. It's a special tab id (e.g. `"__settings__"`) that:
- Is inserted into the same visual tab strip as regular tabs when opened.
- Renders a `<SettingsPanel>` in the middle pane instead of connection/cluster content, keyed off this special id in the same place `App.tsx` currently branches on `useWorkspaceSelectionStore`.
- Can be closed via the same new `×` button (removing it from local tab-bar state only — no backend call, since it was never created via `tab_create`).
- Re-clicking the gear icon while it's open just re-selects/re-activates it rather than duplicating it.

**Settings panel contents:**

*Theme dropdown* — replaces the swatch buttons entirely. Lists the existing themes from `themes.ts` (`zed-dark`, `zed-light`, `ayu-dark`). The currently active theme (per `useThemeStore`'s `appliedThemeId`) shows a checkmark next to its label. Selecting a different option calls the same `setTheme`-equivalent action the swatches used to call — applies immediately, no separate save step (matches existing behavior, just a new UI over the same store).

*Font style dropdown* — a curated list (not free text): System UI, Inter, JetBrains Mono, Menlo (exact final list confirmed during implementation, constrained to fonts safe to assume are present via common web-safe/system fallback stacks). Hovering an option live-previews it immediately by setting `--font-family-base` on `document.documentElement` for the duration of the hover; moving away without clicking reverts to the persisted value. Clicking commits the selection to `usePreferencesStore` (see below).

*Font size control* — numeric slider, range 11–18px, step 1px. Dragging live-updates `--font-size-base` on `document.documentElement` immediately (no separate apply step); the value is committed to `usePreferencesStore` continuously as it changes (not just on release), consistent with "should automatically change."

## 3. Preferences persistence

New `usePreferencesStore` (zustand), following the exact pattern already used by `useThemeStore` and `useResizablePanes` (manual `localStorage` read/write via a `STORAGE_KEY` constant — no new persistence library, no zustand `persist` middleware, matching established codebase convention). Holds `{ fontFamily: string; fontSizePx: number }`, defaulting to a system-safe stack and 13px (today's base) if nothing is stored yet. Every change (dropdown selection, slider drag) writes through to `localStorage` immediately — there is no explicit "Save" button anywhere in this feature.

A new `PreferencesProvider` component (mirroring the existing `ThemeProvider` pattern that sets `data-theme` on `document.documentElement`) applies `--font-family-base` and `--font-size-base` as CSS custom properties on `:root` whenever the store changes. `global.css`'s hardcoded per-selector font sizes/families are not all migrated in this pass — only the base/body font declarations are switched to reference the new variables, so the preference has visible, global effect without requiring a full CSS audit.

## 4. Logs panel

**Current state** (`frontend/src/features/bottom-panel/{BottomPanel.tsx,useLogsStore.ts,LogsPanel.tsx}`): unconditionally rendered, fixed `height: 160px`, no visibility state at all.

**Changes:**
- Add `isExpanded: boolean` to `useLogsStore`, persisted to `localStorage` the same way theme is, defaulting to `false` (collapsed).
- `BottomPanel` always renders a slim status strip (Zed-editor-style) containing a toggle icon/button; the full `LogsPanel` content only renders when `isExpanded` is `true`. Clicking the icon toggles `isExpanded`.

## 5. Pane dividers

`ResizableShell.tsx`'s left/middle divider (`.resizable-divider`, currently `background: transparent` except on `:hover`/`:active`) gets a permanently visible 1px line using `var(--color-border)`, in addition to its existing hover/active accent-color behavior for drag affordance. The middle/right divider is unchanged (stays hover-only).

## 6. Right pane (message payload viewer)

**Current state:** `App.tsx` always renders `<MessagePayloadViewer />` as the third pane in `ResizableShell`, regardless of `useMessageViewerStore` state.

**Change:** The third pane (and its divider) is only included in `ResizableShell`'s rendered panes when `useMessageViewerStore` has a selected message. When no message is selected, the middle pane expands to fill the freed space — this requires `ResizableShell` to support a variable number of panes (two vs. three) rather than always assuming three and hiding the third with CSS, so the width is actually reclaimed rather than left blank.

## 7. New Connection modal — fixed size + draggable

**Root cause of the current bug:** `.connection-modal` (`global.css:454-465`) has a fixed `width: 480px` but no explicit `height` — only a `max-height: calc(100vh - 64px)` cap. Its actual height is intrinsic, sized by whichever tab's content is currently mounted (`ConnectionTabsView.tsx` swaps exactly one tab panel in and out of the DOM at a time, and content height varies sharply: `PropertiesTab` has several sections, `SecurityTab` currently has just one dropdown). Because `.connection-modal-overlay` centers the modal via `align-items: center; justify-content: center` on a full-viewport fixed overlay (`global.css:444-452`), a height change on tab switch also shifts the modal's vertical position — that's the reported "size and position changes."

**Fix:**
- Give `.connection-modal` a fixed `height` (560px), still capped by the existing `max-height` for small viewports. `.connection-modal-body` already has `overflow-y: auto` (`global.css:494-498`), so a tab whose content exceeds the available space scrolls internally instead of growing the modal — satisfying "content inside the modal should resize, not the entire modal."
- Add dragging via a new `useDraggableModal` hook, following the same delta-based pointer-tracking pattern already established by `useResizablePanes.ts` for pane-width dragging (no new dependency). It tracks an `{x, y}` offset from `(0, 0)`, applied via `transform: translate(x, y)` on `.connection-modal`. Dragging activates **only** via `onPointerDown` on `.connection-modal-header` (confirmed with user — header only, not the whole modal body), which gets `cursor: move`. The offset resets to `(0, 0)` (re-centered) each time the modal reopens — free, since `ConnectionModal` already unmounts/remounts on close/open (`{showModal && <ConnectionModal ... />}` in `App.tsx`), so hook state naturally resets.

## Testing

Following this repo's established TDD discipline:
- `useTabsStore`'s new `deleteTab` action: unit test covering successful delete + fallback selection logic (previous/next/none).
- `usePreferencesStore`: unit tests for default values, persistence round-trip (write then reload from `localStorage`), and update behavior.
- `useLogsStore`'s new `isExpanded` toggle: unit test for default `false` and toggle behavior.
- `ResizableShell`: test that it renders two panes (no divider/right pane) when the third pane is omitted, and three when present.
- Component tests for the new `SettingsPanel` (theme checkmark rendering, hover-preview behavior, font size slider committing to the store) using React Testing Library, following the existing `userEvent` + jsdom patterns already used elsewhere in the test suite.
- `useDraggableModal`: unit tests for offset math on synthetic PointerEvents (same style as `useResizablePanes.test.ts`), and that it resets to `(0, 0)` on each fresh mount.
