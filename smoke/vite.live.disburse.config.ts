import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'api/disburse.ts', outDir: 'smoke/dist-live/disburse', emptyOutDir: true, target: 'node20', minify: false } })
