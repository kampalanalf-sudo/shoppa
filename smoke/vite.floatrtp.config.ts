import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/floatrtp.ts', outDir: 'smoke/dist-floatrtp', emptyOutDir: true, target: 'node20', minify: false } })
