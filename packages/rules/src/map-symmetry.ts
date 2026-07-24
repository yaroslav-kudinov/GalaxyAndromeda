import type { MapCellDefinition, MapDefinition } from './types.js'
import { hexKey } from './types.js'
import {
  applyCellContent,
  extractCellContent,
} from './map-editor.js'
import {
  getSymmetryOrbit,
  remapCellContent,
  symmetryStepIndex,
  type SymmetrySettings,
} from './hex-symmetry.js'

export function expandMapStructure(map: MapDefinition, settings: SymmetrySettings): void {
  if (!settings.enabled) return
  const existing = new Set(map.cells.map((c) => hexKey(c.q, c.r)))
  const toAdd: MapCellDefinition[] = []
  for (const cell of map.cells) {
    for (const coord of getSymmetryOrbit(cell, settings)) {
      const key = hexKey(coord.q, coord.r)
      if (existing.has(key)) continue
      existing.add(key)
      toAdd.push({ q: coord.q, r: coord.r })
    }
  }
  map.cells.push(...toAdd)
}

export function syncCellOrbitContent(
  map: MapDefinition,
  source: { q: number; r: number },
  settings: SymmetrySettings,
): void {
  if (!settings.enabled) return
  const sourceKey = hexKey(source.q, source.r)
  const sourceCell = map.cells.find((c) => hexKey(c.q, c.r) === sourceKey)
  if (!sourceCell) return

  const content = extractCellContent(sourceCell)
  const orbit = getSymmetryOrbit(source, settings)
  const cellByKey = new Map(map.cells.map((c) => [hexKey(c.q, c.r), c]))

  for (const coord of orbit) {
    const key = hexKey(coord.q, coord.r)
    let cell = cellByKey.get(key)
    if (!cell) {
      cell = { q: coord.q, r: coord.r }
      map.cells.push(cell)
      cellByKey.set(key, cell)
    }
    const step = symmetryStepIndex(source, coord, settings)
    applyCellContent(cell, remapCellContent(content, step, settings.playerCount))
  }
}

export function removeCellOrbit(
  map: MapDefinition,
  source: { q: number; r: number },
  settings: SymmetrySettings,
): void {
  if (!settings.enabled) {
    if (map.cells.length <= 1) return
    map.cells = map.cells.filter((c) => hexKey(c.q, c.r) !== hexKey(source.q, source.r))
    return
  }

  const drop = new Set(
    getSymmetryOrbit(source, settings).map((c) => hexKey(c.q, c.r)),
  )
  const next = map.cells.filter((c) => !drop.has(hexKey(c.q, c.r)))
  if (next.length === 0) return
  map.cells = next
}

export function addCellOrbit(
  map: MapDefinition,
  source: { q: number; r: number },
  settings: SymmetrySettings,
): void {
  const existing = new Set(map.cells.map((c) => hexKey(c.q, c.r)))
  const coords = settings.enabled
    ? getSymmetryOrbit(source, settings)
    : [source]

  for (const coord of coords) {
    const key = hexKey(coord.q, coord.r)
    if (existing.has(key)) continue
    map.cells.push({ q: coord.q, r: coord.r })
    existing.add(key)
  }
}

export function orbitKeysForCell(
  source: { q: number; r: number },
  settings: SymmetrySettings,
): string[] {
  if (!settings.enabled) return [hexKey(source.q, source.r)]
  return getSymmetryOrbit(source, settings).map((c) => hexKey(c.q, c.r))
}
