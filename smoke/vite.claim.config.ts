import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/claim.ts', outDir: 'smoke/dist-claim', emptyOutDir: true, target: 'node20', minify: false } })
