import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/routes.ts', outDir: 'smoke/dist-routes', emptyOutDir: true, target: 'node20', minify: false } })
