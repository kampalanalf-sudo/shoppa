import { defineConfig } from 'vite'

// Same `npm:` alias as the edge suite: the bundles import the Supabase client
// with the specifier the Supabase runtime resolves, which Node cannot.
export default defineConfig({
  resolve: {
    alias: [{ find: /^npm:@supabase\/supabase-js(@[\d.]+)?$/, replacement: '@supabase/supabase-js' }],
  },
  build: { ssr: 'smoke/wire.ts', outDir: 'smoke/dist-wire', emptyOutDir: true, target: 'node20', minify: false },
})
