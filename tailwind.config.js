/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        jarvis: {
          cyan: '#00f0ff',
          blue: '#0077ff',
          dark: '#030b14',
          panel: 'rgba(4, 20, 36, 0.75)',
          panelBorder: 'rgba(0, 240, 255, 0.35)',
          glow: 'rgba(0, 240, 255, 0.6)',
          orange: '#ff8800',
          red: '#ff3344',
          green: '#00ffaa'
        }
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', 'monospace', 'Consolas', 'Courier New'],
        orbitron: ['Orbitron', 'sans-serif', 'system-ui']
      },
      boxShadow: {
        'jarvis-glow': '0 0 25px rgba(0, 240, 255, 0.45)',
        'jarvis-glow-lg': '0 0 45px rgba(0, 240, 255, 0.7)',
        'jarvis-glow-orange': '0 0 25px rgba(255, 136, 0, 0.5)'
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 20s linear infinite',
        'spin-reverse': 'spin 25s linear infinite reverse',
        'scan': 'scan 4s linear infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' }
        }
      }
    },
  },
  plugins: [],
}
