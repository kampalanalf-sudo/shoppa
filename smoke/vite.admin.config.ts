import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/admin.ts', outDir: 'smoke/dist-admin', emptyOutDir: true, target: 'node20', minify: false } })
