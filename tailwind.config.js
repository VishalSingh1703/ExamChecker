/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Warm paper-and-ink neutrals (replaces zinc)
        ink: {
          50: '#faf6ee',
          100: '#f2ecdf',
          200: '#e5dcc9',
          300: '#d0c5ad',
          400: '#a2967f',
          500: '#837763',
          600: '#695f4e',
          700: '#4f4739',
          800: '#352f26',
          900: '#211d17',
          950: '#14110d',
        },
        // Pine-green chalkboard accent (replaces purple)
        accent: {
          50: '#f2f7f3',
          100: '#e0ece3',
          200: '#c2d9c9',
          300: '#98bea6',
          400: '#6a9d7e',
          500: '#4a815f',
          600: '#38674b',
          700: '#2e533e',
          800: '#274334',
          900: '#20372b',
          950: '#101e17',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        hand: ['Caveat', 'cursive'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        // Soft paper shadow for cards
        card: '0 1px 2px rgba(33,29,23,0.05), 0 3px 10px rgba(33,29,23,0.05)',
        // Hard offset shadow — letterpress / index-card feel
        lift: '3px 3px 0 0 rgba(33,29,23,0.10)',
        'lift-sm': '2px 2px 0 0 rgba(33,29,23,0.10)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'stamp-in': {
          '0%': { opacity: '0', transform: 'scale(1.6) rotate(-14deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-6deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out both',
        'stamp-in': 'stamp-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) both',
      },
    },
  },
  plugins: [],
}
