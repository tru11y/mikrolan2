import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0b10',
        surface: '#15151d',
        surface2: '#1d1d28',
        border: '#2a2a38',
        primary: '#7c5cff',
        'primary-dim': '#5b43c4',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        muted: '#8a8a9a',
        fg: '#f2f2f7',
      },
      borderRadius: { xl: '1rem', '2xl': '1.25rem' },
    },
  },
  plugins: [],
};
export default config;
