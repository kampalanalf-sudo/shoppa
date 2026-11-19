// src/lib/brand.ts
//
// One source of truth for the FloatBet die.
//
// The die is the mark: header logo, footer logo, favicon, and therefore every
// PWA / Android launcher icon (scripts/build-icons.mjs rasterises
// public/favicon.svg, which imports this module).
//
// It is generated as a string rather than hand-written in three places because
// the favicon is a real file on disk while the React logo needs the same
// artwork. Deriving both from one function is what stops the header and the
// launcher icon drifting apart.
//
// Geometry: a clean one-point-tilt cube. The front face is an axis-aligned
// square; the top and right faces are parallelograms extruded by one depth
// vector. Pips are placed in a 3x3 grid mapped onto each face's parallelogram,
// so they can never bleed over an edge — the first version of this file mapped
// them onto the bounding box instead and they spilled across all three faces.

export const BRAND_GREEN = '#c6f24e'
export const BRAND_GREEN_DEEP = '#7dd31c'
export const BRAND_INK = '#0b0d15'

/**
 * The die's own palette.
 *
 * The body is a DEEP green rather than white. On a near-black header a white
 * die reads as a hole punched out of the bar; a dark green body with a lit top
 * edge reads as an object sitting in it. The pips stay near-white so the
 * contrast is still legible at 24px, which is the size it is actually seen at.
 */
export const DIE = {
  front: '#1f6f3f',
  frontShade: '#11412a',
  top: '#3fbf5f',
  right: '#0b2a1b',
  edge: 'rgba(0,0,0,.55)',
  pip: '#f2ffe0',
  pipDeep: '#c9f7a8',
}

type Pt = [number, number]

/** Pip layout per face: a die face is a 3x3 grid, each entry is [col,row]. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
}

/** A point on a parallelogram: origin + u*a + v*b, where a/b are 0..1. */
function gridPoint(o: Pt, u: Pt, v: Pt, a: number, b: number): Pt {
  return [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b]
}

/**
 * Pips for one face.
 *
 * `o` is the face's top-left corner, `u` the axis across the face and `v` the
 * axis down it. Grid coordinate (0..2, 0..2) maps to `inset`..`1-inset` of each
 * axis, so a pip always lands inside the face no matter how the face is skewed.
 */
function facePips(n: number, o: Pt, u: Pt, v: Pt, inset: number, r: number, fill: string): string {
  const span = 1 - inset * 2
  return (PIPS[n] ?? [])
    .map(([cx, cy]) => {
      const [x, y] = gridPoint(o, u, v, inset + (cx / 2) * span, inset + (cy / 2) * span)
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${fill}"/>`
    })
    .join('')
}

const quad = (p: Pt[]): string =>
  `M${p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`

/**
 * Shared cube geometry in the 100x100 box.
 *
 * Extracted so the monochrome icon can reuse the exact same pips as the colour
 * mark — duplicating the maths is how the first version drifted.
 */
function diceGeometry() {
  const A: Pt = [20, 33]
  const B: Pt = [62, 33]
  const C: Pt = [62, 75]
  const D: Pt = [20, 75]
  const d: Pt = [18, -16]
  const add = (p: Pt): Pt => [p[0] + d[0], p[1] + d[1]]
  const A2 = add(A)
  const B2 = add(B)
  const C2 = add(C)
  return {
    A, B, C, D, A2, B2, C2,
    u: [B[0] - A[0], B[1] - A[1]] as Pt,
    v: [D[0] - A[0], D[1] - A[1]] as Pt,
    back: [-d[0], -d[1]] as Pt,
  }
}

/**
 * Just the pips, as a `<g>`, for masking.
 */
export function dicePipsMarkup(fill = '#000', ids = 'mp'): string {
  const { A, A2, u, v, back } = diceGeometry()
  return `<g>${facePips(3, A2, u, back, 0.26, 2.7, fill)}${facePips(5, A, u, v, 0.18, 4.5, fill)}</g>`
}

/**
 * The isometric die in a 100x100 box, no background.
 *
 * Faces: front 5, top 3, right 2 (right is a narrow sliver in shadow, no pips
 * on it at small sizes — dots there turn to mush under 24px).
 */
