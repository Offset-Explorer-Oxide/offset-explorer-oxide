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
  { id: "fira-code", label: "Fira Code", cssValue: '"Fira Code", Menlo, Consolas, monospace' },
  { id: "source-code-pro", label: "Source Code Pro", cssValue: '"Source Code Pro", Menlo, Consolas, monospace' },
  { id: "roboto-mono", label: "Roboto Mono", cssValue: '"Roboto Mono", Menlo, Consolas, monospace' },
  { id: "georgia", label: "Georgia", cssValue: 'Georgia, "Times New Roman", serif' },
];

export const DEFAULT_FONT_FAMILY_ID = "system-ui";

export const MIN_FONT_SIZE_PX = 11;
export const MAX_FONT_SIZE_PX = 18;
export const DEFAULT_FONT_SIZE_PX = 13;

/** Curated stops shown in the Settings font-size dropdown, MIN through MAX inclusive. */
export const FONT_SIZE_OPTIONS_PX: number[] = Array.from(
  { length: MAX_FONT_SIZE_PX - MIN_FONT_SIZE_PX + 1 },
  (_, i) => MIN_FONT_SIZE_PX + i,
);

export function fontFamilyCssValue(id: string): string {
  return FONT_FAMILIES.find((f) => f.id === id)?.cssValue ?? FONT_FAMILIES[0].cssValue;
}
