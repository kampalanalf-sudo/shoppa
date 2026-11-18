import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { ssr: 'smoke/layout.tsx', outDir: 'smoke/dist-layout', emptyOutDir: true, target: 'node20', minify: false },
})
