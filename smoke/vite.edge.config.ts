import { defineConfig } from 'vite'

// The edge bundles import the Supabase client with an `npm:` specifier, because
// that is what the Supabase runtime resolves when it builds the function. Node
// cannot resolve an `npm:` specifier, so map it to the installed package: same
// client, same call shapes.
//
// (This used to be an https://esm.sh URL, which the runtime fetched on every
// cold start -- that fetch is what turned a healthy deployment into BOOT_ERROR,
// "Function failed to start".)
export default defineConfig({
  resolve: {
    alias: [
      // A scoped specifier is `npm:@scope/name@version` -- no slash after `npm:`.
      { find: /^npm:@supabase\/supabase-js(@[\d.]+)?$/, replacement: '@supabase/supabase-js' },
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
