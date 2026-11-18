import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'api/status.ts', outDir: 'smoke/dist-live/status', emptyOutDir: true, target: 'node20', minify: false } })
