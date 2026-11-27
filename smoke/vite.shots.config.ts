import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Same fake signed-in backend as the signed-in suite: the interesting state (the
// warning strip, the game control row) lives past the sign-in gate, and the app
// code must be the real one, not a copy.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^\.\.?\/supabase$/, replacement: resolve(process.cwd(), 'smoke/fakeauth.ts') },
      { find: /^\.\/lib\/supabase$|^\.\.\/lib\/supabase$|^\.\/supabase$/, replacement: resolve(process.cwd(), 'smoke/fakeauth.ts') },
    ],
  },
  build: { ssr: 'smoke/shots.tsx', outDir: 'smoke/dist-shots', emptyOutDir: true, target: 'node20', minify: false },
})
