import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'smoke/deploy.ts', outDir: 'smoke/dist-deploy', emptyOutDir: true, target: 'node20', minify: false } })
