import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/spins.ts', outDir: 'smoke/dist-spins', emptyOutDir: true, target: 'node20', minify: false } })
