import type { HexCoord } from './types.js'
import { hexKey } from './types.js'
import type { MapCellContent } from './map-editor.js'

export type SymmetryPlayerCount = 2 | 3 | 4 | 6
export type SymmetryAxisKind = 'line' | 'edge'

export interface SymmetrySettings {
  enabled: boolean
  playerCount: SymmetryPlayerCount
  /** For 2 and 4 players: mirror through a line of hex centers vs through edges between cells */
  axisKind: SymmetryAxisKind
  /** 0–2: one of three equivalent axes (60° apart) */
  axisIndex: number
}

export const DEFAULT_SYMMETRY_SETTINGS: SymmetrySettings = {
  enabled: false,
  playerCount: 2,
  axisKind: 'line',
  axisIndex: 0,
}

type Cube = { x: number; y: number; z: number }

function axialToCube(q: number, r: number): Cube {
  return { x: q, z: r, y: -q - r }
}

function cubeToAxial(c: Cube): HexCoord {
  return { q: c.x, r: c.z }
}

/** Rotate counter-clockwise by 60° × steps around origin */
export function rotateHex(coord: HexCoord, steps: number): HexCoord {
  let { x, y, z } = axialToCube(coord.q, coord.r)
  const n = ((steps % 6) + 6) % 6
  for (let i = 0; i < n; i++) {
    const nx = -z
    const ny = -x
    const nz = -y
    x = nx
    y = ny
    z = nz
  }
  return cubeToAxial({ x, y, z })
}

/**
 * Reflections through a line of adjacent hex centers (cube-axis negation).
 * index 0: r = 0 (horizontal when hexes are pointy-top).
 */
function reflectThroughCenters(coord: HexCoord, index: number): HexCoord {
  const i = ((index % 3) + 3) % 3
  if (i === 0) return { q: coord.q + coord.r, r: -coord.r }
  if (i === 1) return { q: -coord.q, r: coord.q + coord.r }
  return { q: -coord.r, r: -coord.q }
}

/**
 * Reflections through hex vertices / edges between cells (cube-coordinate swap).
 * index 0: horizontal when hexes are flat-top.
 */
function reflectThroughEdges(coord: HexCoord, index: number): HexCoord {
  const i = ((index % 3) + 3) % 3
  if (i === 0) return { q: coord.q, r: -coord.q - coord.r }
  if (i === 1) return { q: coord.r, r: coord.q }
  return { q: -coord.q - coord.r, r: coord.r }
}

/**
 * Mirror across an axis through the origin.
 * Even steps (0, 2, 4): through adjacent hex centers.
 * Odd steps (1, 3, 5): through vertices / edges between cells.
 * Conjugating a single reflection by 60° only yields 3 axes (one family);
 * the other family must be the other involution type.
 */
export function reflectHex(coord: HexCoord, axisSteps: number): HexCoord {
  const axis = ((axisSteps % 6) + 6) % 6
  if (axis % 2 === 0) return reflectThroughCenters(coord, axis / 2)
  return reflectThroughEdges(coord, (axis - 1) / 2)
}

export function reflectionAxisSteps(settings: Pick<SymmetrySettings, 'axisKind' | 'axisIndex'>): number {
  const base = settings.axisKind === 'line' ? 0 : 1
  return (base + settings.axisIndex * 2) % 6
}

