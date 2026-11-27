import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    outDir: 'smoke/dist-readiness',
    ssr: 'smoke/readiness.ts',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'readiness.js' } },
    emptyOutDir: true,
  },
})
