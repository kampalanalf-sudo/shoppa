import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/sports.ts', outDir: 'smoke/dist-sports', emptyOutDir: true, target: 'node20', minify: false } })