function dedupeCoords(coords: HexCoord[]): HexCoord[] {
  const seen = new Set<string>()
  const out: HexCoord[] = []
  for (const c of coords) {
    const key = hexKey(c.q, c.r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** All hex coords equivalent to `coord` under the chosen symmetry (includes origin coord) */
export function getSymmetryOrbit(coord: HexCoord, settings: Pick<SymmetrySettings, 'playerCount' | 'axisKind' | 'axisIndex'>): HexCoord[] {
  if (settings.playerCount === 2) {
    const axis = reflectionAxisSteps(settings)
    return dedupeCoords([coord, reflectHex(coord, axis)])
  }
  if (settings.playerCount === 3) {
    return dedupeCoords([
      rotateHex(coord, 0),
      rotateHex(coord, 2),
      rotateHex(coord, 4),
    ])
  }
  if (settings.playerCount === 4) {
    const axis = reflectionAxisSteps(settings)
    const rotated = rotateHex(coord, 3)
    return dedupeCoords([
      coord,
      reflectHex(coord, axis),
      rotated,
      reflectHex(rotated, axis),
    ])
  }
  return dedupeCoords(Array.from({ length: 6 }, (_, i) => rotateHex(coord, i)))
}

export function symmetryStepIndex(
  source: HexCoord,
  target: HexCoord,
  settings: Pick<SymmetrySettings, 'playerCount' | 'axisKind' | 'axisIndex'>,
): number {
  const orbit = getSymmetryOrbit(source, settings)
  const targetKey = hexKey(target.q, target.r)
  for (let i = 0; i < orbit.length; i++) {
    if (hexKey(orbit[i].q, orbit[i].r) === targetKey) return i
  }
  return 0
}

export function remapPlayerSlot(
  player: number,
  stepIndex: number,
  playerCount: SymmetryPlayerCount,
): number {
  if (playerCount === 2) {
    return stepIndex % 2 === 0 ? player : player === 1 ? 2 : player === 2 ? 1 : player
  }
  if (playerCount === 3) {
    return ((player - 1 + stepIndex) % 3) + 1
  }
  if (playerCount === 4) {
    return ((player - 1 + stepIndex) % 4) + 1
  }
  return ((player - 1 + stepIndex) % 6) + 1
}

export function remapCellContent(
  content: MapCellContent,
  stepIndex: number,
  playerCount: SymmetryPlayerCount,
): MapCellContent {
  const mapPlayer = (player: number) => remapPlayerSlot(player, stepIndex, playerCount)
  return {
    isPowerCenter: content.isPowerCenter,
    startPlayer:
      content.startPlayer != null ? mapPlayer(content.startPlayer) : null,
    resourceToken: content.resourceToken
      ? {
          type: content.resourceToken.type,
          value: content.resourceToken.value,
          ...(content.resourceToken.faceUp != null
            ? { faceUp: content.resourceToken.faceUp }
            : {}),
        }
      : undefined,
    startingShips: content.startingShips?.map((ship) => ({
      type: ship.type,
      player: mapPlayer(ship.player),
    })),
  }
}

export type HexGridOrientation = 'flat' | 'pointy'

/** Screen labels for the three axes of a family; angles depend on hex orientation. */
export const SYMMETRY_AXIS_LABELS: Record<
  HexGridOrientation,
  Record<SymmetryAxisKind, readonly [string, string, string]>
> = {
  pointy: {
    line: ['↔ горизонталь', '↔ 60°', '↔ 120°'],
    edge: ['↔ 150°', '↔ 30°', '| вертикаль'],
  },
  flat: {
    line: ['↔ 30°', '| вертикаль', '↔ 150°'],
    edge: ['↔ горизонталь', '↔ 60°', '↔ 120°'],
  },
}

export function getSymmetryAxisLabels(
  kind: SymmetryAxisKind,
  orientation: HexGridOrientation = 'flat',
): readonly [string, string, string] {
  return SYMMETRY_AXIS_LABELS[orientation][kind]
}

/** Horizontal mirror through a line of hex centers exists only for pointy-top drawing. */
export function horizontalThroughCentersPossible(orientation: HexGridOrientation): boolean {
  return orientation === 'pointy'
}

export const SYMMETRY_PLAYER_OPTIONS: {
  count: SymmetryPlayerCount
  label: string
  hint: string
}[] = [
  {
    count: 2,
    label: '2 игрока',
    hint: 'Зеркало: клетка и её отражение (игроки 1↔2)',
  },
  {
    count: 3,
    label: '3 игрока',
    hint: 'Поворот 120° вокруг (0,0): три копии, слоты 1→2→3',
  },
  {
    count: 4,
    label: '4 игрока',
    hint: 'Поворот 180° + отражение: четыре копии, слоты 1→2→3→4',
  },
  {
    count: 6,
    label: '6 игроков',
    hint: 'Поворот 60° вокруг (0,0): шесть копий, слоты сдвигаются',
  },
]