export function diceSvg({
  id = 'fb',
  pip = DIE.pip,
  pipDeep = DIE.pipDeep,
  front = DIE.front,
  frontShade = DIE.frontShade,
  top = DIE.top,
  right = DIE.right,
  edge = DIE.edge,
}: {
  id?: string
  pip?: string
  pipDeep?: string
  front?: string
  frontShade?: string
  top?: string
  right?: string
  edge?: string
} = {}): string {
  const { A, B, C, D, A2, B2, C2, u, v, back } = diceGeometry()

  const frontPips = facePips(5, A, u, v, 0.18, 4.5, `url(#${id}-pip)`)
  // Top face: origin at the back edge (A2), across is u, "down" is the depth
  const topPips = facePips(3, A2, u, back, 0.26, 2.7, `url(#${id}-pip)`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="FloatBet die">
  <defs>
    <linearGradient id="${id}-frontg" x1="0" y1="0" x2="0.45" y2="1">
      <stop offset="0" stop-color="${front}"/>
      <stop offset="0.55" stop-color="${frontShade}"/>
      <stop offset="1" stop-color="${frontShade}"/>
    </linearGradient>
    <linearGradient id="${id}-topg" x1="0" y1="1" x2="0.4" y2="0">
      <stop offset="0" stop-color="${front}"/>
      <stop offset="0.6" stop-color="${top}"/>
      <stop offset="1" stop-color="${top}"/>
    </linearGradient>
    <linearGradient id="${id}-rightg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${right}"/>
      <stop offset="1" stop-color="${right}" stop-opacity=".9"/>
    </linearGradient>
    <linearGradient id="${id}-pip" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="${pip}"/>
      <stop offset="1" stop-color="${pipDeep}"/>
    </linearGradient>
    <!-- a soft drop shadow under the cube, so it sits on the surface -->
    <radialGradient id="${id}-shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#000" stop-opacity=".45"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <!-- specular sheen across the lit top face -->
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".38"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <ellipse cx="50" cy="80" rx="30" ry="6" fill="url(#${id}-shadow)"/>
  <g stroke="${edge}" stroke-width="0.8" stroke-linejoin="round">
    <path d="${quad([A2, B2, B, A])}" fill="url(#${id}-topg)"/>
    <path d="${quad([B2, C2, C, B])}" fill="url(#${id}-rightg)"/>
    <path d="${quad([A, B, C, D])}" fill="url(#${id}-frontg)"/>
  </g>
  <!-- bevel: a lit inner edge on the front face and a dark one where it turns -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${quad([A2, B2, B, A])}" stroke="url(#${id}-sheen)" stroke-width="1.6" fill="url(#${id}-sheen)"/>
    <path d="M${A[0]} ${A[1]} L${B[0]} ${B[1]}" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.1"/>
    <path d="M${B[0]} ${B[1]} L${C[0]} ${C[1]}" stroke="#000" stroke-opacity=".45" stroke-width="1.2"/>
    <path d="M${B[0]} ${B[1]} L${C2[0]} ${C2[1]}" stroke="#000" stroke-opacity=".3" stroke-width="0.9"/>
  </g>
  <!-- pips with a tiny inner highlight so they read as drilled, not painted -->
  <g>${topPips}${frontPips}</g>
</svg>`
}

/** The die body without its `<svg>` wrapper, for embedding. */
function innerDice(): string {
  const full = diceSvg({ id: 'fv' })
  return full.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

/**
 * The same die with no gradients, in a single flat colour, on a transparent
 * background. Used for the Android themed (monochrome) icon, where the system
 * tints the shape itself: gradients would flatten to mud and a dark background
 * would become a dark blob.
 */
export function monochromeDieSvg(color = '#ffffff'): string {
  const { A, B, C, D, A2, B2, C2 } = diceGeometry()
  // The pips are CUT OUT of the silhouette rather than painted on. Android
  // tints a themed icon to one colour, so painted pips would vanish into the
  // face; a hole stays a hole, and the die still reads as a die.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <mask id="mn-cut">
      <rect width="100" height="100" fill="#fff"/>
      ${dicePipsMarkup('#000')}
    </mask>
  </defs>
  <g fill="${color}" mask="url(#mn-cut)">
    <path d="${quad([A2, B2, B, A])}"/>
    <path d="${quad([B2, C2, C, B])}"/>
    <path d="${quad([A, B, C, D])}"/>
  </g>
</svg>`
}

/** The die alone, transparent background, for maskable icons. */
export function dieOnlySvg(): string {
  return diceSvg({ id: 'mo' })
}

/**
 * The favicon: the die on the app's dark tile.
 *
 * `scripts/build-icons.mjs` rasterises this file for the manifest, the maskable
 * set and the apple-touch icon, so it must stay standalone: no external fonts,
 * no CSS variables, nothing that needs a parent document.
 */
export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="fbglow" cx="50%" cy="40%" r="65%">
      <stop offset="0" stop-color="${BRAND_GREEN}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${BRAND_GREEN}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fbbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141a24"/>
      <stop offset="1" stop-color="${BRAND_INK}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#fbbg)"/>
  <rect width="64" height="64" rx="15" fill="url(#fbglow)"/>
  <g transform="translate(4.2 6.6) scale(.58)">${innerDice()}</g>
</svg>`
}
