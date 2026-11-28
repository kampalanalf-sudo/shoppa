import { renderToString } from 'react-dom/server'
import React from 'react'
import { SlotBoard3D } from '../src/components/SlotBoard3D'
import { Slot3D } from '../src/components/Slot3D'
import { BLUE_MOUNTAIN, CHAPE } from '../src/lib/slots/games'
import { START_TRANSFORM } from '../src/lib/reels'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

// ============================================================ engine board ===
const html = renderToString(
  <SlotBoard3D config={CHAPE} grid={null} spinning={false} spinKey={0} winCells={new Set()} />,
)
ok('engine board renders without throwing', html.length > 500, `${html.length} chars`)
ok('engine board emits one strip per reel',
  (html.match(/will-change-transform/g) || []).length === CHAPE.reels,
  `${(html.match(/will-change-transform/g) || []).length} strips`)

// The resting transform is written by a layout effect, so the mark-up carries
// none: that is deliberate (a JSX transform would be overwritten mid-flight).
// What must hold is that the strip is NOT pinned to an identity transform in
// the markup, which is what the original bug looked like.
ok('engine board does not bake a zero transform into the markup',
  !html.includes(`transform:${START_TRANSFORM}`))

const spinningHtml = renderToString(
  <SlotBoard3D config={CHAPE} grid={null} spinning spinKey={0} winCells={new Set()} />,
)
ok('engine board shows the shimmer while spinning', spinningHtml.includes('animate-shimmer'))
ok('engine board is sharp at rest', !spinningHtml.includes('blur(0.7px)'))

// ====================================================== Blue Mountain faces ===
// JKaz is a real person's likeness and the symbol is his portrait. It shipped
// once as a generic man in a blue suit, which looked like a stranger beside
// every other face in the game, and it carried a cocktail-glass glyph long
// after the portrait replaced it.
const jkaz = BLUE_MOUNTAIN.symbols.find((s) => s.id === 'jkaz')!
ok('Blue Mountain has a JKaz symbol', !!jkaz)
ok('JKaz renders his portrait, not a glyph', !!jkaz.art && jkaz.art.includes('/art/bluemountain/jkaz'))
ok('JKaz has no cocktail-glyph left', jkaz.glyph !== '\u{1F378}')

// The portrait must actually be printable and square like its siblings, or it
// letterboxes against the tile and the face sits off-centre.
const fs = await import('node:fs')
const sharp = (await import('sharp')).default
const meta = await sharp('public/art/bluemountain/jkaz.webp').metadata()
ok('JKaz portrait is 512x512 like the other portraits',
  meta.width === 512 && meta.height === 512, `${meta.width}x${meta.height}`)
const bytes = fs.statSync('public/art/bluemountain/jkaz.webp').size
ok('JKaz portrait is a real image, not a placeholder', bytes > 20_000, `${bytes} bytes`)

// ============================================================ bonni board ===
const bonni = renderToString(<Slot3D grid={null} spinning={false} spinKey={0} stopping winCells={new Set()} />)
ok('bonni board renders without throwing', bonni.length > 500, `${bonni.length} chars`)
ok('bonni board emits one strip per reel',
  (bonni.match(/will-change-transform/g) || []).length === 5,
  `${(bonni.match(/will-change-transform/g) || []).length} strips`)
ok('bonni board renders symbol faces', (bonni.match(/<img/g) || []).length > 0)
ok('bonni board keeps the cabinet feet', bonni.includes('from-[#1b2a1e]'))
ok('bonni board paints no win highlight before a spin',
  !bonni.includes('ring-neon-lime/70'))

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1) }
console.log('\nslot boards render as expected')
