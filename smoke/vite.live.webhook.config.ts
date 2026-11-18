import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'api/webhooks/dgateway.ts', outDir: 'smoke/dist-live/webhook', emptyOutDir: true, target: 'node20', minify: false } })
