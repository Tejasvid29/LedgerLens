import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14161A',
        paper: '#F5F6F4',
        rule: '#D8DBD5',
        ledgerGreen: '#1F6F4A',
        oxblood: '#A32C21',
        indigo: '#2B4C7E',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter-tight)', 'Inter Tight', 'system-ui', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
