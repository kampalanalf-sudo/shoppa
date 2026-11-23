import { defineConfig } from 'vite'
export default defineConfig({
  build: { ssr: 'smoke/api.ts', outDir: 'smoke/dist-api', emptyOutDir: true, target: 'node20', minify: false },
})
