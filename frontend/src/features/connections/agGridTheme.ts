import { themeQuartz } from "ag-grid-community";

/**
 * Maps every color/sizing param to the app's own theme CSS variables (see
 * styles/themes.css) instead of AG Grid's built-in light palette, so every
 * grid in the app follows whichever theme is active — including live
 * switches — without any extra JS wiring, and a denser layout than AG
 * Grid's spacious default to match the rest of the app's compact UI.
 */
export const APP_GRID_THEME = themeQuartz.withParams({
  backgroundColor: "var(--color-bg)",
  foregroundColor: "var(--color-fg)",
  borderColor: "var(--color-border)",
  headerBackgroundColor: "var(--color-bg-elevated)",
  headerTextColor: "var(--color-fg-muted)",
  rowHoverColor: "var(--color-bg-elevated)",
  accentColor: "var(--color-accent)",
  spacing: 4,
  fontSize: 12,
  headerFontSize: 12,
  dataFontSize: 12,
  rowHeight: 28,
  headerHeight: 32,
  iconSize: 14,
});
