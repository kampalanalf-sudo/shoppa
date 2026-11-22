export type GameId =
  | 'bonni'
  | 'plinko'
  | 'crash'
  | 'mines'
  | 'dice'
  | 'limbo'
  | 'wheel'
  | 'tower'
  | 'roulette'
  | 'chape'
  | 'bluemountain'
  | 'bazaar'
  | 'boda'
  | 'craters'

export type GameMeta = {
  id: GameId
  name: string
  tagline: string
  art: string
  accent: string
  accentSoft: string
  rtp: string
  maxWin: string
  players: number
  category: 'Originals' | 'Instant' | 'Table' | 'Slots'
  hot?: boolean
  isNew?: boolean
}

export type BetRecord = {
  id: string
  game: GameId
  gameName: string
  wager: number
  payout: number
  multiplier: number
  detail: string
  won: boolean
  ts: number
  /** Verifiable round data. */
  nonce?: number
  clientSeed?: string
  hash?: string
}

export type Toast = {
  id: string
  title: string
  body?: string
  kind: 'win' | 'info' | 'error' | 'success'
}

export type Stats = {
  wagered: number
  profit: number
  biggestWin: number
  rounds: number
  wins: number
  streak: number
  bestStreak: number
}

export type FairSeedState = {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
  prevServerSeed: string | null
}
