import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'api/collect.ts', outDir: 'smoke/dist-live/collect', emptyOutDir: true, target: 'node20', minify: false } })
