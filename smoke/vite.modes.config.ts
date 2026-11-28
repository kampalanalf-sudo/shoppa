import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/modes.ts', outDir: 'smoke/dist-modes', emptyOutDir: true, target: 'node20', minify: false } })
