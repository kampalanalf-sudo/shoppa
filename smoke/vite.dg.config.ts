import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/dg.ts', outDir: 'smoke/dist-dg', emptyOutDir: true, target: 'node20', minify: false } })
