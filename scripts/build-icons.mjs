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
import { dieOnlySvg, monochromeDieSvg } from '../src/lib/brand.ts'

const SRC = 'public/favicon.svg'
const OUT = 'public/icons'
const BG = '#08090f'

// Sizes: 192/512 for the manifest, 512 for maskable, plus the legacy
// apple-touch-icon which iOS insists on.
const ANY = [192, 512]
const MASKABLE = [192, 512]
const APPLE = 180

const svg = readFileSync(SRC)

// The die on its own, generated from the same module as the favicon above, so
// the maskable and monochrome variants cannot drift from the mark either.
const dieOnly = Buffer.from(dieOnlySvg())
const mono = Buffer.from(monochromeDieSvg())

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
    // Full bleed: a solid background edge to edge, with ONLY the die composited
    // at ~58% so Android's circle/squircle crop cannot reach it. Rendering the
    // rounded tile itself and insetting that (the previous approach) put a
    // second dark blob with its own corners inside the mask.
    const inner = Math.round(size * 0.58)
    const die = await sharp(dieOnly, { density: 900 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    const bg = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
      .png()
      .toBuffer()
    const offset = Math.round((size - inner) / 2)
    await save(
      `maskable-${size}.png`,
      await sharp(bg)
        .composite([{ input: die, top: offset, left: offset }])
        .png({ compressionLevel: 9 })
        .toBuffer(),
    )
  }

  await save(`apple-touch-icon-${APPLE}.png`, await render(APPLE, { radius: APPLE * 0.22 }))

  // Android 13 themed icon. The system tints this itself, so it must be a flat
  // silhouette on TRANSPARENT: flattening it onto white (the previous version)
  // produced a white square that the system then tinted into a solid blob.
  const monoInner = Math.round(512 * 0.62)
  await save(
    'monochrome-512.png',
    await sharp(mono, { density: 900 })
      .resize(monoInner, monoInner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: Math.round((512 - monoInner) / 2),
        bottom: 512 - monoInner - Math.round((512 - monoInner) / 2),
        left: Math.round((512 - monoInner) / 2),
        right: 512 - monoInner - Math.round((512 - monoInner) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  )

  console.log(written.map((w) => `  ${w}`).join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
