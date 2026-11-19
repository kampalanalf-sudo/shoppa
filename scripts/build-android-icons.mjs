// scripts/build-android-icons.mjs
//
// Writes the Android launcher icons and splash screens from the same die that
// the web header and favicon use (src/lib/brand.ts).
//
// Why this exists: the Capacitor-generated default icons were still shipping —
// a blue "X" on white, and a white splash screen — which is someone else's
// logo on the player's home screen and contradicts the #08090f splash colour in
// capacitor.config.ts. `npx cap add android` produces those defaults and
// `cap sync` does not replace them, so the only fix is to overwrite the
// drawables ourselves.
//
// Layout rules for Android adaptive icons:
//   * the FOREGROUND layer is 108dp with a 72dp safe zone, i.e. everything that
//     matters must sit inside the middle ~66% — the system crops the rest;
//   * ic_launcher_background is a colour resource, set to the brand ink.
//
// Run: npm run icons:android

import { readdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { dieOnlySvg } from '../src/lib/brand.ts'

const RES = 'android/app/src/main/res'
const BG = '#08090f'

const die = Buffer.from(dieOnlySvg())

/** Rasterise the die at `size`, transparent background, centred. */
async function dieOn(size, { ratio = 0.58 } = {}) {
  const inner = Math.round(size * ratio)
  const glyph = await sharp(die, { density: 1800 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const pad = Math.round((size - inner) / 2)
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** The die centred on a solid brand-ink splash of the given dimensions. */
async function splash(w, h) {
  const inner = Math.round(Math.min(w, h) * 0.34)
  const glyph = await sharp(die, { density: 1800 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const bg = await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .png()
    .toBuffer()
  return sharp(bg)
    .composite([
      { input: glyph, top: Math.round((h - inner) / 2), left: Math.round((w - inner) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** A square icon with a transparent circular crop, for ic_launcher_round. */
async function rounded(size, buf) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  )
  const base = await sharp(buf)
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer()
  return base
}

/**
 * A plain (non-adaptive) launcher icon: the die on the brand tile. Used on
 * Android 7 and below, which ignore mipmap-anydpi-v26.
 */
async function launcherTile(size) {
  const inner = Math.round(size * 0.62)
  const glyph = await sharp(die, { density: 1800 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const round = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${BG}"/></svg>`,
  )
  const tile = await sharp(Buffer.from(round)).png().toBuffer()
  const pad = Math.round((size - inner) / 2)
  return sharp(tile)
    .composite([{ input: glyph, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  const written = []
  const dirs = readdirSync(RES).filter((d) => /^(mipmap|drawable)/.test(d))

  for (const dir of dirs) {
    let files
    try {
      files = readdirSync(join(RES, dir))
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.png')) continue
      const path = join(RES, dir, file)
      const { width, height } = await sharp(path).metadata()
      if (!width || !height) continue

      if (file === 'ic_launcher_foreground.png') {
        // adaptive foreground: die inside the 66% safe zone
        await writeFile(path, await dieOn(width, { ratio: 0.56 }))
      } else if (file === 'ic_launcher_round.png') {
        const tile = await launcherTile(width)
        await writeFile(path, await rounded(width, tile))
      } else if (file === 'ic_launcher.png') {
        await writeFile(path, await launcherTile(width))
      } else if (file === 'splash.png') {
        await writeFile(path, await splash(width, height))
      } else {
        continue
      }
      written.push(`${dir}/${file} (${width}x${height}, ${(statSync(path).size / 1024).toFixed(1)} kB)`)
    }
  }

  console.log(written.map((w) => `  ${w}`).join('\n'))
  console.log(`\n${written.length} Android assets written from the FloatBet die`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
