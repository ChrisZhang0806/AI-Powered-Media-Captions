/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#fdf8fd',
        surface: '#fdf8fd',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f7f2f8',
        'surface-container': '#f1ecf2',
        'surface-container-high': '#ebe7ec',
        'surface-container-highest': '#e5e1e7',
        'surface-variant': '#e5e1e7',
        'on-surface': '#1c1b1f',
        'on-surface-variant': '#494551',
        outline: '#7a7582',
        'outline-variant': '#cbc4d2',
        primary: '#4f378a',
        'primary-container': '#6750a4',
        'primary-fixed': '#e9ddff',
        'primary-fixed-dim': '#cfbcff',
        'on-primary': '#ffffff',
        'on-primary-fixed': '#22005d',
        tertiary: '#633b48',
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
      },
      borderRadius: {
        '2xl': '28px',
      },
      fontFamily: {
        sans: ['AvenirNextCyr', 'Avenir Next Cyr', 'Avenir Next', 'PingFang SC', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
