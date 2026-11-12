import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        base: v("bg"),
        surface: v("surface"),
        card: v("card"),
        elevated: v("elevated"),
        line: v("line"),
        "line-strong": v("line-strong"),
        fg: v("fg"),
        muted: v("muted"),
        subtle: v("subtle"),
        accent: { DEFAULT: v("accent"), soft: v("accent-soft"), fg: v("accent-fg") },
        lavender: v("lavender"),
        cyan: v("cyan"),
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        info: v("info"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: {
        card: "0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px rgb(0 0 0 / 0.25), 0 8px 24px -12px rgb(0 0 0 / 0.45)",
        pop: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 20px 50px -12px rgb(0 0 0 / 0.6)",
        focus: "0 0 0 3px rgb(var(--accent) / 0.25)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulseRing: { "0%": { transform: "scale(0.8)", opacity: "0.7" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: { shimmer: "shimmer 1.6s infinite", "pulse-ring": "pulseRing 1.8s cubic-bezier(0.2,0.6,0.3,1) infinite" },
    },
  },
  plugins: [],
} satisfies Config;
