import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * BASE_PATH lets the same build target a domain root ("/") or a GitHub Pages
 * project subpath ("/shoppa/"). The deploy workflow sets it automatically.
 */
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
})
