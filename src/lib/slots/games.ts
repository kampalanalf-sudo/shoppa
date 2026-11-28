import { ASSET_BASE } from '../assetBase'
import type { SlotConfig } from './engine'

/**
 * Kwaff On Chape — a 5x3 ways slot set in a Nigerian narcotics investigation.
 *
 * The two snitches (Bryan and Allan, each with one bad eye) are low-weight
 * blockers that pay almost nothing. Faith the witch is the ultimate bad omen:
 * when she lands 2+ anywhere she fines the player outright.
 */
export const CHAPE: SlotConfig = {
  id: 'chape',
  name: 'Kwaff On Chape',
  tagline: '5×3 ways · snitches & witch fines',
  reels: 5,
  rows: 3,
  wild: 'stash',
  scatter: 'cuffs',
  scatterTrigger: 3,
  freeSpins: 10,
  scatterPay: [6.5, 26, 81.25],
  omen: { symbol: 'faith', trigger: 3, fine: 5 },
  badLuck: ['bryan', 'allan'],
  maxWin: 5000,
  volatility: 'high',
  symbols: [
    // --- high paying
    { id: 'baron', name: 'The Baron', pay: [0.325, 2.762, 21.12], weight: 2, tier: 'high', glyph: '👑', color: '#ffcf5c', art: `${ASSET_BASE}art/chape/baron.webp` },
    { id: 'mule', name: 'Courier', pay: [0.2275, 2.015, 15.6], weight: 3, tier: 'high', glyph: '🕶️', color: '#a06bff', art: `${ASSET_BASE}art/chape/mule.webp` },
    { id: 'stash', name: 'Stash (Wild)', pay: [0.26, 2.275, 16.9], weight: 2, tier: 'special', glyph: '📦', color: '#c6f24e', art: `${ASSET_BASE}art/chape/stash.webp` },
    // --- mid
    { id: 'cash', name: 'Dirty Cash', pay: [0.13, 0.975, 6.825], weight: 5, tier: 'mid', glyph: '💵', color: '#5cd68a', art: `${ASSET_BASE}art/chape/cash.webp` },
    { id: 'phone', name: 'Burner Phone', pay: [0.0975, 0.715, 4.875], weight: 7, tier: 'mid', glyph: '📱', color: '#3ad7ff', art: `${ASSET_BASE}art/chape/phone.webp` },
    { id: 'brick', name: 'Brick', pay: [0.065, 0.52, 3.413], weight: 9, tier: 'mid', glyph: '🧱', color: '#c98b5c', art: `${ASSET_BASE}art/chape/brick.webp` },
    // --- low
    { id: 'bottle', name: 'Bottle', pay: [0.0325, 0.2275, 1.463], weight: 13, tier: 'low', glyph: '🍾', color: '#8b93a5', art: `${ASSET_BASE}art/chape/bottle.webp` },
    { id: 'dice', name: 'Loaded Dice', pay: [0.0325, 0.195, 1.235], weight: 15, tier: 'low', glyph: '🎲', color: '#e0d5b1', art: `${ASSET_BASE}art/chape/dice.webp` },
    // --- bad luck blockers (snitches, one bad eye each)
    { id: 'bryan', name: 'Bryan (Snitch)', pay: [0.01625, 0.065, 0.325], weight: 3, tier: 'low', glyph: '👁️', color: '#ff5c78', art: `${ASSET_BASE}art/chape/bryan.webp` },
    { id: 'allan', name: 'Allan (Snitch)', pay: [0.01625, 0.065, 0.325], weight: 3, tier: 'low', glyph: '👁️', color: '#ff5c78', art: `${ASSET_BASE}art/chape/allan.webp` },
    // --- specials
    { id: 'cuffs', name: 'Handcuffs (Scatter)', weight: 2, tier: 'special', glyph: '⛓️', color: '#3ad7ff', art: `${ASSET_BASE}art/chape/cuffs.webp` },
    { id: 'faith', name: 'Faith the Witch', weight: 2, tier: 'special', glyph: '🧙🏿‍♀️', color: '#a06bff', art: `${ASSET_BASE}art/chape/faith.webp` },
  ],
}

