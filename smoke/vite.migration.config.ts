import { defineConfig } from 'vite'
export default defineConfig({ base: '/', build: { ssr: 'smoke/migration.ts', outDir: 'smoke/dist-migration', emptyOutDir: true, target: 'node20', minify: false } })
