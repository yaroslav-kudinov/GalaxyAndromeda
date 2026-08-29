import { buildSpatialSummary } from './observation/ascii-map.js'
import { getShipProductionRegionMin } from './ships.js'
import type { GameState, HexCoord, SpatialRegion } from './types.js'
import { hexKey } from './types.js'

/**
 * Минимальный размер связной территории для слота маркера производства.
 * Rulebook: valid region ≥ destroyer band (ships.yaml → productionRegionSize[0] = 3).
 * Меньшие кластеры не дают маркер.
 */
export const MIN_VALID_PRODUCTION_REGION_SIZE = getShipProductionRegionMin('destroyer')

/** Базовый маркер производства доступен всегда; следующие открывают крупные регионы. */
export const BASE_PRODUCTION_MARKERS_PER_PLAYER = 1
export const PRODUCTION_MARKER_UNLOCK_REGION_SIZE = 4
export const SECOND_PRODUCTION_MARKER_UNLOCK_REGION_COUNT = 3
export const THIRD_PRODUCTION_MARKER_UNLOCK_REGION_COUNT = 5

export function isValidProductionRegionSize(size: number): boolean {
  return size >= MIN_VALID_PRODUCTION_REGION_SIZE
}

/** Связные контролируемые территории игрока, подходящие для маркера производства. */
export function validProductionRegionsForPlayer(state: GameState, ownerId: string): SpatialRegion[] {
  const summary = buildSpatialSummary(state)
  return summary.regions.filter(
    (r) => r.ownerId === ownerId && isValidProductionRegionSize(r.size),
  )
}

export function validProductionRegionCountForPlayer(state: GameState, ownerId: string): number {
  return validProductionRegionsForPlayer(state, ownerId).length
}

/** Число регионов от 4 клеток, учитываемых для разблокировки дополнительных маркеров. */
export function productionMarkerUnlockRegionCountForPlayer(
  state: GameState,
  ownerId: string,
): number {
  const summary = buildSpatialSummary(state)
  return summary.regions.filter(
    (region) =>
      region.ownerId === ownerId && region.size >= PRODUCTION_MARKER_UNLOCK_REGION_SIZE,
  ).length
}

/** Число контролируемых регионов игрока. */
export function controlledRegionCountForPlayer(state: GameState, ownerId: string): number {
  const summary = buildSpatialSummary(state)
  return summary.regions.filter((r) => r.ownerId === ownerId).length
}

export interface RegionInfo {
  regionId: string
  ownerId: string
  totalCells: number
  resourceCells: number
  activeResourceCells: number
  inactiveResourceCells: number
  faceUpCredits: number
  faceUpProduction: number
  faceDownTokenCount: number
  productionMarkerCount: number
  powerCenterCount: number
  qualifiesForProduction: boolean
}

/** Связный контролируемый регион, содержащий клетку (любой размер). */
export function findRegionAtCell(state: GameState, coord: HexCoord): SpatialRegion | null {
  const summary = buildSpatialSummary(state)
  const key = hexKey(coord.q, coord.r)
  return summary.regions.find((r) => r.hexes.includes(key)) ?? null
}

export function getRegionInfo(
  state: GameState,
  region: SpatialRegion,
  options?: {
    productionMarkers?: { ownerId: string; coord: HexCoord }[]
    effectiveTokenValue?: (value: number) => number
  },
): RegionInfo {
  const regionHexSet = new Set(region.hexes)
  const valueOf = options?.effectiveTokenValue ?? ((v: number) => v)

  let resourceCells = 0
  let activeResourceCells = 0
  let inactiveResourceCells = 0
  let faceUpCredits = 0
  let faceUpProduction = 0
  let faceDownTokenCount = 0
  let powerCenterCount = 0

  for (const cell of state.cells) {
    const key = hexKey(cell.coord.q, cell.coord.r)
    if (!regionHexSet.has(key)) continue

    if (cell.isPowerCenter) powerCenterCount += 1

    const tokens = cell.resourceTokens
    if (tokens.length === 0) continue

    resourceCells += 1
    let hasFaceUp = false
    let hasFaceDown = false

    for (const token of tokens) {
      if (token.faceUp === false) {
        hasFaceDown = true
        faceDownTokenCount += 1
      } else {
        hasFaceUp = true
        const effective = valueOf(token.value)
        if (token.type === 'credits') faceUpCredits += effective
        else if (token.type === 'production') faceUpProduction += effective
      }
    }

    if (hasFaceUp) activeResourceCells += 1
    if (hasFaceDown && !hasFaceUp) inactiveResourceCells += 1
  }

  const productionMarkerCount =
    options?.productionMarkers?.filter((m) => {
      if (m.ownerId !== region.ownerId) return false
      return regionHexSet.has(hexKey(m.coord.q, m.coord.r))
    }).length ?? 0

  return {
    regionId: region.id,
    ownerId: region.ownerId ?? '',
    totalCells: region.size,
    resourceCells,
    activeResourceCells,
    inactiveResourceCells,
    faceUpCredits,
    faceUpProduction,
    faceDownTokenCount,
    productionMarkerCount,
    powerCenterCount,
    qualifiesForProduction: isValidProductionRegionSize(region.size),
  }
}
