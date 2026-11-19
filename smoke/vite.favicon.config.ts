import { defineConfig } from 'vite'
export default defineConfig({
  base: '/',
  build: { ssr: 'scripts/gen-favicon.ts', outDir: 'smoke/dist-favicon', emptyOutDir: true, target: 'node20', minify: false },
})
