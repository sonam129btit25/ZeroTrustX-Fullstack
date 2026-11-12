import { useEffect, useState } from "react";

const KEYS = ["accent", "lavender", "cyan", "success", "warning", "danger", "muted", "subtle", "line", "fg", "card", "elevated"] as const;
export type ThemeColors = Record<(typeof KEYS)[number], string>;

function read(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(KEYS.map((k) => [k, `rgb(${cs.getPropertyValue(`--${k}`).trim().split(/\s+/).join(",")})`])) as ThemeColors;
}

/** Resolved theme colours for SVG/canvas consumers (Recharts), updated when the theme changes. */
export function useThemeColors(): ThemeColors {
  const [c, setC] = useState<ThemeColors>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return c;
}

export function alpha(rgb: string, a: number) {
  return rgb.replace("rgb(", "rgba(").replace(")", `,${a})`);
}
