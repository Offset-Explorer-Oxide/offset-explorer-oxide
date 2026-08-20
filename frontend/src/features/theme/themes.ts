export interface ThemeDef {
  id: string;
  label: string;
  kind: "light" | "dark";
}

export const THEMES: ThemeDef[] = [
  { id: "zed-dark", label: "Zed Dark", kind: "dark" },
  { id: "zed-light", label: "Zed Light", kind: "light" },
  { id: "ayu-dark", label: "Ayu Dark", kind: "dark" },
  { id: "one-light", label: "One Light", kind: "light" },
  { id: "one-dark", label: "One Dark", kind: "dark" },
  { id: "gruvbox-light-soft", label: "Gruvbox Light Soft", kind: "light" },
  { id: "gruvbox-light-hard", label: "Gruvbox Light Hard", kind: "light" },
  { id: "gruvbox-dark-soft", label: "Gruvbox Dark Soft", kind: "dark" },
  { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard", kind: "dark" },
];

export const DEFAULT_THEME_ID = "zed-dark";
