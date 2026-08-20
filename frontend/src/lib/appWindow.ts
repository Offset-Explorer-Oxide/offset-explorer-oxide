import { getCurrentWindow } from "@tauri-apps/api/window";

/** Closes the app's only window — on desktop, this quits the app. Thin wrapper so callers can mock it in tests. */
export function closeAppWindow(): Promise<void> {
  return getCurrentWindow().close();
}
