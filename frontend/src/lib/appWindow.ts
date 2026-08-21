import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Closes the app's only window — on desktop, this quits the app. Thin wrapper so callers can mock it in tests. */
export function closeAppWindow(): Promise<void> {
  return getCurrentWindow().close();
}

/**
 * Subscribes to the OS window gaining/losing focus (minimized, alt-tabbed
 * away, etc.) — the real signal, unlike the DOM's `visibilitychange`/
 * `window.blur`, which WebView2 (Tauri's Windows webview) doesn't reliably
 * fire when the window loses *OS* focus while still technically "visible".
 * Thin wrapper so callers can mock it in tests.
 */
export function onWindowFocusChanged(handler: (focused: boolean) => void): Promise<UnlistenFn> {
  return getCurrentWindow().onFocusChanged((event) => handler(event.payload));
}
