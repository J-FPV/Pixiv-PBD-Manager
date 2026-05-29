import { useEffect, useState } from "react";
import type { ThemeMode } from "../types";

export type EffectiveTheme = Exclude<ThemeMode, "system">;

const readSystemTheme = (): EffectiveTheme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

// Resolves the active theme from the user's preference and the OS setting, and
// applies it to the document element. "system" tracks the OS via a media query.
export function useTheme(themeMode: ThemeMode): EffectiveTheme {
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => readSystemTheme());
  const effectiveTheme: EffectiveTheme = themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    updateTheme();
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  return effectiveTheme;
}
