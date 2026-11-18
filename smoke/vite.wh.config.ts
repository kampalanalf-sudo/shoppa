import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/wh.ts', outDir: 'smoke/dist-wh', emptyOutDir: true, target: 'node20', minify: false } })
