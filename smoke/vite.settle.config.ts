import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    outDir: 'smoke/dist-settle',
    ssr: 'smoke/settle.ts',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'settle.js' } },
    emptyOutDir: true,
  },
})
