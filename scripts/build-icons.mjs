// scripts/build-icons.mjs
//
// Renders every PWA / Android icon from public/favicon.svg so the app icon and
// the launcher icon can never drift apart.
//
// Two families:
//   * "any"      icons keep the rounded dark tile the logo already draws.
//   * "maskable" icons must survive Android's adaptive-icon crop. They get a
//     full-bleed background and the glyph is scaled to ~60% so nothing
//     important is clipped by the circle/squircle mask.
//
// Run: node scripts/build-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const SRC = 'public/favicon.svg'
const OUT = 'public/icons'
const BG = '#08090f'

// Sizes: 192/512 for the manifest, 512 for maskable, plus the legacy
// apple-touch-icon which iOS insists on.
const ANY = [192, 512]
const MASKABLE = [192, 512]
const APPLE = 180

const svg = readFileSync(SRC)

/** Render the glyph at a given inner size on a solid background. */
async function render(size, { pad = 0, radius = 0 } = {}) {
  const inner = Math.round(size * (1 - pad * 2))
  const glyph = await sharp(svg, { density: 600 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  // Sharp instances are not reusable, so every stage produces a Buffer that the
  // next stage re-reads.
  const flat = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .png()
    .toBuffer()

  let baseBuf = flat
  if (radius > 0) {
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`,
    )
    baseBuf = await sharp(flat)
      .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
      .png()
      .toBuffer()
  }
  const base = sharp(baseBuf)

  const offset = Math.round((size - inner) / 2)
  return base
    .composite([{ input: glyph, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const written = []
  async function save(name, buf) {
    await writeFile(`${OUT}/${name}`, buf)
    written.push(`${name} (${(buf.length / 1024).toFixed(1)} kB)`)
  }

  for (const size of ANY) {
    await save(`icon-${size}.png`, await render(size, { radius: size * 0.22 }))
  }

  for (const size of MASKABLE) {
    // full bleed, glyph at 60% so the adaptive mask cannot clip it
    await save(`maskable-${size}.png`, await render(size, { pad: 0.2 }))
  }

  await save(`apple-touch-icon-${APPLE}.png`, await render(APPLE, { radius: APPLE * 0.22 }))

  // A monochrome mark for Android 13 themed icons / notification badges.
  await save(
    'monochrome-512.png',
    await sharp(svg, { density: 600 })
      .resize(320, 320, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .flatten({ background: '#ffffff' })
      .extend({ top: 96, bottom: 96, left: 96, right: 96, background: '#ffffff' })
      .greyscale()
      .png()
      .toBuffer(),
  )

  console.log(written.map((w) => `  ${w}`).join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
