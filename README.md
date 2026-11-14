# FloatBet Gaming

A production-quality, BC.Game-styled crypto casino front-end with **8 fully playable original games**
and a real provably-fair engine. Built with React 19 + TypeScript + Vite + Tailwind.

> Demo build — balances, deposits and withdrawals are simulated locally. No real money is involved.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run preview
```

## The 8 games

| Game | Type | RTP | Notes |
| --- | --- | --- | --- |
| Float Plinko | Instant | 99.0% | 3 risk levels × 8/12/16 rows, live binomial paytables |
| Lift Off (Crash) | Instant | 99.0% | Live multiplier graph, manual + auto cash-out |
| Deep Mines | Grid | 99.0% | 1–24 mines, 5×5 board, cash-out any time |
| Precision Dice | Instant | 99.0% | Roll over/under, adjustable win chance |
| High Limbo | Instant | 99.0% | Single multiplier up to 1,000,000× |
| Fortune Wheel | Wheel | 99.0% | 80 audited slices, exact 0.99 EV |
| Sky Tower | Climb | 99.0% | 8 floors, 3 difficulties, up to 253× |
| Neon Roulette | Table | 97.3% | European single-zero, full felt betting |

Every paytable is verified to its advertised RTP (`Σ probability × payout`). Plinko and Wheel
compute their RTP from the live table and display it in the UI.

## Provably fair

Outcomes derive from `HMAC_SHA256(serverSeed, "clientSeed:nonce:round")`, consuming 4 bytes per float:

```
float = uint32(first 4 bytes) / 2^32
```

- The server seed is hashed with SHA-256 and committed **before** betting (Fairness modal → commitment).
- Rotating the seed reveals the previous one for independent verification.
- Each settled bet stores the exact `nonce` and `clientSeed` used.
- The Fairness modal ships a working verifier (server seed + client seed + nonce → float, Lift Off,
  Limbo and Dice outcomes) so any round can be reproduced by hand.

## Features

- Dark neon casino shell: sticky header, category bar, win ticker, live chat dock, bottom nav
- Wallet: deposit / withdraw flows, 6 currencies, account settings, demo reset
- Rewards hub (daily, rakeback, race, VIP), welcome-bonus modal, VIP progress
- Stats drawer with per-game performance, bet history and streak tracking
- Procedural WebAudio SFX (no audio assets), sound toggle, reduced-motion support
- Keyboard: `Space` to play / cash out, `/` to search
- Hash routing (`#plinko`, `#crash`, …) so games are shareable and refreshable
- Fully responsive from 360 px to ultrawide

## Art

Original AI-generated game art, converted to WebP (~600 KB total for all 9 assets) in `public/art/`.

## Checks

`npm run build` runs the TypeScript compiler and Vite build. A headless render smoke suite lives in
`smoke/` and renders every page, game and modal through React's server renderer:

```bash
npx vite build --config smoke/vite.smoke.config.ts && node smoke/dist/entry.js
```
