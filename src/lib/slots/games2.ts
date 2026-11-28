import type { SlotConfig } from './engine'
import { ASSET_BASE } from '../assetBase'

/**
 * Ghetto Bazaar — a 5x3 ways slot built around a Kampala market. Bargains pay,
 * but a bad deal (the "Shortchanged" symbol) fines you when three land.
 */
export const BAZAAR: SlotConfig = {
  id: 'bazaar',
  name: 'Ghetto Bazaar',
  tagline: '5×3 ways · bargain hunting in Kampala',
  reels: 5,
  rows: 3,
  wild: 'bargain',
  scatter: 'stall',
  scatterTrigger: 3,
  freeSpins: 8,
  scatterPay: [4.409, 15.12, 44.09],
  omen: { symbol: 'jamb', trigger: 3, fine: 3.5 },
  maxWin: 4000,
  volatility: 'medium',
  symbols: [
    { id: 'queen', name: 'Market Queen', pay: [0.1764, 1.512, 11.34], weight: 2, tier: 'high', glyph: '👑', color: '#ffcf5c', art: `${ASSET_BASE}art/bazaar/queen.webp` },
    { id: 'bargain', name: 'Bargain (Wild)', pay: [0.189, 1.638, 12.28], weight: 2, tier: 'special', glyph: '🏷️', color: '#c6f24e', art: `${ASSET_BASE}art/bazaar/bargain.webp` },
    { id: 'radio', name: 'Radio', pay: [0.1134, 0.9448, 7.244], weight: 3, tier: 'high', glyph: '📻', color: '#a06bff', art: `${ASSET_BASE}art/bazaar/radio.webp` },
    { id: 'shoes', name: 'Sneakers', pay: [0.06928, 0.5669, 4.283], weight: 5, tier: 'mid', glyph: '👟', color: '#3ad7ff', art: `${ASSET_BASE}art/bazaar/shoes.webp` },
    { id: 'fruit', name: 'Matoke', pay: [0.05039, 0.4157, 3.087], weight: 7, tier: 'mid', glyph: '🍌', color: '#e8d44d', art: `${ASSET_BASE}art/bazaar/fruit.webp` },
    { id: 'fabric', name: 'Kitenge', pay: [0.03779, 0.2771, 2.078], weight: 9, tier: 'mid', glyph: '🧵', color: '#ff8fb1', art: `${ASSET_BASE}art/bazaar/fabric.webp` },
    { id: 'pot', name: 'Clay Pot', pay: [0.0189, 0.1386, 1.008], weight: 13, tier: 'low', glyph: '🏺', color: '#c98b5c', art: `${ASSET_BASE}art/bazaar/pot.webp` },
    { id: 'basket', name: 'Basket', pay: [0.0189, 0.1134, 0.8188], weight: 15, tier: 'low', glyph: '🧺', color: '#d8b98a', art: `${ASSET_BASE}art/bazaar/basket.webp` },
    { id: 'stall', name: 'Stall (Scatter)', weight: 2, tier: 'special', glyph: '⛺', color: '#3ad7ff', art: `${ASSET_BASE}art/bazaar/stall.webp` },
    { id: 'jamb', name: 'Shortchanged', weight: 2, tier: 'special', glyph: '🪙', color: '#ff5c78', art: `${ASSET_BASE}art/bazaar/jamb.webp` },
  ],
}

/**
 * Night Boda — a 5x3 ways slot about Kampala's boda-boda riders at night.
 * Helmets are the scatter; a police checkpoint is the fine symbol.
 */
export const BODA: SlotConfig = {
  id: 'boda',
  name: 'Night Boda',
  tagline: '5×3 ways · ride the city after dark',
  reels: 5,
  rows: 3,
  wild: 'helmet',
  scatter: 'lamp',
  scatterTrigger: 3,
  freeSpins: 10,
  scatterPay: [3.992, 13.97, 42.41],
  omen: { symbol: 'checkpoint', trigger: 3, fine: 4 },
  maxWin: 5000,
  volatility: 'high',
  symbols: [
    { id: 'rider', name: 'Night Rider', pay: [0.1597, 1.397, 10.48], weight: 2, tier: 'high', glyph: '🏍️', color: '#c6f24e', art: `${ASSET_BASE}art/boda/rider.webp` },
    { id: 'helmet', name: 'Helmet (Wild)', pay: [0.1497, 1.297, 9.73], weight: 2, tier: 'special', glyph: '⛑️', color: '#3ad7ff', art: `${ASSET_BASE}art/boda/helmet.webp` },
    { id: 'jacket', name: 'Rider Jacket', pay: [0.0998, 0.8483, 6.237], weight: 3, tier: 'high', glyph: '🧥', color: '#a06bff', art: `${ASSET_BASE}art/boda/jacket.webp` },
    { id: 'keys', name: 'Keys', pay: [0.05988, 0.499, 3.692], weight: 5, tier: 'mid', glyph: '🔑', color: '#ffcf5c', art: `${ASSET_BASE}art/boda/keys.webp` },
    { id: 'fuel', name: 'Fuel', pay: [0.04491, 0.3593, 2.645], weight: 7, tier: 'mid', glyph: '⛽', color: '#ff8f5c', art: `${ASSET_BASE}art/boda/fuel.webp` },
    { id: 'phone', name: 'Phone', pay: [0.02994, 0.2495, 1.846], weight: 9, tier: 'mid', glyph: '📱', color: '#5cd68a', art: `${ASSET_BASE}art/chape/phone.webp` },
    { id: 'roll', name: 'Rolex Roll', pay: [0.01996, 0.1497, 1.098], weight: 13, tier: 'low', glyph: '🌯', color: '#e8d44d', art: `${ASSET_BASE}art/boda/roll.webp` },
    { id: 'note', name: 'Banknote', pay: [0.01497, 0.1198, 0.8483], weight: 15, tier: 'low', glyph: '💵', color: '#5cd68a', art: `${ASSET_BASE}art/boda/note.webp` },
    { id: 'lamp', name: 'Headlamp (Scatter)', weight: 2, tier: 'special', glyph: '💡', color: '#ffcf5c', art: `${ASSET_BASE}art/boda/lamp.webp` },
    { id: 'checkpoint', name: 'Checkpoint', weight: 2, tier: 'special', glyph: '🚧', color: '#ff5c78', art: `${ASSET_BASE}art/boda/checkpoint.webp` },
  ],
}
