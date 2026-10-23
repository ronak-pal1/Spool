import type { Config } from 'tailwindcss';

export default {
  content: ['./popup.html', './recorder.html', './permissions.html', './camera.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#050607',
          900: '#08090B',
          850: '#0C0D10',
          800: '#111317',
          750: '#15181D',
          700: '#1B1E24',
          600: '#252930',
          500: '#30353E',
          400: '#4A505B',
        },
        accent: {
          DEFAULT: '#00FA9A',
          300: '#33FBAE',
          400: '#00FA9A',
          500: '#00D884',
          600: '#00A866',
          foreground: '#00140B',
        },
        danger: { DEFAULT: '#FF5C6C', soft: 'rgba(255,92,108,0.12)' },
        warn: { DEFAULT: '#FFB547', soft: 'rgba(255,181,71,0.12)' },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(0,250,154,0.35), 0 0 28px -6px rgba(0,250,154,0.55)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.8)',
        pop: '0 0 0 1px rgba(255,255,255,0.08), 0 24px 64px -16px rgba(0,0,0,0.85)',
      },
      backgroundImage: {
        'accent-radial': 'radial-gradient(60% 60% at 50% 0%, rgba(0,250,154,0.16) 0%, rgba(0,250,154,0) 70%)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