/**
 * Blue Mountain — the Blue Mountain Lounge 5x3 ways slot.
 *
 * Georgies are the scatter: 3+ trigger free spins. Faith the witch still haunts
 * the floor here (same character, same heavy fine), and the snitches appear too.
 */
export const BLUE_MOUNTAIN: SlotConfig = {
  id: 'bluemountain',
  name: 'Blue Mountain',
  tagline: '5×3 ways · 3 Georgies = free spins',
  reels: 5,
  rows: 3,
  wild: 'jkaz',
  scatter: 'georgie',
  scatterTrigger: 3,
  freeSpins: 9,
  scatterPay: [9.966, 33.22, 99.66],
  omen: { symbol: 'faith', trigger: 3, fine: 5 },
  badLuck: ['bryan', 'allan'],
  maxWin: 5000,
  volatility: 'high',
  symbols: [
    { id: 'nyank', name: 'Top Nyank (Wild)', pay: [0.299, 2.591, 19.93], weight: 2, tier: 'special', glyph: '🎖️', color: '#c6f24e', art: `${ASSET_BASE}art/bluemountain/nyank.webp` },
    { id: 'jkaz', name: 'Jkaz', pay: [0.3654, 2.99, 23.25], weight: 2, tier: 'high', glyph: '🤵', color: '#ffcf5c', art: `${ASSET_BASE}art/bluemountain/jkaz.webp` },
    { id: 'vip', name: 'Lounge VIP', pay: [0.1993, 1.661, 12.96], weight: 3, tier: 'high', glyph: '💎', color: '#3ad7ff', art: `${ASSET_BASE}art/bluemountain/vip.webp` },
    { id: 'stash', name: 'Blue Mountain Stash', pay: [0.1329, 0.9966, 7.308], weight: 5, tier: 'mid', glyph: '📦', color: '#5c7cff', art: `${ASSET_BASE}art/chape/stash.webp` },
    { id: 'cash', name: 'Cash Roll', pay: [0.09966, 0.7308, 5.149], weight: 7, tier: 'mid', glyph: '💵', color: '#5cd68a', art: `${ASSET_BASE}art/chape/cash.webp` },
    { id: 'bottle', name: 'Blue Label', pay: [0.06644, 0.4983, 3.322], weight: 9, tier: 'mid', glyph: '🥃', color: '#7aa2ff', art: `${ASSET_BASE}art/chape/bottle.webp` },
    { id: 'dice', name: 'Lounge Dice', pay: [0.03322, 0.2325, 1.462], weight: 13, tier: 'low', glyph: '🎲', color: '#e0d5b1', art: `${ASSET_BASE}art/chape/dice.webp` },
    { id: 'cigar', name: 'Cigar', pay: [0.03322, 0.1661, 1.129], weight: 15, tier: 'low', glyph: '🚬', color: '#c98b5c', art: `${ASSET_BASE}art/bluemountain/cigar.webp` },
    { id: 'bryan', name: 'Bryan (Snitch)', pay: [0.01661, 0.06644, 0.3322], weight: 3, tier: 'low', glyph: '👁️', color: '#ff5c78', art: `${ASSET_BASE}art/chape/bryan.webp` },
    { id: 'allan', name: 'Allan (Snitch)', pay: [0.01661, 0.06644, 0.3322], weight: 3, tier: 'low', glyph: '👁️', color: '#ff5c78', art: `${ASSET_BASE}art/chape/allan.webp` },
    { id: 'georgie', name: 'Georgie (Scatter)', weight: 2, tier: 'special', glyph: '🌺', color: '#ff8fb1', art: `${ASSET_BASE}art/bluemountain/georgie.webp` },
    { id: 'faith', name: 'Faith the Witch', weight: 2, tier: 'special', glyph: '🧙🏿‍♀️', color: '#a06bff', art: `${ASSET_BASE}art/chape/faith.webp` },
  ],
}
