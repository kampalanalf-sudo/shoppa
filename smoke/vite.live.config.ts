import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/live.ts', outDir: 'smoke/dist-livemode', emptyOutDir: true, target: 'node20', minify: false } })
