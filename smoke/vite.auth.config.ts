import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/auth.ts', outDir: 'smoke/dist-auth', emptyOutDir: true, target: 'node20', minify: false } })
