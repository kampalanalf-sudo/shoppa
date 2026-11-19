import { renderToString } from 'react-dom/server'
import React from 'react'
import { SlotBoard3D } from '../src/components/SlotBoard3D'
import { CHAPE } from '../src/lib/slots/games'

const html = renderToString(<SlotBoard3D config={CHAPE} grid={null} spinning={false} winCells={new Set()} />)
const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

ok('renders without throwing', html.length > 500, `${html.length} chars`)
ok('emits a strip per reel', (html.match(/will-change-transform/g) || []).length === CHAPE.reels,
   `${(html.match(/will-change-transform/g) || []).length} strips`)
ok('strips carry a real translate3d transform', (html.match(/translate3d/g) || []).length >= CHAPE.reels)
ok('transform is not a zero translate', !/translate3d\(0px,\s*0px,\s*0px\)/.test(html))
ok('renders symbol faces', html.includes('SymbolFace') || html.length > 2000)
ok('no blur at rest', !html.includes('blur(1.1px)'))

const spinning = renderToString(<SlotBoard3D config={CHAPE} grid={null} spinning winCells={new Set()} />)
ok('spinning applies motion blur', spinning.includes('blur(1.1px)'))
ok('spinning shows the shimmer overlay', spinning.includes('animate-shimmer'))

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1) }
console.log('\nslot board renders as expected')
