/** Pip positions on a resource token (normalized −1…1, y down) */

const HEX_RING = (radius: number): { x: number; y: number }[] =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 90)
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    }
  })

export const PIP_LAYOUTS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
  ],
  3: [
    { x: -0.52, y: -0.52 },
    { x: 0, y: 0 },
    { x: 0.52, y: 0.52 },
  ],
  4: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ],
  5: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0, y: 0 },
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ],
  6: [
    { x: -0.56, y: -0.72 },
    { x: -0.56, y: 0 },
    { x: -0.56, y: 0.72 },
    { x: 0.56, y: -0.72 },
    { x: 0.56, y: 0 },
    { x: 0.56, y: 0.72 },
  ],
  /** 6 pips on a hex ring + 1 center (honeycomb) */
  7: [{ x: 0, y: 0 }, ...HEX_RING(0.68)],
  8: [
    { x: -0.66, y: -0.66 },
    { x: 0, y: -0.66 },
    { x: 0.66, y: -0.66 },
    { x: -0.66, y: 0.66 },
    { x: 0, y: 0.66 },
    { x: 0.66, y: 0.66 },
    { x: -0.66, y: 0 },
    { x: 0.66, y: 0 },
  ],
  9: [
    { x: -0.66, y: -0.66 },
    { x: 0, y: -0.66 },
    { x: 0.66, y: -0.66 },
    { x: -0.66, y: 0 },
    { x: 0, y: 0 },
    { x: 0.66, y: 0 },
    { x: -0.66, y: 0.66 },
    { x: 0, y: 0.66 },
    { x: 0.66, y: 0.66 },
  ],
}

export const TOKEN_CHIP_RADIUS = 12
export const TOKEN_PIP_SPREAD = 6.1
export const TOKEN_PIP_RADIUS = 2.05

export const TOKEN_COLORS = {
  credits: {
    pip: '#FACC15',
    pipHighlight: '#FEF9C3',
    pipStroke: '#854D0E',
  },
  production: {
    pip: '#FB923C',
    pipHighlight: '#FFEDD5',
    pipStroke: '#9A3412',
  },
  chip: {
    face: '#EDE8DC',
    rim: '#9C8B6E',
    faceDown: '#64748B',
    rimDown: '#334155',
  },
} as const

export function pipPositions(value: number): { x: number; y: number }[] {
  const clamped = Math.min(9, Math.max(1, Math.round(value)))
  return PIP_LAYOUTS[clamped] ?? PIP_LAYOUTS[1]
}

/** Minimum center-to-center distance for current pip sizing (sanity check / tests) */
export function minPipSpacing(value: number): number {
  const pips = pipPositions(value)
  let min = Infinity
  for (let i = 0; i < pips.length; i++) {
    for (let j = i + 1; j < pips.length; j++) {
      const dx = (pips[i].x - pips[j].x) * TOKEN_PIP_SPREAD
      const dy = (pips[i].y - pips[j].y) * TOKEN_PIP_SPREAD
      min = Math.min(min, Math.hypot(dx, dy))
    }
  }
  return min
}
