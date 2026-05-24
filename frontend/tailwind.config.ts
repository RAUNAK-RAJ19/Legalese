import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111111',
        panel: '#171717',
        panelSoft: '#1f1f1f',
        line: '#2b2b2b',
        accent: '#e6e6e6',
        accentSoft: '#bcbcbc'
      },
      boxShadow: {
        glow: '0 20px 80px rgba(255,255,255,0.08)'
      }
    }
  },
  plugins: []
} satisfies Config;
