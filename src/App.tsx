import { useCallback, useEffect, useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { AuthProvider, useAuth } from './lib/auth'
import { setSoundEnabled } from './lib/sound'
import { Header, Footer, BottomBar, ChatDock, Toasts, WinFlash } from './components/Chrome'
import { InstallPrompt } from './components/InstallPrompt'
import { StudioIdent } from './components/StudioIdent'
import { SearchModal, WalletModal, FairModal, HistoryModal, RewardsModal } from './components/Modals'
import { Home } from './pages/Home'
import { ProxiCash } from './pages/ProxiCash'
import { Auth } from './pages/Auth'
import { Onboarding } from './pages/Onboarding'
import { SetPassword } from './pages/SetPassword'
import { Sportsbook } from './pages/Sportsbook'
import { Cashout } from './pages/Cashout'
import { ChatRoom } from './components/ChatRoom'
import { TopUpPanel } from './components/TopUpPanel'
import { TopUpSuccess } from './pages/TopUpSuccess'
import { AdminParked } from './pages/AdminParked'
import { AdminPlayers } from './pages/AdminPlayers'
import { AdminConsole } from './pages/AdminConsole'
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

type View =
  | { name: 'home' }
  | { name: 'game'; id: GameId }
  | { name: 'proxicash' }
  | { name: 'cashout' }
  | { name: 'auth' }
  | { name: 'set-password' }
  | { name: 'sportsbook' }
  | { name: 'topup-success'; reference: string | null }
  | { name: 'admin-parked' }
  | { name: 'admin-players' }
  | { name: 'admin-console' }

function Shell() {
  const { sound, setFairOpen, setWalletOpen, hydrated } = useStore()
  const { configured, ready, user, needsOnboarding } = useAuth()
  const [onboarded, setOnboarded] = useState(false)
  const [view, setView] = useState<View>({ name: 'home' })
  const [search, setSearch] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => setSoundEnabled(sound), [sound])

  const openGame = useCallback((id: GameId) => {
    setView({ name: 'game', id })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  const goHome = useCallback(() => {
    setView({ name: 'home' })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    // Clear the hash too, or a back-then-refresh sends you straight back to the
    // view you just left.
    try {
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch { /* noop */ }
  }, [])

  // URL hash routing so games are shareable/refreshable
  useEffect(() => {
    const apply = () => {
      // Supabase appends its recovery params (`#reset-password&access_token=…`
      // or `#reset-password?code=…`) to whatever redirect hash it was given, so
      // split on both separators before matching, and strip a trailing slash.
      const raw = window.location.hash.replace(/^#/, '')
      const h = raw.split(/[?&]/)[0].replace(/\/$/, '')
      if (h === 'proxicash') { setView({ name: 'proxicash' }); return }
      if (h === 'cashout') { setView({ name: 'cashout' }); return }
      // Sports needs an account: a slip is attached to a wallet.
      if (h === 'sports' || h === 'sportsbook') { setView({ name: 'sportsbook' }); return }
      if (h === 'auth') { setView({ name: 'auth' }); return }
      // Recovery link landing. Supabase sends the browser back here with a
      // session already established; without this route the reset link was a
      // dead end that dropped the player on the home page with a stale hash.
      if (h === 'reset-password') { setView({ name: 'set-password' }); return }
      if (h === 'verified') { setView({ name: 'auth' }); return }
      if (h === 'admin/parked') { setView({ name: 'admin-parked' }); return }
      if (h === 'admin/players') { setView({ name: 'admin-players' }); return }
      // 'admin' lands on the console: health first, because the most common
      // question an operator has is 'is anything broken right now'.
      if (h === 'admin' || h === 'admin/console') { setView({ name: 'admin-console' }); return }
      if (h.startsWith('topup-success')) {
        const ref = new URLSearchParams(raw.split('?')[1] || '').get('reference')
        setView({ name: 'topup-success', reference: ref })
        return
      }
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

  const openCashout = useCallback(() => {
    setView({ name: 'cashout' })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    try { window.history.replaceState(null, '', '#cashout') } catch { /* noop */ }
  }, [])

  // Sports is a view, not a game, so it needs its own opener. The hash matters:
  // without it a refresh dropped you back on the home page instead of reloading
  // the board you were looking at.
  const openSportsbook = useCallback(() => {
    setView({ name: 'sportsbook' })
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    try { window.history.replaceState(null, '', '#sports') } catch { /* noop */ }
  }, [])

  const openSuccess = useCallback((reference: string | null) => {
    setView({ name: 'topup-success', reference })
    try {
      window.history.replaceState(
        null, '', reference ? `#topup-success?reference=${encodeURIComponent(reference)}` : '#topup-success',
      )
    } catch { /* noop */ }
  }, [])

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

  // With a backend configured, an account is required: the wallet, chat and
  // cashout all belong to a user. Without one the app runs local-only.
  if (configured) {
    if (!ready) {
      return (
        <div className="grid min-h-screen place-items-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-neon-lime/25 border-t-neon-lime" />
        </div>
      )
    }
    if (!user) {
      return (
        <>
          <Header view="home" onNavigate={() => {}} onSearch={() => {}} />
          <Auth />
          <Toasts />
        </>
      )
    }
    if (needsOnboarding && !onboarded) {
      return (
        <>
          <Header view="home" onNavigate={() => {}} onSearch={() => {}} />
          <Onboarding onDone={() => setOnboarded(true)} />
          <Toasts />
        </>
      )
    }
  }

  const current = view.name === 'game' ? view.id : null
  const isProxiCash = view.name === 'proxicash'
  const shared = { onBack: home, onFair: () => setFairOpen(true) }

  return (
    <div className="min-h-screen">
      <Header
        view={view.name === 'game' ? 'game' : view.name === 'proxicash' ? 'proxicash' : view.name === 'sportsbook' ? 'sportsbook' : 'home'}
        onNavigate={(v, id) =>
          v === 'game' && id
            ? play(id)
            : v === 'sportsbook'
              // Without this branch every Sports link — the nav item, the
              // account menu entry, the category pill and the mobile tab — fell
              // through to home(), so "Sports" looked like a dead button.
              ? openSportsbook()
              : v === 'proxicash'
                ? openProxiCash()
                : v === 'cashout'
                  ? openCashout()
                  : v === 'topup'
                    ? setTopUpOpen(true)
                    : home()
        }
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
        {view.name === 'cashout' && <Cashout onBack={home} />}
        {view.name === 'auth' && <Auth onDone={home} />}
        {view.name === 'set-password' && <SetPassword onDone={home} />}
        {view.name === 'sportsbook' && <Sportsbook onBack={home} />}
        {/* Placeholder kept so the grid does not shift while loading. */}
        {view.name === 'admin-parked' && <AdminParked onHome={home} />}
        {view.name === 'admin-players' && <AdminPlayers onHome={home} />}
        {view.name === 'admin-console' && <AdminConsole onHome={home} />}
        {view.name === 'topup-success' && (
          <TopUpSuccess
            reference={view.reference}
            onHome={home}
            onTopUpAgain={() => { home(); setTopUpOpen(true) }}
          />
        )}
        {!current && !isProxiCash && view.name !== 'sportsbook' && <Home onPlay={play} onSearch={() => setSearch(true)} onFair={() => setFairOpen(true)} onProxiCash={openProxiCash} onSports={openSportsbook} />}
      </main>

      <Footer />
      <div className="h-16 md:hidden" />
      <BottomBar
        view={view.name === 'game' ? 'game' : view.name === 'proxicash' ? 'proxicash' : view.name === 'sportsbook' ? 'sportsbook' : 'home'}
        onNavigate={(v, id) =>
          v === 'game' && id
            ? play(id)
            : v === 'sportsbook'
              // Without this branch every Sports link — the nav item, the
              // account menu entry, the category pill and the mobile tab — fell
              // through to home(), so "Sports" looked like a dead button.
              ? openSportsbook()
              : v === 'proxicash'
                ? openProxiCash()
                : v === 'cashout'
                  ? openCashout()
                  : v === 'topup'
                    ? setTopUpOpen(true)
                    : home()
        }
      />
      <ChatDock onOpenRoom={() => setRoomOpen(true)} />
      {roomOpen && <ChatRoom onClose={() => setRoomOpen(false)} />}
      {topUpOpen && (
        <TopUpPanel
          onClose={() => setTopUpOpen(false)}
          onStarted={(ref) => { setTopUpOpen(false); openSuccess(ref) }}
        />
      )}
      <WinFlash />
      <InstallPrompt />
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
    <AuthProvider>
      <StoreProvider>
        {/* Studio ident sits ABOVE the shell, not inside the boot branch:
            hydration finishes in a few ms, so mounting it there would unmount
            it before it had animated. Here it covers the whole boot — the
            landing page and a game opened by hash URL alike. */}
        <StudioIdent />
        <Shell />
      </StoreProvider>
    </AuthProvider>
  )
}
