"use client";

import { useEffect } from "react";
import { useBdb } from "@/lib/store";

const accents: Record<string, string> = { "obsidian-gold": "#d3a84b", ocean: "#55a7c9", forest: "#65a779", clay: "#c47f62", slate: "#8897ad" };

export function ThemeRuntime() {
  const { state } = useBdb(); const theme = state.theme;
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const accent = theme.preset === "custom" ? theme.accentColor : accents[theme.preset] ?? theme.accentColor;
      root.style.setProperty("--gold", accent);
      root.style.setProperty("--gold-light", `color-mix(in srgb, ${accent} 72%, white)`);
      root.style.setProperty("--gold-faint", `color-mix(in srgb, ${accent} 12%, transparent)`);
      root.style.setProperty("--text-scale", String(theme.textScale));
      root.dataset.themeMode = theme.mode === "system" ? media.matches ? "light" : "dark" : theme.mode;
      root.dataset.density = theme.density;
      root.dataset.font = theme.fontFamily;
      root.classList.toggle("high-contrast", theme.highContrast);
      root.classList.toggle("reduce-motion", theme.reducedMotion);
    };
    apply(); media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      delete root.dataset.themeMode;
      delete root.dataset.density;
      delete root.dataset.font;
      root.classList.remove("high-contrast", "reduce-motion");
      ["--gold", "--gold-light", "--gold-faint", "--text-scale"].forEach((property) => root.style.removeProperty(property));
    };
  }, [theme]);
  return null;
}
