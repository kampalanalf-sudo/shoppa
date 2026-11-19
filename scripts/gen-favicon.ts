// scripts/gen-favicon.ts
//
// Writes public/favicon.svg from the single source of truth in
// src/lib/brand.ts. `npm run icons` runs this first, then rasterises the
// result into every PWA / Android size.
//
// Run directly: npm run favicon
import { writeFileSync } from 'node:fs'
import { faviconSvg } from '../src/lib/brand'

const svg = faviconSvg()
writeFileSync('public/favicon.svg', svg)
console.log(`public/favicon.svg (${svg.length} bytes)`)
