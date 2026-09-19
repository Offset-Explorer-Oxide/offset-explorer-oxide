import { useEffect, useRef, useState } from "react";
import { ThemePicker } from "./ThemePicker";
import { themeKind } from "./themes";
import { useThemeStore } from "./useThemeStore";

/** A painter's palette — the one glyph that reads as "appearance" rather than as "settings". */
function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.6a6.4 6.4 0 0 0 0 12.8c.72 0 1.2-.5 1.2-1.1 0-.32-.14-.58-.33-.8-.2-.22-.33-.5-.33-.8 0-.6.5-1.1 1.1-1.1h1.3a3.46 3.46 0 0 0 3.46-3.46C14.4 4.06 11.53 1.6 8 1.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="4.9" cy="7.6" r="0.95" fill="currentColor" />
      <circle cx="6.6" cy="4.8" r="0.95" fill="currentColor" />
      <circle cx="9.9" cy="4.6" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * The status strip's theme control: a palette icon that opens the same
 * [`ThemePicker`] Settings shows.
 *
 * Changing theme is a look-at-it-and-decide action — you try one, see the
 * window repaint, and try the next — and routing that through Settings meant
 * opening a tab that covered the very thing being judged. From down here the
 * app stays on screen while the picker is open.
 */
export function ThemeMenuButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-menu" ref={rootRef}>
      <button
        type="button"
        ref={toggleRef}
        className="bottom-panel-toggle theme-menu__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Theme: ${themeKind(appliedThemeId) === "light" ? "light" : "dark"}`}
        title="Theme"
        onClick={() => setOpen((v) => !v)}
      >
        <PaletteIcon />
      </button>
      {open && (
        // Anchored upwards from the strip, which sits on the bottom edge of
        // the window — a menu opening downwards from here has nowhere to go.
        <div className="theme-menu__popover" role="dialog" aria-label="Theme">
          <ThemePicker compact />
        </div>
      )}
    </div>
  );
}
