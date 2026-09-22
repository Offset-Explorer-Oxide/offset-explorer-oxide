import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, ".."),
  // The harness shares the app's root, so by default it would also share the
  // app's dependency cache at `frontend/node_modules/.vite` — and it does not
  // share the app's config (the aliases below swap the Tauri modules for
  // stubs). Running the harness therefore invalidated the app's optimized
  // deps, and the next `npm run dev` served a cache mid-re-optimization with
  // imports that would not resolve. Its own cache directory keeps the two
  // from ever touching.
  cacheDir: resolve(__dirname, ".vite-cache"),
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": resolve(__dirname, "stub-core.ts"),
      "@tauri-apps/api/event": resolve(__dirname, "stub-event.ts"),
      "@tauri-apps/api/window": resolve(__dirname, "stub-window.ts"),
      "@tauri-apps/plugin-dialog": resolve(__dirname, "stub-dialog.ts"),
    },
  },
  server: { port: 1500, strictPort: true },
});
