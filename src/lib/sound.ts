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
      tone({ freq: f, dur: 0.22, type: 'sine', gain: 0.075, delay: i * 0.075 }),
    )
  },
  bigwin: () => {
    ;[523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) =>
      tone({ freq: f, dur: 0.35, type: 'triangle', gain: 0.08, delay: i * 0.08 }),
    )
    noise(0.4, 0.02, 3000)
  },
  lose: () => {
    tone({ freq: 220, to: 110, dur: 0.26, type: 'sawtooth', gain: 0.05 })
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
      tone({ freq: 1200 - i * 18, dur: 0.02, type: 'square', gain: 0.018 })
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
