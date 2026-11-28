import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/float.ts', outDir: 'smoke/dist-float', emptyOutDir: true, target: 'node20', minify: false } })
