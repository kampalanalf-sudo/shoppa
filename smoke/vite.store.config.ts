import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/store.ts', outDir: 'smoke/dist-store', emptyOutDir: true, target: 'node20', minify: false } })
