import type { GameState, MapDefinition, SpatialSummary } from '../types.js'
import { hexKey } from '../types.js'
import { hexDistance } from '../map.js'

function cellLabel(state: GameState, q: number, r: number): string {
  const cell = state.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) return '..'

  const parts: string[] = []
  if (cell.controlOwnerId) {
    const p = state.players.find((pl) => pl.id === cell.controlOwnerId)
    parts.push(p?.name.charAt(0).toUpperCase() ?? '?')
  } else {
    parts.push('.')
  }

  if (cell.ships.length > 0) {
    const ship = cell.ships[0]
    parts.push(`:${ship.type.slice(0, 2)}`)
  }

  if (cell.isPowerCenter) parts.push('★')

  const credits = cell.resourceTokens.filter((t) => t.type === 'credits' && t.faceUp !== false)
  const production = cell.resourceTokens.filter((t) => t.type === 'production' && t.faceUp !== false)
  if (credits.length) parts.push(`Y${credits[0].value}`)
  if (production.length) parts.push(`O${production[0].value}`)

  return parts.join('')
}

/** Render irregular hex map as ASCII for LLM spatial reasoning */
export function renderAsciiMap(state: GameState): string {
  if (state.cells.length === 0) return '(empty map)'

  const coords = state.cells.map((c) => c.coord)
  const minQ = Math.min(...coords.map((c) => c.q))
  const maxQ = Math.max(...coords.map((c) => c.q))
  const minR = Math.min(...coords.map((c) => c.r))
  const maxR = Math.max(...coords.map((c) => c.r))

  const lines: string[] = []
  for (let r = minR; r <= maxR; r++) {
    const indent = ' '.repeat((r - minR) * 2)
    const row: string[] = []
    for (let q = minQ; q <= maxQ; q++) {
      const exists = state.cells.some((c) => c.coord.q === q && c.coord.r === r)
      if (!exists) {
        row.push('      ')
        continue
      }
      const label = cellLabel(state, q, r)
      row.push(`(${q},${r})${label.padEnd(6)}`)
    }
    lines.push(indent + row.join(' '))
  }

  return [
    'Legend: B/G/R=player, :xx=ship, ★=PowerCenter, Yn=credits, On=production',
    ...lines,
  ].join('\n')
}

export function buildSpatialSummary(state: GameState): SpatialSummary {
  const powerCenters = state.cells
    .filter((c) => c.isPowerCenter)
    .map((c) => ({
      q: c.coord.q,
      r: c.coord.r,
      ownerId: c.controlOwnerId,
    }))

  const regions: SpatialSummary['regions'] = []
  const visited = new Set<string>()

  for (const cell of state.cells) {
    const key = hexKey(cell.coord.q, cell.coord.r)
    if (visited.has(key) || !cell.controlOwnerId) continue

    const stack = [cell.coord]
    const hexes: string[] = []
    while (stack.length) {
      const cur = stack.pop()!
      const curKey = hexKey(cur.q, cur.r)
      if (visited.has(curKey)) continue
      const curCell = state.cells.find((c) => c.coord.q === cur.q && c.coord.r === cur.r)
      if (!curCell || curCell.controlOwnerId !== cell.controlOwnerId) continue
      visited.add(curKey)
      hexes.push(curKey)
      for (const n of [
        { q: cur.q + 1, r: cur.r },
        { q: cur.q + 1, r: cur.r - 1 },
        { q: cur.q, r: cur.r - 1 },
        { q: cur.q - 1, r: cur.r },
        { q: cur.q - 1, r: cur.r + 1 },
        { q: cur.q, r: cur.r + 1 },
      ]) {
        stack.push(n)
      }
    }

    if (hexes.length > 0) {
      regions.push({
        id: `region-${regions.length}`,
        ownerId: cell.controlOwnerId,
        size: hexes.length,
        hexes,
      })
    }
  }

  const distances: SpatialSummary['distances'] = []
  if (powerCenters.length > 0 && state.cells.length > 0) {
    const sample = state.cells.slice(0, 3)
    for (const cell of sample) {
      for (const pc of powerCenters) {
        distances.push({
          from: hexKey(cell.coord.q, cell.coord.r),
          to: hexKey(pc.q, pc.r),
          steps: hexDistance(cell.coord, pc),
        })
      }
    }
  }

  return {
    regions,
    powerCenters,
    supplyChains: [],
    distances,
  }
}

export function renderAsciiMapFromDefinition(map: MapDefinition): string {
  const state: GameState = {
    mapId: map.id,
    phase: 'planning',
    turnNumber: 0,
    activePlayerId: null,
    players: [],
    cells: map.cells.map((c) => ({
      coord: { q: c.q, r: c.r },
      isPowerCenter: c.isPowerCenter ?? false,
      controlOwnerId: c.startPlayer != null ? `player-${c.startPlayer}` : null,
      resourceTokens: c.resourceTokens ?? [],
      ships: [],
    })),
    eventLog: [],
  }
  return renderAsciiMap(state)
}
