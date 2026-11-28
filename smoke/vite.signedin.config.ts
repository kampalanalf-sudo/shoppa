import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Swap the backend for a fake that reports a signed-in player. The app itself
  // is untouched — that is the point: this must test the real App, not a copy.
  resolve: {
    alias: [
      { find: /^\.\.?\/supabase$/, replacement: resolve(process.cwd(), 'smoke/fakeauth.ts') },
      { find: /^\.\/lib\/supabase$|^\.\.\/lib\/supabase$|^\.\/supabase$/, replacement: resolve(process.cwd(), 'smoke/fakeauth.ts') },
    ],
  },
  build: {
    ssr: 'smoke/signedin.tsx',
    outDir: 'smoke/dist-signedin',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/server', 'react-dom/client', 'jsdom'] },
  },
})
