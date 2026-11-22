import { defineConfig } from 'vite'
// collect / disburse / status now live in api/pay.ts, so these build the router.
export default defineConfig({ build: { ssr: 'api/pay.ts', outDir: 'smoke/dist-live/disburse', emptyOutDir: true, target: 'node20', minify: false } })
