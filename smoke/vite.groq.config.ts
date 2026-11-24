import { defineConfig } from 'vite'
export default defineConfig({
  build: { ssr: 'smoke/groqcheck.ts', outDir: 'smoke/dist-groq', emptyOutDir: true, target: 'node20', minify: false },
})
