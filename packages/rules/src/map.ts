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

export { validateMapDefinition, normalizeMapDefinition, getCellResourceToken, setCellResourceToken, canAddShipToCell, countCellShips, extractCellContent, applyCellContent, inferMapPlayerCount, resolveMapPlayerCount, syncCellControlWithShips, inferCellControlFromShips } from './map-editor.js'
export type { MapCellContent } from './map-editor.js'
export {
  DEFAULT_SYMMETRY_SETTINGS,
  SYMMETRY_AXIS_LABELS,
  SYMMETRY_PLAYER_OPTIONS,
  getSymmetryAxisLabels,
  getSymmetryOrbit,
  horizontalThroughCentersPossible,
  reflectHex,
  remapCellContent,
  remapPlayerSlot,
  rotateHex,
  symmetryStepIndex,
} from './hex-symmetry.js'
export type { HexGridOrientation, SymmetryAxisKind, SymmetryPlayerCount, SymmetrySettings } from './hex-symmetry.js'
export {
  addCellOrbit,
  expandMapStructure,
  orbitKeysForCell,
  removeCellOrbit,
  syncCellOrbitContent,
} from './map-symmetry.js'
export { MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER, PLAYER_COLORS, PLAYER_LABELS, SHIP_ABBREV, SHIP_LABELS, SHIP_TYPES } from './constants.js'

export function createEmptyMap(id = 'new', name = 'New Map'): MapDefinition {
  return { id, name, cells: [{ q: 0, r: 0 }] }
}
