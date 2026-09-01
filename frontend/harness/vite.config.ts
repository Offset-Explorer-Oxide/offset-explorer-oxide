import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, ".."),
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
