import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/sessions.ts', outDir: 'smoke/dist-sessions', emptyOutDir: true, target: 'node20', minify: false } })
