import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/zp.ts', outDir: 'smoke/dist-zp', emptyOutDir: true, target: 'node20', minify: false } })
