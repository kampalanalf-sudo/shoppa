/**
 * Tiny WebAudio synth: all casino SFX are generated at runtime (no audio assets).
 * Playback is muted globally until the user enables sound in the header.
 */
let ctx: AudioContext | null = null
let enabled = true

export const setSoundEnabled = (v: boolean) => {
  enabled = v
}

const ac = () => {
  if (!enabled) return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

type ToneOpts = {
  freq: number
  to?: number
  dur?: number
  type?: OscillatorType
  gain?: number
  delay?: number
}

function tone({ freq, to, dur = 0.14, type = 'sine', gain = 0.09, delay = 0 }: ToneOpts) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** Two detuned oscillators + a slight vibrato make a much fatter tone. */
function fat(
  freq: number,
  {
    to, dur = 0.2, type = 'sine', gain = 0.08, delay = 0, detune = 8, vibrato = 0,
  }: { to?: number; dur?: number; type?: OscillatorType; gain?: number; delay?: number; detune?: number; vibrato?: number } = {},
) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + delay
  for (const d of [-detune, detune]) {
    const osc = a.createOscillator()
    const g = a.createGain()
    osc.type = type
    osc.detune.value = d
    osc.frequency.setValueAtTime(freq, t0)
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(28, to), t0 + dur)
    if (vibrato) {
      const lfo = a.createOscillator()
      const lg = a.createGain()
      lfo.frequency.value = 5.5
      lg.gain.value = vibrato
      lfo.connect(lg).connect(osc.frequency)
      lfo.start(t0)
      lfo.stop(t0 + dur + 0.03)
    }
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain * 0.6, t0 + 0.014)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(a.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.03)
  }
}

/** Bandpass-swept noise: used for reel whooshes and mechanical clunks. */
function whoosh(dur = 0.3, gain = 0.05, from = 400, to = 4000) {
  const a = ac()
  if (!a) return
  const len = Math.max(1, Math.floor(a.sampleRate * dur))
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    const env = Math.sin((i / len) * Math.PI)
    data[i] = (Math.random() * 2 - 1) * env
  }
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 1.4
  f.frequency.setValueAtTime(from, a.currentTime)
  f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur)
  const g = a.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(a.destination)
  src.start()
}

/** Metallic click: two short square blips through a high filter. */
function clunk(gain = 0.05, delay = 0) {
  tone({ freq: 180, to: 90, dur: 0.06, type: 'square', gain, delay })
  tone({ freq: 1400, to: 900, dur: 0.03, type: 'square', gain: gain * 0.4, delay: delay + 0.005 })
}

function noise(dur = 0.08, gain = 0.05, hp = 1200) {
  const a = ac()
  if (!a) return
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = a.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(a.destination)
  src.start()
}

export const sfx = {
  click: () => tone({ freq: 320, to: 260, dur: 0.05, type: 'triangle', gain: 0.045 }),
  place: () => {
    tone({ freq: 220, to: 340, dur: 0.1, type: 'triangle', gain: 0.07 })
    tone({ freq: 520, dur: 0.07, type: 'sine', gain: 0.04, delay: 0.03 })
  },
  tick: () => tone({ freq: 900, to: 1100, dur: 0.035, type: 'square', gain: 0.02 }),
  peg: (i = 0) => tone({ freq: 520 + (i % 7) * 70, to: 640 + (i % 7) * 70, dur: 0.045, type: 'triangle', gain: 0.035 }),
  win: () => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      fat(f, { dur: 0.26, type: 'sine', gain: 0.085, delay: i * 0.07 }),
    )
    fat(1567.98, { dur: 0.3, type: 'triangle', gain: 0.05, delay: 0.3 })
  },
  bigwin: () => {
    ;[523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093].forEach((f, i) =>
      fat(f, { dur: 0.4, type: 'triangle', gain: 0.09, delay: i * 0.075, vibrato: 4 }),
    )
    whoosh(0.5, 0.035, 800, 6000)
    noise(0.35, 0.025, 3500)
  },
  lose: () => {
    fat(220, { to: 110, dur: 0.3, type: 'sawtooth', gain: 0.06 })
    tone({ freq: 90, to: 60, dur: 0.34, type: 'sine', gain: 0.04, delay: 0.04 })
  },
  /* --- slot-specific cues --- */
  spinStart: () => {
    whoosh(0.34, 0.045, 300, 5200)
    fat(140, { to: 210, dur: 0.18, type: 'triangle', gain: 0.05 })
  },
  reelStop: (i = 0) => {
    clunk(0.05, i * 0.02)
    fat(300 + i * 40, { to: 180, dur: 0.1, type: 'triangle', gain: 0.045 })
  },
  reelLoop: () => {
    tone({ freq: 1500, to: 1200, dur: 0.02, type: 'square', gain: 0.012 })
  },
  scatter: () => {
    ;[880, 1174.66, 1567.98].forEach((f, i) =>
      fat(f, { dur: 0.22, type: 'sine', gain: 0.07, delay: i * 0.05 }),
    )
  },
  freespin: () => {
    ;[659.25, 830.61, 987.77, 1318.5].forEach((f, i) =>
      fat(f, { dur: 0.34, type: 'triangle', gain: 0.085, delay: i * 0.11, vibrato: 3 }),
    )
    whoosh(0.6, 0.03, 600, 7000)
  },
  /** Faith / bad omen: dissonant, descending, unsettling. */
  omen: () => {
    fat(311.13, { to: 233.08, dur: 0.5, type: 'sawtooth', gain: 0.07, vibrato: 12 })
    fat(220, { to: 146.83, dur: 0.7, type: 'sine', gain: 0.06, delay: 0.08, vibrato: 9 })
    fat(155.56, { to: 77.78, dur: 0.9, type: 'triangle', gain: 0.055, delay: 0.16 })
    whoosh(0.7, 0.04, 2000, 160)
    noise(0.4, 0.02, 300)
  },
  ratchet: () => {
    for (let i = 0; i < 4; i++) clunk(0.03, i * 0.045)
  },
  gem: () => {
    tone({ freq: 880, to: 1320, dur: 0.12, type: 'sine', gain: 0.06 })
    tone({ freq: 1320, dur: 0.08, type: 'sine', gain: 0.03, delay: 0.05 })
  },
  bomb: () => {
    noise(0.35, 0.12, 180)
    tone({ freq: 120, to: 40, dur: 0.4, type: 'sawtooth', gain: 0.1 })
  },
  spin: () => {
    let i = 0
    const iv = window.setInterval(() => {
      tone({ freq: 1200 - i * 22, dur: 0.02, type: 'square', gain: 0.016 })
      if (i % 3 === 0) clunk(0.02)
      i++
      if (i > 26) window.clearInterval(iv)
    }, 55)
  },
  cashout: () => {
    tone({ freq: 660, to: 990, dur: 0.18, type: 'triangle', gain: 0.08 })
    tone({ freq: 990, dur: 0.3, type: 'sine', gain: 0.05, delay: 0.1 })
  },
  crash: () => {
    noise(0.5, 0.1, 300)
    tone({ freq: 320, to: 60, dur: 0.5, type: 'sawtooth', gain: 0.08 })
  },
  deposit: () => {
    ;[784, 1046.5].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'sine', gain: 0.06, delay: i * 0.08 }))
  },
}

export type SfxName = keyof typeof sfx
