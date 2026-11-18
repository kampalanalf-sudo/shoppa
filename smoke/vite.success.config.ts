import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: '/', plugins: [react()], build: { ssr: 'smoke/success.tsx', outDir: 'smoke/dist-success', emptyOutDir: true, target: 'node20', minify: false } })
