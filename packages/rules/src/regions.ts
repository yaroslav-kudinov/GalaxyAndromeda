import { buildSpatialSummary } from './observation/ascii-map.js'
import { getShipProductionRegionMin } from './ships.js'
import type { GameState, SpatialRegion } from './types.js'

/**
 * Минимальный размер связной территории для слота маркера производства.
 * Rulebook: valid region ≥ destroyer band (ships.yaml → productionRegionSize[0] = 3).
 * Меньшие кластеры не дают маркер; supply (1 клетка) — только для постройки внутри региона.
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
