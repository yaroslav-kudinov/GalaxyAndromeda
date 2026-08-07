import type { ShipType } from '@galaxy/rules'

export interface ShipGlyphDef {
  /** Main silhouette (closed path), centered at origin in ~24×24 space */
  body: string
  /** Optional stroke-only marks (diagonal strikes); same stroke weight as hull border */
  accent?: string
}

export interface BoardShip {
  type: ShipType
  player: number
}

/** Rhombus (diamond) with half-diagonal `r` */
function diamond(r: number): string {
  return `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`
}

/**
 * SVG shapes in ~24×24 viewBox, centered at origin.
 * Bright player fill + black borders; type identity via simple geometry.
 */
export const SHIP_GLYPHS: Record<ShipType, ShipGlyphDef> = {
  /** Small diamond */
  destroyer: {
    body: diamond(6.2),
  },

  /** Medium diamond + one diagonal strike (edge to edge) */
  cruiser: {
    body: diamond(7.8),
    accent: 'M-3.9,-3.9 L3.9,3.9',
  },

  /** Larger diamond + two parallel diagonal strikes */
  battleship: {
    body: diamond(9.4),
    accent: 'M-5.6,-2.8 L2.8,5.6 M-2.8,-5.6 L5.6,2.8',
  },

  /** Downward triangle */
  shield: {
    body: 'M0,9 L9,-6.5 L-9,-6.5 Z',
  },

  /** Four-pointed star */
  hyper: {
    body: 'M0,-10.5 L2.4,-2.4 L10.5,0 L2.4,2.4 L0,10.5 L-2.4,2.4 L-10.5,0 L-2.4,-2.4 Z',
  },

  /** Square */
  supply: {
    body: 'M-7,-7 L7,-7 L7,7 L-7,7 Z',
  },
}

/** Editor / single-player cluster (up to 4 ships) */
export const SHIP_BOARD_SCALE = 0.81

/** Compact scale when two players share a hex (up to 8 ships) */
export const SHIP_BOARD_SCALE_COMPACT = 0.65

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
  if (ships.length >= 4) return 0.73
  return SHIP_BOARD_SCALE
}

/** @deprecated use layoutShipPositions */
export function shipSlotOffsets(count: number): { x: number; y: number }[] {
  const slots = SINGLE_PLAYER_SLOTS[Math.min(count, 4)] ?? SINGLE_PLAYER_SLOTS[4]
  return slots.slice(0, count)
}
