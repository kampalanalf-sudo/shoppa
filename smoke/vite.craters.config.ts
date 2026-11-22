import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/craters.tsx', outDir: 'smoke/dist-craters', emptyOutDir: true, target: 'node20', minify: false } })
