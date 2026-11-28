import React from 'react'
import { IconChevronLeft, IconShield } from '../components/Icons'

/**
 * What we keep about a player, in plain words.
 *
 * WHY THIS PAGE EXISTS
 *
 * The app now records the address and city each session arrives from, for fraud
 * and security review. Recording that without telling the person is the part that
 * turns a reasonable safety measure into something they would rightly object to.
 * A Ugandan player handing over a phone number and a location deserves the same
 * answer to "what do you have on me" that any other regulator would require.
 *
 * The wording is deliberately concrete: which events, how long, who can see it,
 * and what it is NOT used for. A policy nobody can read is not a disclosure.
 */

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="panel mb-2 px-3.5 py-3">
    <h2 className="mb-1.5 text-[12.5px] font-bold text-white">{title}</h2>
    <div className="space-y-1.5 text-[11.5px] leading-relaxed text-slate-400">{children}</div>
  </section>
)

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-8">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10"
        >
          <IconChevronLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-bold text-white">Privacy and security records</h1>
          <p className="text-[10.5px] text-slate-500">What we keep, why, and for how long</p>
        </div>
      </div>

      <Block title="Where you sign in from">
        <p>
          When you sign in — and at most once every 30 minutes while you keep playing — we record
          the network address (IP) your connection came from, the country and city that address
          belongs to, and a short description of the device. If you allow location access, the
          approximate position of your device is also recorded.
        </p>
        <p>
          We do <span className="font-bold text-slate-200">not</span> record your location for each
          bet, spin or page. Those events say nothing about where you are that a sign-in record
          does not already, and a betting app that follows every spin is a tracking device, not a
          casino.
        </p>
      </Block>

      <Block title="How precise it is">
        <p>
          Your device's position is rounded to two decimal places before it is stored — about one
          kilometre — and the exact figures are discarded immediately. The address is stored as it
          arrived; it tells us roughly which city and network you used, not a street.
        </p>
        <p>
          We treat the position from your phone as a claim, not a fact: any device can report a
          location it does not have. It is shown to our security staff labelled unverified, and it
          is never the only reason anything happens to an account.
        </p>
      </Block>

      <Block title="Why we keep it">
        <ul className="list-disc space-y-1 pl-4">
          <li>A sign-in from a new country or city, flagged for review rather than blocked.</li>
          <li>Two accounts on one address — the shape of bonus abuse and multi-accounting.</li>
          <li>
            A record that exists when a withdrawal is disputed, a payment is reversed, or a
            regulator asks where an account was used.
          </li>
          <li>Giving you your own sign-in history, so you can see if someone else is in your account.</li>
        </ul>
        <p className="text-slate-500">
          It is not used to decide a bet, change an odds or payout, set a limit, or rank players.
          No game or payment code reads these records.
        </p>
      </Block>

      <Block title="Who can see it">
        <p>
          You can see your own history, city by city, in support. Admins can see one player's
          record at a time, by looking that player up; there is no screen that lists everyone's
          addresses, and every lookup is written to an admin audit log. There is no player-facing
          or public API that returns anyone's address.
        </p>
      </Block>

      <Block title="How long we keep it">
        <p>
          Addresses and coordinates older than 180 days are erased automatically. The fact that an
          account signed in from a given country on a given day is kept as part of the account's
          history, without the address attached.
        </p>
        <p>
          Deleting your account deletes its session records with it.
        </p>
      </Block>

      <Block title="Your other data">
        <p>
          Your phone number is used for sign-in and for mobile-money payouts, and is visible only
          to you and to admins. Balances, bets and withdrawals are kept as a financial record. Your
          username is public on the leaderboards and chat; your phone number and address are not.
        </p>
      </Block>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
        <IconShield size={15} className="mt-0.5 shrink-0 text-emerald-400" />
        <p className="text-[11px] leading-relaxed text-emerald-200/80">
          If something in your sign-in history looks wrong, contact support from the app. We can
          end all sessions on the account and review the record with you.
        </p>
      </div>

      <p className="mt-4 text-center text-[9.5px] leading-relaxed text-slate-600">
        Last updated 14 November 2026 · FloatBet Gaming · 18+
      </p>
    </div>
  )
}
