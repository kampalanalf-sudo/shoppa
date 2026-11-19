import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: '/', plugins: [react()], build: { ssr: 'smoke/celebrate.tsx', outDir: 'smoke/dist-celebrate', emptyOutDir: true, target: 'node20', minify: false } })
