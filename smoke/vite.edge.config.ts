import { defineConfig } from 'vite'

// The edge bundles import the Supabase client from a URL, because that is what
// Deno resolves at runtime. Node cannot load an https: module, so map it to the
// installed package: same client, same call shapes.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^https:\/\/esm\.sh\/@supabase\/supabase-js@[\d.]+\/?$/, replacement: '@supabase/supabase-js' },
    ],
  },
  build: {
    ssr: 'smoke/edge.ts',
    outDir: 'smoke/dist-edge',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
  },
})
