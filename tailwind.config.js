/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#08090f', 900: '#0b0d15', 850: '#0f121c', 800: '#141824', 700: '#1b2030', 600: '#252c40' },
        neon: { lime: '#c6f24e', green: '#8bff5a', teal: '#2ef2c0', cyan: '#3ad7ff', violet: '#a06bff', pink: '#ff4fa3' },
        gold: '#ffcf5c',
      },
      fontFamily: {
        display: ['"Sora"', '"Inter"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        num: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(198,242,78,.25), 0 8px 30px -8px rgba(198,242,78,.45)',
        card: '0 18px 40px -20px rgba(0,0,0,.9)',
        pop: '0 30px 80px -30px rgba(0,0,0,1)',
      },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulseGlow: { '0%,100%': { opacity: '.45' }, '50%': { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        popIn: { from: { opacity: '0', transform: 'scale(.94)' }, to: { opacity: '1', transform: 'scale(1)' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        rise: 'rise .5s cubic-bezier(.22,1,.36,1) both',
        popIn: 'popIn .28s cubic-bezier(.22,1,.36,1) both',
        marquee: 'marquee 34s linear infinite',
      },
    },
  },
  plugins: [],
}
