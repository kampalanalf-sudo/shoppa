import { useCallback, useEffect, useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { setSoundEnabled } from './lib/sound'
import { Header, Footer, BottomBar, ChatDock, Toasts, WinFlash } from './components/Chrome'
import { SearchModal, WalletModal, FairModal, HistoryModal, RewardsModal } from './components/Modals'
import { Home } from './pages/Home'
import { ProxiCash } from './pages/ProxiCash'
import { BonniClyve } from './games/BonniClyve'
import { EngineSlot } from './games/EngineSlot'
import { CHAPE, BLUE_MOUNTAIN } from './lib/slots/games'
import { BAZAAR, BODA } from './lib/slots/games2'
import { Plinko } from './games/Plinko'
import { Crash } from './games/Crash'
import { Mines } from './games/Mines'
import { Dice } from './games/Dice'
import { Limbo } from './games/Limbo'
import { Wheel } from './games/Wheel'
import { Tower } from './games/Tower'
import { Roulette } from './games/Roulette'
import type { GameId } from './lib/types'

type View = { name: 'home' } | { name: 'game'; id: GameId } | { name: 'proxicash' }

function Shell() {
  const { sound, setFairOpen, setWalletOpen, hydrated } = useStore()
  const [view, setView] = useState<View>({ name: 'home' })
  const [search, setSearch] = useState(false)

  useEffect(() => setSoundEnabled(sound), [sound])

  const openGame = useCallback((id: GameId) => {
    setView({ name: 'game', id })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  const goHome = useCallback(() => {
    setView({ name: 'home' })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  // URL hash routing so games are shareable/refreshable
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace('#', '')
      if (h === 'proxicash') { setView({ name: 'proxicash' }); return }
      if (h && h !== 'home') {
        const known = ['bonni', 'plinko', 'crash', 'mines', 'dice', 'limbo', 'wheel', 'tower', 'roulette', 'chape', 'bluemountain', 'bazaar', 'boda']
        if (known.includes(h)) setView({ name: 'game', id: h as GameId })
      } else setView({ name: 'home' })
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  const play = (id: GameId) => {
    openGame(id)
    try { window.history.replaceState(null, '', `#${id}`) } catch { /* noop */ }
  }

  const openProxiCash = useCallback(() => {
    setView({ name: 'proxicash' })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    try { window.history.replaceState(null, '', '#proxicash') } catch { /* noop */ }
  }, [])

  const home = () => {
    goHome()
    try { window.history.replaceState(null, '', '#home') } catch { /* noop */ }
  }

  // global search hotkey "/"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === '/') { e.preventDefault(); setSearch(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!hydrated) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-neon-lime/25 border-t-neon-lime" />
          <p className="text-[11px] font-bold uppercase tracking-[.24em] text-slate-500">Loading FloatBet</p>
        </div>
      </div>
    )
  }

  const current = view.name === 'game' ? view.id : null
  const isProxiCash = view.name === 'proxicash'
  const shared = { onBack: home, onFair: () => setFairOpen(true) }

  return (
    <div className="min-h-screen">
      <Header
        view={view.name === 'game' ? 'game' : view.name === 'proxicash' ? 'proxicash' : 'home'}
        onNavigate={(v, id) => (v === 'game' && id ? play(id) : v === 'proxicash' ? openProxiCash() : home())}
        onSearch={() => setSearch(true)}
      />

      <main>
        {current === 'bonni' && <BonniClyve {...shared} />}
        {current === 'chape' && <EngineSlot config={CHAPE} id="chape" {...shared} />}
        {current === 'bluemountain' && <EngineSlot config={BLUE_MOUNTAIN} id="bluemountain" {...shared} />}
        {current === 'bazaar' && <EngineSlot config={BAZAAR} id="bazaar" {...shared} />}
        {current === 'boda' && <EngineSlot config={BODA} id="boda" {...shared} />}
        {current === 'plinko' && <Plinko {...shared} />}
        {current === 'crash' && <Crash {...shared} />}
        {current === 'mines' && <Mines {...shared} />}
        {current === 'dice' && <Dice {...shared} />}
        {current === 'limbo' && <Limbo {...shared} />}
        {current === 'wheel' && <Wheel {...shared} />}
        {current === 'tower' && <Tower {...shared} />}
        {current === 'roulette' && <Roulette {...shared} />}
        {isProxiCash && <ProxiCash onBack={home} />}
        {!current && !isProxiCash && <Home onPlay={play} onSearch={() => setSearch(true)} onFair={() => setFairOpen(true)} onProxiCash={openProxiCash} />}
      </main>

      <Footer />
      <div className="h-16 md:hidden" />
      <BottomBar
        view={view.name === 'game' ? 'game' : view.name === 'proxicash' ? 'proxicash' : 'home'}
        onNavigate={(v, id) => (v === 'game' && id ? play(id) : v === 'proxicash' ? openProxiCash() : home())}
      />
      <ChatDock />
      <WinFlash />
      <Toasts />
      <WalletModal />
      <FairModal />
      <HistoryModal />
      <RewardsModal />
      <SearchModal open={search} onClose={() => setSearch(false)} onPick={(id) => play(id as GameId)} />

      {/* mobile sticky wallet CTA. Hidden while a game is open: every game
          renders its own action bar there, and this button used to sit on top
          of the bet/Spin controls. */}
      {view.name !== 'game' && view.name !== 'proxicash' && (
        <button
          type="button"
          onClick={() => setWalletOpen(true)}
          className="fixed bottom-20 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-neon-lime to-neon-green text-ink-950 shadow-glow md:hidden"
          aria-label="Open wallet"
        >
          <span className="text-[10px] font-black leading-none">PX</span>
        </button>
      )}
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
