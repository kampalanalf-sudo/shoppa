import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/pwa.ts', outDir: 'smoke/dist-pwa', emptyOutDir: true, target: 'node20', minify: false } })
