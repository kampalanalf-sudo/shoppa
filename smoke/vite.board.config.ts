// smoke/vite.board.config.ts
//
// Bundles the board-game server test. `typescript` is imported at runtime to
// type-strip the flattened edge bundle, so it stays external.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'smoke/dist-board',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      input: fileURLToPath(new URL('./board.ts', import.meta.url)),
      external: ['typescript'],
      output: { entryFileNames: 'board.js', format: 'es' },
    },
  },
})
