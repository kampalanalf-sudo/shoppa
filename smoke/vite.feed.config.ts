import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/feed.ts', outDir: 'smoke/dist-feed', emptyOutDir: true, target: 'node20', minify: false } })
