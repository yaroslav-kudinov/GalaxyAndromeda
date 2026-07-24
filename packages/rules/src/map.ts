import type { HexCoord, MapDefinition } from './types.js'
import { hexKey } from './types.js'

/** Axial hex directions (flat-top) */
export const HEX_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function addHex(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function neighbor(coord: HexCoord, directionIndex: number): HexCoord {
  const dir = HEX_DIRECTIONS[directionIndex]
  if (!dir) throw new RangeError(`Invalid direction index: ${directionIndex}`)
  return addHex(coord, dir)
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  )
}

export function getCellKeys(map: MapDefinition): Set<string> {
  return new Set(map.cells.map((c) => hexKey(c.q, c.r)))
}

export function getGhostSlots(map: MapDefinition): HexCoord[] {
  const existing = getCellKeys(map)
  const ghosts: HexCoord[] = []
  const seen = new Set<string>()

  for (const cell of map.cells) {
    for (let i = 0; i < 6; i++) {
      const n = neighbor(cell, i)
      const key = hexKey(n.q, n.r)
      if (existing.has(key) || seen.has(key)) continue
      seen.add(key)
      ghosts.push(n)
    }
  }
  return ghosts
}

export function validateMapDefinition(map: MapDefinition): string[] {
  const errors: string[] = []
  if (!map.id?.trim()) errors.push('Map id is required')
  if (!map.name?.trim()) errors.push('Map name is required')
  const keys = new Set<string>()
  for (const cell of map.cells) {
    const key = hexKey(cell.q, cell.r)
    if (keys.has(key)) errors.push(`Duplicate cell ${key}`)
    keys.add(key)
    for (const token of cell.resourceTokens ?? []) {
      if (token.value < 1 || token.value > 9) {
        errors.push(`Invalid token value at ${key}`)
      }
    }
  }
  return errors
}

export function createEmptyMap(id = 'new', name = 'New Map'): MapDefinition {
  return { id, name, cells: [{ q: 0, r: 0 }] }
}
