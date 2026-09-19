import { KeyboardEvent as ReactKeyboardEvent, ReactElement, useRef } from "react";
import { ThemeKind, themeKind, themesOfKind } from "./themes";
import { useThemeStore } from "./useThemeStore";

/**
 * Arrow-key navigation within a `radiogroup`, with a roving tabindex.
 *
 * `role="radio"` promises this — a screen-reader user reaches the group with
 * Tab and then moves *within* it with the arrows, which is also why only the
 * checked option is tabbable. Moving focus also selects, as native radios do,
 * so every option here applies its theme the moment it is reached: the point
 * of this picker is that you see the answer while choosing.
 */
function useRovingRadios(ids: string[], select: (id: string) => void) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    const index = ids.indexOf(id);
    if (index < 0) return;
    // Wraps, as a native radio group does.
    const next = ids[(index + (forward ? 1 : ids.length - 1)) % ids.length];
    select(next);
    refs.current[next]?.focus();
  }

  return {
    onKeyDown,
    register: (id: string) => (el: HTMLButtonElement | null) => {
      refs.current[id] = el;
    },
  };
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.13 1.13M11.67 11.67l1.13 1.13M12.8 3.2l-1.13 1.13M4.33 11.67L3.2 12.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// React 19 removed the global `JSX` namespace; it now lives under `React.JSX`.
const KINDS: { kind: ThemeKind; label: string; icon: ReactElement }[] = [
  { kind: "light", label: "Light", icon: <SunIcon /> },
  { kind: "dark", label: "Dark", icon: <MoonIcon /> },
];

/**
 * A miniature of what a theme looks like, painted in that theme's own colors.
 *
 * `data-theme` on this element pulls the whole palette in from `themes.css`
 * (whose blocks are attribute-scoped rather than `:root`-scoped precisely so
 * this works), so the swatch cannot disagree with what applying the theme
 * actually does — the alternative, a copy of each palette in TypeScript, is a
 * second source of truth that drifts the first time a colour is tweaked.
 */
function ThemeSwatch({ themeId }: { themeId: string }) {
  return (
    <span className="theme-swatch" data-theme={themeId} aria-hidden="true">
      <span className="theme-swatch__sidebar" />
      <span className="theme-swatch__body">
        <span className="theme-swatch__line theme-swatch__line--accent" />
        <span className="theme-swatch__line" />
      </span>
    </span>
  );
}

export interface ThemePickerProps {
  /** Rendered inside the bottom panel's popover, where space is tighter than in Settings. */
  compact?: boolean;
}

/**
 * The app's theme picker: a Light/Dark switch, then the themes of whichever
 * side is showing.
 *
 * Two controls rather than one flat list of nine names because "light or
 * dark" and "which light theme" are different decisions made at different
 * times — the first is the one people actually want most of the time, and a
 * dropdown listing `Gruvbox Light Soft` next to `Ayu Dark` made it the
 * fiddliest of the nine. Picking a side also *previews* itself immediately:
 * clicking Light applies a light theme rather than only filtering the list
 * below, so the window is already showing the answer to the question being
 * asked.
 */
export function ThemePicker({ compact = false }: ThemePickerProps) {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);
  const setApplied = useThemeStore((s) => s.setApplied);
  const setKind = useThemeStore((s) => s.setKind);
  const activeKind = themeKind(appliedThemeId);
  const kindIds = KINDS.map((k) => k.kind);
  const kindNav = useRovingRadios(kindIds, (id) => setKind(id as ThemeKind));
  const themes = themesOfKind(activeKind);
  const themeNav = useRovingRadios(
    themes.map((theme) => theme.id),
    setApplied,
  );

  return (
    <div className={`theme-picker${compact ? " theme-picker--compact" : ""}`}>
      <div className="theme-kind-switch" role="radiogroup" aria-label="Light or dark">
        {KINDS.map(({ kind, label, icon }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            ref={kindNav.register(kind)}
            aria-checked={activeKind === kind}
            tabIndex={activeKind === kind ? 0 : -1}
            className={`theme-kind-button${activeKind === kind ? " theme-kind-button--active" : ""}`}
            onClick={() => setKind(kind)}
            onKeyDown={(e) => kindNav.onKeyDown(e, kind)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="theme-list" role="radiogroup" aria-label={`${activeKind === "light" ? "Light" : "Dark"} themes`}>
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            ref={themeNav.register(theme.id)}
            aria-checked={appliedThemeId === theme.id}
            tabIndex={appliedThemeId === theme.id ? 0 : -1}
            className={`theme-option${appliedThemeId === theme.id ? " theme-option--active" : ""}`}
            onClick={() => setApplied(theme.id)}
            onKeyDown={(e) => themeNav.onKeyDown(e, theme.id)}
          >
            <ThemeSwatch themeId={theme.id} />
            <span className="theme-option__label">{theme.label}</span>
            {appliedThemeId === theme.id && (
              <span className="theme-option__check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
