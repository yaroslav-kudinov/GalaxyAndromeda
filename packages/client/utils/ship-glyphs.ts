import type { ShipType } from '@galaxy/rules'

export interface ShipGlyphDef {
  /** Main silhouette; use evenodd subpaths for slits, windows, and notches */
  body: string
  /** Optional stroke-only accent (antenna, ring highlight) */
  accent?: string
}

export interface BoardShip {
  type: ShipType
  player: number
}

/**
 * SVG shapes in ~24×24 viewBox, centered at origin.
 * Each type has a distinct silhouette readable at board scale (~0.5).
 */
export const SHIP_GLYPHS: Record<ShipType, ShipGlyphDef> = {
  /** Narrow wedge — smallest hull, side engine slits */
  destroyer: {
    body: [
      'M0,-11 L5.5,8 L-5.5,8 Z',
      'M-3.5,3 L-1.5,6.5 L-0.5,3 L-2.5,0.5 Z',
      'M3.5,3 L1.5,6.5 L0.5,3 L2.5,0.5 Z',
    ].join(' '),
  },

  /** Medium hull — bridge block + deck slit */
  cruiser: {
    body: [
      'M0,-10.5 L8.5,8 L-8.5,8 Z',
      'M-2.5,-6 L2.5,-6 L2.5,-3.5 L-2.5,-3.5 Z',
      'M-4,2 L4,2 L4,4 L-4,4 Z',
    ].join(' '),
  },

  /** Broad hull — twin turrets + double deck slits */
  battleship: {
    body: [
      'M0,-10 L10,8 L-10,8 Z',
      'M-7.5,-5.5 L-4.5,-5.5 L-4.5,-2.5 L-7.5,-2.5 Z',
      'M7.5,-5.5 L4.5,-5.5 L4.5,-2.5 L7.5,-2.5 Z',
      'M-5.5,1.5 L5.5,1.5 L5.5,3.5 L-5.5,3.5 Z',
      'M-3.5,5.5 L3.5,5.5 L3.5,7 L-3.5,7 Z',
    ].join(' '),
  },

  /** Hull with shield-generator ring (evenodd donut) */
  shield: {
    body: [
      'M0,-10 L8,7.5 L-8,7.5 Z',
      'M0,-5.5 m-4.5,0 a4.5,4.5 0 1,0 9,0 a4.5,4.5 0 1,0 -9,0',
      'M0,-3.5 m-2.5,0 a2.5,2.5 0 1,0 5,0 a2.5,2.5 0 1,0 -5,0',
    ].join(' '),
  },

  /** Four-point star — wing notches + central diamond slit */
  hyper: {
    body: [
      'M0,-10 L3,-2 L10,0 L3,2 L0,10 L-3,2 L-10,0 L-3,-2 Z',
      'M0,-6 L1.2,-0.5 L0,5 L-1.2,-0.5 Z',
      'M-6,-1 L-4,0 L-6,1 L-7,0 Z',
      'M6,-1 L4,0 L6,1 L7,0 Z',
    ].join(' '),
  },

  /** Boxy freighter — cargo bays + crane notch (non-triangle silhouette) */
  supply: {
    body: [
      'M-7.5,-6.5 L7.5,-6.5 L7.5,8.5 L-7.5,8.5 Z',
      'M-1.5,-6.5 L1.5,-6.5 L1.5,-4 L-1.5,-4 Z',
      'M-4.5,-2.5 L4.5,-2.5 L4.5,1.5 L-4.5,1.5 Z',
      'M-3,4 L3,4 L3,6.5 L-3,6.5 Z',
    ].join(' '),
  },
}

/** Editor / single-player cluster (up to 4 ships) */
export const SHIP_BOARD_SCALE = 0.58

/** Compact scale when two players share a hex (up to 8 ships) */
export const SHIP_BOARD_SCALE_COMPACT = 0.46

const SINGLE_PLAYER_SLOTS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 0, y: 12 }],
  2: [
    { x: -12, y: 12 },
    { x: 12, y: 12 },
  ],
  3: [
    { x: -13, y: 8 },
    { x: 13, y: 8 },
    { x: 0, y: 19 },
  ],
  4: [
    { x: -12, y: 7 },
    { x: 12, y: 7 },
    { x: -12, y: 19 },
    { x: 12, y: 19 },
  ],
}

