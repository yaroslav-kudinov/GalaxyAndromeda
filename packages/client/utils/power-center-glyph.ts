/** Board scale for power-center crown on hex cells (size ≈ 36) */
export const POWER_CENTER_BOARD_SCALE = 0.56

/** Crown paths in local coords; origin ≈ visual center of glyph */
export const POWER_CENTER_GLYPH = {
  /** Headband / base of crown */
  band: 'M-7.5,3.5 H7.5 V6.5 H-7.5 Z',
  /** Three peaks */
  body: 'M-7.5,3.5 L-5.5,-4 L-2,0.5 L0,-5.5 L2,0.5 L5.5,-4 L7.5,3.5 Z',
  /** Small jewel dots on peaks */
  jewels: [
    { cx: 0, cy: -4.2, r: 0.9 },
    { cx: -5.2, cy: -2.8, r: 0.75 },
    { cx: 5.2, cy: -2.8, r: 0.75 },
  ],
} as const

export const POWER_CENTER_COLORS = {
  fill: '#fde047',
  fillDark: '#eab308',
  stroke: '#854d0e',
  jewel: '#fef08a',
} as const
