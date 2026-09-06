import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#121214",
          800: "#1c1c1f",
          700: "#2a2a2e",
          600: "#3d3d42",
        },
        warm: {
          50: "#faf9f6",
          100: "#f3f1ea",
        },
        stone: {
          200: "#e4e2dd",
          300: "#cfccc4",
          400: "#a6a29a",
          500: "#7c786f",
        },
        accent: {
          DEFAULT: "#b3966a",
          light: "#d8c4a0",
          dark: "#8a7048",
        },
      },
      fontFamily: {
        serif: ["'Cormorant Garamond'", "Georgia", "'Times New Roman'", "serif"],
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
      },
      letterSpacing: {
        widest2: "0.2em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,10,11,0.06), 0 8px 24px rgba(10,10,11,0.06)",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
