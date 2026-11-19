import React, { useEffect, useState } from 'react'
import {
  applyUpdate, isIos, isStandalone, onInstallAvailable, promptInstall,
} from '../lib/pwa'
import { IconClose, IconArrowUpRight } from './Icons'

const DISMISS_KEY = 'floatbet.install.dismissed'

/**
 * Bottom sheet offering to install the app.
 *
 * Deliberately quiet: it never appears on first paint, never repeats after a
 * dismissal, and never appears inside an installed app. A prompt that fights
 * the player for attention on a betting screen is a dark pattern.
 */
export function InstallPrompt() {
  const [available, setAvailable] = useState(false)
  const [iosHint, setIosHint] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (isStandalone()) return undefined

    const dismissed = (() => {
      try {
        return localStorage.getItem(DISMISS_KEY) === '1'
      } catch {
        return false
      }
    })()
    if (dismissed) return undefined

    const off = onInstallAvailable((ok) => {
      setAvailable(ok)
      // iOS never fires beforeinstallprompt, so offer the manual instruction.
      if (!ok && isIos()) setIosHint(true)
    })

    // Give the player a beat before asking for anything.
    const timer = window.setTimeout(() => setHidden(false), 6000)

    const onUpdate = () => setUpdateReady(true)
    window.addEventListener('sw:updated', onUpdate)

    return () => {
      off()
      window.clearTimeout(timer)
      window.removeEventListener('sw:updated', onUpdate)
    }
  }, [])

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* storage may be blocked; the sheet simply returns next visit */
    }
  }

  if (updateReady) {
    return (
      <Sheet onClose={() => setUpdateReady(false)}>
        <p className="text-[13px] font-bold text-white">Update available</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          A new version is ready. Finish what you are doing, then reload.
        </p>
        <div className="mt-2 flex gap-1.5">
          <button type="button" onClick={applyUpdate} className="btn-primary flex-1 !py-2 !text-[12px]">
            Reload now
          </button>
          <button type="button" onClick={() => setUpdateReady(false)} className="btn-ghost !px-3 !py-2 !text-[12px]">
            Later
          </button>
        </div>
      </Sheet>
    )
  }

  if (!hidden && (available || iosHint)) {
    return (
      <Sheet onClose={dismiss}>
        <div className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-white">Install FloatBet</p>
            <p className="text-[10.5px] text-slate-400">
              {available
                ? 'Full screen, opens instantly, no address bar.'
                : 'Tap Share, then “Add to Home Screen”.'}
            </p>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          {available ? (
            <button
              type="button"
              onClick={async () => {
                const ok = await promptInstall()
                if (!ok) dismiss()
                else setHidden(true)
              }}
              className="btn-primary flex-1 !py-2 !text-[12px]"
            >
              <IconArrowUpRight size={13} className="mr-1 inline" />
              Install
            </button>
          ) : (
            <div className="flex-1 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[10.5px] text-slate-400">
              Share <span aria-hidden>→</span> Add to Home Screen
            </div>
          )}
          <button type="button" onClick={dismiss} className="btn-ghost !px-3 !py-2 !text-[12px]">
            Not now
          </button>
        </div>
      </Sheet>
    )
  }

  return null
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 mx-auto w-full max-w-[400px] px-3">
      <div className="animate-popIn rounded-xl border border-white/10 bg-ink-850/98 p-3 shadow-pop backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute right-2 top-2 text-slate-600 hover:text-white"
        >
          <IconClose size={13} />
        </button>
        {children}
      </div>
    </div>
  )
}
