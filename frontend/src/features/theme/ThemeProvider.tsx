import { useEffect } from "react";
import { useThemeStore } from "./useThemeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const appliedThemeId = useThemeStore((s) => s.appliedThemeId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appliedThemeId);
  }, [appliedThemeId]);

  return <>{children}</>;
}
