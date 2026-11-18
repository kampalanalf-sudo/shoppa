import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { ssr: 'smoke/ui.tsx', outDir: 'smoke/dist-ui', emptyOutDir: true, target: 'node20', minify: false },
})
