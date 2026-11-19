import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/reels.ts', outDir: 'smoke/dist-reels', emptyOutDir: true, target: 'node20', minify: false } })