/** 2×2 grid relative to a player's side anchor */
const SIDE_GRID = [
  { x: -5, y: 4 },
  { x: 5, y: 4 },
  { x: -5, y: 13 },
  { x: 5, y: 13 },
]

const SIDE_ANCHORS = [-17, 17, -9, 9, -17, 17]

/** Tighter grid for overview zoom — keeps glyph shapes readable inside the hex */
const OVERVIEW_SINGLE: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 0, y: 6 }],
  2: [
    { x: -8, y: 6 },
    { x: 8, y: 6 },
  ],
  3: [
    { x: -9, y: 2 },
    { x: 9, y: 2 },
    { x: 0, y: 12 },
  ],
  4: [
    { x: -8, y: 2 },
    { x: 8, y: 2 },
    { x: -8, y: 12 },
    { x: 8, y: 12 },
  ],
}

const OVERVIEW_SIDE_GRID = [
  { x: -4, y: 2 },
  { x: 4, y: 2 },
  { x: -4, y: 10 },
  { x: 4, y: 10 },
]

const OVERVIEW_SIDE_ANCHORS = [-12, 12, -6, 6, -12, 12]

/** Layout offsets from hex center for ships on the board */
export function layoutShipPositions(ships: BoardShip[]): { x: number; y: number }[] {
  if (!ships.length) return []

  const players = [...new Set(ships.map((ship) => ship.player))].sort((a, b) => a - b)
  const slotByPlayer = new Map<number, number>()

  if (players.length === 1) {
    const slots = SINGLE_PLAYER_SLOTS[Math.min(ships.length, 4)] ?? SINGLE_PLAYER_SLOTS[4]
    return ships.map((_, idx) => slots[idx] ?? slots[slots.length - 1])
  }

  const baseY = 9
  return ships.map((ship) => {
    const playerIndex = players.indexOf(ship.player)
    const slotIndex = slotByPlayer.get(ship.player) ?? 0
    slotByPlayer.set(ship.player, slotIndex + 1)
    const anchorX = SIDE_ANCHORS[playerIndex] ?? (playerIndex % 2 === 0 ? -17 : 17)
    const grid = SIDE_GRID[Math.min(slotIndex, SIDE_GRID.length - 1)]
    return { x: anchorX + grid.x, y: baseY + grid.y }
  })
}

/** Compact centered layout for operational / strategic zoom */
export function layoutShipPositionsOverview(ships: BoardShip[]): { x: number; y: number }[] {
  if (!ships.length) return []

  const players = [...new Set(ships.map((ship) => ship.player))].sort((a, b) => a - b)
  const slotByPlayer = new Map<number, number>()

  if (players.length === 1) {
    const slots = OVERVIEW_SINGLE[Math.min(ships.length, 4)] ?? OVERVIEW_SINGLE[4]
    return ships.map((_, idx) => slots[idx] ?? slots[slots.length - 1])
  }

  return ships.map((ship) => {
    const playerIndex = players.indexOf(ship.player)
    const slotIndex = slotByPlayer.get(ship.player) ?? 0
    slotByPlayer.set(ship.player, slotIndex + 1)
    const anchorX = OVERVIEW_SIDE_ANCHORS[playerIndex] ?? (playerIndex % 2 === 0 ? -12 : 12)
    const grid = OVERVIEW_SIDE_GRID[Math.min(slotIndex, OVERVIEW_SIDE_GRID.length - 1)]
    return { x: anchorX + grid.x, y: 4 + grid.y }
  })
}

export function shipBoardScale(ships: BoardShip[]): number {
  const players = new Set(ships.map((ship) => ship.player)).size
  if (players > 1 || ships.length > 4) return SHIP_BOARD_SCALE_COMPACT
  if (ships.length >= 4) return 0.52
  return SHIP_BOARD_SCALE
}

/** @deprecated use layoutShipPositions */
export function shipSlotOffsets(count: number): { x: number; y: number }[] {
  const slots = SINGLE_PLAYER_SLOTS[Math.min(count, 4)] ?? SINGLE_PLAYER_SLOTS[4]
  return slots.slice(0, count)
}
