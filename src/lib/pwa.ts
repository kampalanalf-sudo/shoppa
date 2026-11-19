// src/lib/pwa.ts
//
// Service-worker registration and install-prompt plumbing.
//
// Two deliberate choices:
//   * The service worker is only registered in a production build. In dev it
//     would cache the Vite module graph and serve stale modules, which is a
//     confusing way to lose an afternoon.
//   * A waiting update is only activated on an explicit user action, never
//     automatically. Reloading a player mid-spin (or mid-payment) is worse than
//     running one version behind for a minute.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<(available: boolean) => void>()

function announce(available: boolean) {
  listeners.forEach((fn) => fn(available))
}

/** Subscribe to install availability. Returns an unsubscribe function. */
export function onInstallAvailable(fn: (available: boolean) => void): () => void {
  listeners.add(fn)
  fn(deferredPrompt !== null)
  return () => listeners.delete(fn)
}

export function canInstall(): boolean {
  return deferredPrompt !== null
}

/** Show the native install sheet. Resolves true if the player accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  // A prompt event can only be used once.
  deferredPrompt = null
  announce(false)
  return outcome === 'accepted'
}

/** True when already running as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari predates display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  // Never in dev: the SW would cache the module graph.
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })

    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'UPDATED') window.dispatchEvent(new CustomEvent('sw:updated'))
    })
  })
}

/** Ask a waiting worker to activate, then reload. */
export function applyUpdate(): void {
  navigator.serviceWorker?.getRegistration().then((reg) => {
    reg?.waiting?.postMessage('SKIP_WAITING')
    window.location.reload()
  })
}

export function initInstallCapture(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    // Chrome shows its own mini-infobar otherwise, which we cannot style and
    // which fires at a bad moment. Take control of when it appears.
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    announce(true)
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    announce(false)
  })
}
