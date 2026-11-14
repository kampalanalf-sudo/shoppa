import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { ssr: 'smoke/entry.tsx', outDir: 'smoke/dist', emptyOutDir: true, target: 'node20', minify: false },
})
