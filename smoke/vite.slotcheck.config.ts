import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: '/', plugins: [react()], build: { ssr: 'smoke/slotcheck.tsx', outDir: 'smoke/dist-slotcheck', emptyOutDir: true, target: 'node20', minify: false } })
