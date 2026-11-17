import React from 'react'

/**
 * A real CSS-3D die: six faces on a preserve-3d cube, rotating to whichever
 * face corresponds to the rolled value. Pips are drawn as inset spheres.
 */

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
}

function Face({ value, transform, size }: { value: number; transform: string; size: number }) {
  return (
    <div
      className="absolute inset-0 rounded-[18%] border border-white/25"
      style={{
        transform,
        backfaceVisibility: 'hidden',
        background:
          'radial-gradient(circle at 32% 26%, #fbfff0 0%, #e8f7c9 32%, #bfe08a 62%, #8fb95f 100%)',
        boxShadow:
          'inset 0 2px 10px rgba(255,255,255,.85), inset 0 -14px 26px -12px rgba(40,60,20,.75), 0 0 30px -6px rgba(198,242,78,.5)',
        width: size,
        height: size,
      }}
    >
      {PIPS[value].map(([x, y], i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: size * 0.16,
            height: size * 0.16,
            transform: 'translate(-50%,-50%)',
            background: 'radial-gradient(circle at 35% 30%, #5c6b4a, #1d2417 70%)',
            boxShadow: 'inset 0 1px 2px rgba(255,255,255,.35), inset 0 -1px 2px rgba(0,0,0,.8)',
          }}
        />
      ))}
    </div>
  )
}

export function Dice3D({
  value,
  rolling,
  size = 130,
  tumble = 0,
}: {
  /** landed value 1..6, or null while idle */
  value: number | null
  rolling: boolean
  size?: number
  /** increments each roll to re-randomise the tumble */
  tumble?: number
}) {
  // face rotations that present each value toward the camera
  const SHOW: Record<number, string> = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateY(-90deg)',
    3: 'rotateX(-90deg)',
    4: 'rotateX(90deg)',
    5: 'rotateY(90deg)',
    6: 'rotateY(180deg)',
  }
  const spin = rolling
    ? `rotateX(${360 * (2 + (tumble % 3))}deg) rotateY(${360 * (3 + (tumble % 4))}deg) rotateZ(${180 * (1 + (tumble % 2))}deg)`
    : SHOW[value ?? 1]

  const h = size / 2

  return (
    <div
      className="grid place-items-center"
      style={{ perspective: `${size * 3.4}px`, width: size, height: size }}
    >
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          transformStyle: 'preserve-3d',
          transform: spin,
          transition: rolling
            ? 'transform 380ms cubic-bezier(.4,0,.6,1)'
            : 'transform 900ms cubic-bezier(.2,1.4,.4,1)',
        }}
      >
        <Face value={6} transform={`translateZ(${h}px)`} size={size} />
        <Face value={1} transform={`rotateY(180deg) translateZ(${h}px)`} size={size} />
        <Face value={5} transform={`rotateY(90deg) translateZ(${h}px)`} size={size} />
        <Face value={2} transform={`rotateY(-90deg) translateZ(${h}px)`} size={size} />
        <Face value={3} transform={`rotateX(90deg) translateZ(${h}px)`} size={size} />
        <Face value={4} transform={`rotateX(-90deg) translateZ(${h}px)`} size={size} />
      </div>
      {/* contact shadow */}
      <div
        className="pointer-events-none absolute rounded-[50%]"
        style={{
          width: size * 1.05,
          height: size * 0.2,
          marginTop: size * 1.15,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,.6), transparent 70%)',
          filter: 'blur(4px)',
        }}
      />
    </div>
  )
}
