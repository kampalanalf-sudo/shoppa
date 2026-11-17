import { defineConfig } from 'vite'
export default defineConfig({
  base: '/',
  build: { ssr: 'smoke/entry.tsx', outDir: 'smoke/dist', emptyOutDir: true, target: 'node20', minify: false },
})
