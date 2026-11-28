import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/referral.ts', outDir: 'smoke/dist-referral', emptyOutDir: true, target: 'node20', minify: false } })
