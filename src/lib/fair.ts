/**
 * Provably-fair engine (HMAC-SHA256, identical derivation to leading crypto casinos).
 *
 * outcome = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${round}`)
 * 4 bytes are consumed at a time and divided by 2^32 to produce a float in [0, 1).
 *
 * The server seed is committed up front as SHA-256(serverSeed) so players can verify
 * that outcomes were fixed before the bet was placed.
 */

const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export const randomHex = (bytes = 32) => {
  const b = new Uint8Array(bytes)
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(b)
  } else {
    for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256)
  }
  return toHex(b)
}

const hasSubtle = () => typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle

/* Deterministic fallback (FNV-1a expanded) for non-secure contexts. */
const fallbackDigest = (msg: string) => {
  const out = new Uint8Array(32)
  let h = 0x811c9dc5
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (let i = 0; i < 32; i++) {
    h ^= h << 13; h >>>= 0
    h ^= h >>> 17
    h ^= h << 5; h >>>= 0
    out[i] = h & 0xff
  }
  return out
}

export async function sha256(text: string) {
  if (!hasSubtle()) return toHex(fallbackDigest(`sha:${text}`))
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return toHex(digest)
}

async function hmac(serverSeed: string, message: string) {
  if (!hasSubtle()) return fallbackDigest(`hmac:${serverSeed}:${message}`)
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

/** Produce `count` deterministic floats in [0, 1) for a bet. */
export async function floats(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): Promise<number[]> {
  const out: number[] = []
  let round = 0
  while (out.length < count) {
    const bytes = await hmac(serverSeed, `${clientSeed}:${nonce}:${round}`)
    for (let i = 0; i + 3 < bytes.length && out.length < count; i += 4) {
      const v = bytes[i] * 2 ** 24 + bytes[i + 1] * 2 ** 16 + bytes[i + 2] * 2 ** 8 + bytes[i + 3]
      out.push(v / 4294967296)
    }
    round++
  }
  return out
}

export type Seeds = {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
  prevServerSeed?: string
}

export async function freshSeeds(clientSeed = randomHex(8)): Promise<Seeds> {
  const serverSeed = randomHex(32)
  return { serverSeed, serverSeedHash: await sha256(serverSeed), clientSeed, nonce: 0 }
}

/** Number of safe positions revealed helpers ------------------------------------ */

export const crashPoint = (u: number) => {
  // 1% house edge, with a 1-in-33 instant bust at 1.00x
  if (u < 0.03) return 1
  return Math.max(1, Math.floor((0.99 / (1 - u)) * 100) / 100)
}

export const limboPoint = (u: number) => Math.max(1, Math.floor((0.99 / (1 - u)) * 100) / 100)

export const diceRoll = (u: number) => Math.round(u * 10000) / 100

export const combination = (n: number, k: number) => {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
