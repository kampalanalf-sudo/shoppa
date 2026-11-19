import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: '/', plugins: [react()], build: { ssr: 'smoke/brand.tsx', outDir: 'smoke/dist-brand', emptyOutDir: true, target: 'node20', minify: false } })
