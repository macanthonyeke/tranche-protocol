/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (backed by CSS variables in index.css)
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        "bg-deep": "rgb(var(--c-bg-deep) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-strong": "rgb(var(--c-surface-strong) / <alpha-value>)",
        "surface-solid": "rgb(var(--c-surface-solid) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        "fg-strong": "rgb(var(--c-fg-strong) / <alpha-value>)",
        "fg-soft": "rgb(var(--c-fg-soft) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        "muted-soft": "rgb(var(--c-muted-soft) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          soft: "rgb(var(--c-accent-soft) / <alpha-value>)",
          deep: "rgb(var(--c-accent-deep) / <alpha-value>)",
          fg: "rgb(var(--c-accent-fg) / <alpha-value>)",
        },
        warn: {
          DEFAULT: "rgb(var(--c-warn) / <alpha-value>)",
          soft: "rgb(var(--c-warn-soft) / <alpha-value>)",
        },
        ok: {
          DEFAULT: "rgb(var(--c-ok) / <alpha-value>)",
          soft: "rgb(var(--c-ok-soft) / <alpha-value>)",
        },
        bad: {
          DEFAULT: "rgb(var(--c-bad) / <alpha-value>)",
          soft: "rgb(var(--c-bad-soft) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--c-gold) / <alpha-value>)",
          soft: "rgb(var(--c-gold-soft) / <alpha-value>)",
        },
        // Legacy aliases (some components still reference these)
        ink: {
          950: "rgb(var(--c-bg-deep) / <alpha-value>)",
          900: "rgb(var(--c-bg) / <alpha-value>)",
          800: "rgb(var(--c-surface) / <alpha-value>)",
          700: "rgb(var(--c-surface-strong) / <alpha-value>)",
          600: "rgb(var(--c-line) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ['"Clash Display"', "ui-sans-serif", "system-ui"],
        sans: ['"Satoshi"', "ui-sans-serif", "system-ui"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0,229,255,0.18), 0 12px 60px -20px rgba(0,229,255,0.35)",
        amber: "0 0 0 1px rgba(212,168,87,0.25), 0 12px 60px -20px rgba(212,168,87,0.45)",
        lift: "0 10px 40px -16px rgba(15, 23, 42, 0.18)",
      },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(0,229,255,0.45)" },
          "100%": { boxShadow: "0 0 0 14px rgba(0,229,255,0)" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
      },
    },
  },
  plugins: [],
};
