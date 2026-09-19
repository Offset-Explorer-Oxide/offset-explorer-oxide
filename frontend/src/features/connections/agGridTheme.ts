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
  // Marks the row whose payload is open in the right pane. Mixed from the
  // theme's own accent rather than picked per theme, so it reads as a
  // highlight against both the light and the dark palettes in themes.css —
  // and kept translucent enough that the row's text stays legible on top of
  // it. AG Grid's Quartz default derives this from `accentColor` too, but at
  // a tint so faint it was indistinguishable from an unselected row.
  selectedRowBackgroundColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
  spacing: 4,
  // Typography comes from the app's own scale and font setting rather than
  // fixed pixels, so Settings -> Appearance moves the Data tab grid too. The
  // grid is most of the middle pane, and it used to be the largest surface
  // the font settings did not reach.
  fontFamily: "var(--font-family-base)",
  fontSize: "var(--font-size-sm)",
  headerFontSize: "var(--font-size-sm)",
  dataFontSize: "var(--font-size-sm)",
  // Row and header heights have to grow with the text or a larger font is
  // simply clipped. The multipliers are the old fixed heights over the old
  // 12px cell font (28/12, 32/12), so the default size renders as before.
  rowHeight: "calc(var(--font-size-sm) * 2.33)",
  headerHeight: "calc(var(--font-size-sm) * 2.67)",
  iconSize: "var(--font-size-lg)",
});
