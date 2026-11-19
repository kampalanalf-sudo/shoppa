import { renderToString } from 'react-dom/server'
import React from 'react'
import { SlotBoard3D } from '../src/components/SlotBoard3D'
import { Slot3D } from '../src/components/Slot3D'
import { CHAPE } from '../src/lib/slots/games'
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
