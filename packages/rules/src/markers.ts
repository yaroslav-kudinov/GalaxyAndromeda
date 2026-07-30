import {
  gameStateFromSnapshot,
  resolveRegionIdForCell,
  MAX_ACTION_MARKERS_PER_PLAYER,
  maxProductionMarkersForPlayer,
  countProductionMarkersForPlayer,
  type ActionMarker,
  type GameSnapshot,
  type ProductionMarker,
} from './save-file.js'
import { MIN_VALID_PRODUCTION_REGION_SIZE } from './regions.js'
import type { HexCoord, MapDefinition, Phase } from './types.js'
import { hexKey } from './types.js'

export const ACTION_MARKER_ALREADY_RESOLVED_MSG =
  'За этот ход в фазе «Действия» можно исполнить только один маркер действия'

export const ACTION_MARKER_REMOVE_BLOCKED_MSG =
  'После исполнения маркера действия в этом ходу нельзя снимать другие маркеры'

export const ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG =
  'Используйте маркер действия или снимите его с карты'

export const PRODUCTION_MARKER_ALREADY_RESOLVED_MSG =
  'За этот ход в фазе «Производство» можно построить только по одному маркеру'

export const PRODUCTION_MARKER_REMOVE_BLOCKED_MSG =
  'После постройки по маркеру в этом ходу нельзя снимать другие маркеры производства'

export const PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG =
  'Используйте маркер производства, перезарядите ресурсы или снимите его с карты'

export function hasResolvedActionMarkerThisTurn(game: GameSnapshot): boolean {
  return !!game.actionMarkerResolvedThisTurn
}

export function canExecuteActionMarkerThisTurn(game: GameSnapshot, ownerId: string): boolean {
  if (game.phase !== 'actions') return false
  if (game.activePlayerId !== ownerId) return false
  if (game.actionMarkerResolvedThisTurn) return false
  return true
}

export function canRemoveActionMarkerThisTurn(game: GameSnapshot, ownerId: string): boolean {
  if (game.phase !== 'actions') return true
  if (game.activePlayerId !== ownerId) return false
  if (game.actionMarkerResolvedThisTurn) return false
  return true
}

export function countActionMarkersForPlayer(game: GameSnapshot, ownerId: string): number {
  return game.actionMarkers.filter((m) => m.ownerId === ownerId).length
}

/** Активный игрок в «Действиях» с маркерами, но без исполнения/снятия — не может передать ход. */
export function mustResolveActionMarkerBeforeAdvance(game: GameSnapshot, ownerId: string): boolean {
  if (game.phase !== 'actions') return false
  if (game.activePlayerId !== ownerId) return false
  if (countActionMarkersForPlayer(game, ownerId) === 0) return false
  return !game.actionMarkerResolvedThisTurn
}

export function validateActionMarkerBeforeAdvance(game: GameSnapshot): string[] {
  if (!game.activePlayerId) return []
  if (mustResolveActionMarkerBeforeAdvance(game, game.activePlayerId)) {
    return [ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG]
  }
  return []
}

export function markActionMarkerResolvedThisTurn(game: GameSnapshot): void {
  game.actionMarkerResolvedThisTurn = true
}

export function syncActionMarkerTurnTracking(
  game: GameSnapshot,
  prevPhase: Phase,
  prevActivePlayerId: string | null,
): void {
  if (game.phase !== 'actions') {
    game.actionMarkerResolvedThisTurn = false
    return
  }
  if (prevPhase !== 'actions' || game.activePlayerId !== prevActivePlayerId) {
    game.actionMarkerResolvedThisTurn = false
  }
}

export function hasResolvedProductionMarkerThisTurn(game: GameSnapshot): boolean {
  return !!game.productionMarkerResolvedThisTurn
}

export function canExecuteProductionMarkerThisTurn(game: GameSnapshot, ownerId: string): boolean {
  if (game.phase !== 'production') return false
  if (game.activePlayerId !== ownerId) return false
  if (game.productionMarkerResolvedThisTurn) return false
  return true
}

export function canRemoveProductionMarkerThisTurn(game: GameSnapshot, ownerId: string): boolean {
  if (game.phase !== 'production') return true
  if (game.activePlayerId !== ownerId) return false
  if (game.productionMarkerResolvedThisTurn) return false
  return true
}

/** Активный игрок в «Производстве» с маркерами обязан исполнить или снять один из них. */
export function mustResolveProductionMarkerBeforeAdvance(
  game: GameSnapshot,
  ownerId: string,
): boolean {
  if (game.phase !== 'production') return false
  if (game.activePlayerId !== ownerId) return false
  if (countProductionMarkersForPlayer(game, ownerId) === 0) return false
  return !game.productionMarkerResolvedThisTurn
}

export function validateProductionMarkerBeforeAdvance(game: GameSnapshot): string[] {
  if (!game.activePlayerId) return []
  if (mustResolveProductionMarkerBeforeAdvance(game, game.activePlayerId)) {
    return [PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG]
  }
  return []
}

export function markProductionMarkerResolvedThisTurn(game: GameSnapshot): void {
  game.productionMarkerResolvedThisTurn = true
}

export function syncProductionMarkerTurnTracking(
  game: GameSnapshot,
  prevPhase: Phase,
  prevActivePlayerId: string | null,
): void {
  if (game.phase !== 'production') {
    game.productionMarkerResolvedThisTurn = false
    return
  }
  if (prevPhase !== 'production' || game.activePlayerId !== prevActivePlayerId) {
    game.productionMarkerResolvedThisTurn = false
  }
}

function newMarkerId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function cellAt(game: GameSnapshot, coord: HexCoord) {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
}

export function addActionMarker(
  game: GameSnapshot,
  ownerId: string,
  coord: HexCoord,
): string[] {
  if (game.phase !== 'planning') {
    return ['Маркеры действий ставятся только в фазе планирования']
  }
  if (game.activePlayerId !== ownerId) {
    return ['Сейчас ход другого игрока']
  }

  const cell = cellAt(game, coord)
  const key = hexKey(coord.q, coord.r)
  if (!cell) return [`Клетка ${key} не найдена`]
  if (!cell.ships.some((s) => s.ownerId === ownerId)) {
    return ['Маркер действия ставится только на клетку с вашим кораблём']
  }
  if (cell.actionMarkerId) return ['На клетке уже есть маркер действия']

  const count = game.actionMarkers.filter((m) => m.ownerId === ownerId).length
  if (count >= MAX_ACTION_MARKERS_PER_PLAYER) {
    return [`Не более ${MAX_ACTION_MARKERS_PER_PLAYER} маркеров действий на игрока`]
  }

  const id = newMarkerId('action')
  const marker: ActionMarker = {
    id,
    ownerId,
    coord: { q: coord.q, r: coord.r },
    placedInPhase: 'planning',
  }
  game.actionMarkers.push(marker)
  cell.actionMarkerId = id
  return []
}

export function removeActionMarker(game: GameSnapshot, markerId: string, ownerId: string): string[] {
  const idx = game.actionMarkers.findIndex((m) => m.id === markerId)
  if (idx < 0) return ['Маркер не найден']
  const marker = game.actionMarkers[idx]
  if (marker.ownerId !== ownerId) return ['Нельзя снять чужой маркер']
  if (!canRemoveActionMarkerThisTurn(game, ownerId)) {
    return [ACTION_MARKER_REMOVE_BLOCKED_MSG]
  }

  game.actionMarkers.splice(idx, 1)
  const cell = cellAt(game, marker.coord)
  if (cell?.actionMarkerId === markerId) cell.actionMarkerId = null
  return []
}

export function addProductionMarker(
  game: GameSnapshot,
  ownerId: string,
  coord: HexCoord,
  map: MapDefinition,
): string[] {
  if (game.phase !== 'planning') {
    return ['Маркеры производства ставятся только в фазе планирования']
  }
  if (game.activePlayerId !== ownerId) {
    return ['Сейчас ход другого игрока']
  }

  const cell = cellAt(game, coord)
  const key = hexKey(coord.q, coord.r)
  if (!cell) return [`Клетка ${key} не найдена`]
  if (cell.controlOwnerId !== ownerId) {
    return ['Маркер можно ставить только на своей клетке']
  }
  if (cell.productionMarkerId) return ['На клетке уже есть маркер производства']

  const state = gameStateFromSnapshot(game, map.id)
  const regionId = resolveRegionIdForCell(state, coord, ownerId)
  if (!regionId) {
    return [
      `Маркер производства ставится только в контролируемом регионе (от ${MIN_VALID_PRODUCTION_REGION_SIZE} клетки)`,
    ]
  }

  const regionTaken = game.productionMarkers.some((m) => {
    if (m.ownerId !== ownerId) return false
    if (m.targetRegionId === regionId) return true
    const existingRegionId = resolveRegionIdForCell(state, m.coord, ownerId)
    return existingRegionId === regionId
  })
  if (regionTaken) {
    return ['В этом регионе уже стоит маркер производства']
  }

  const limit = maxProductionMarkersForPlayer(state, ownerId)
  const count = countProductionMarkersForPlayer(game, ownerId)
  if (count >= limit) {
    return [`Не более ${limit} маркеров производства (по одному на регион)`]
  }

  const id = newMarkerId('production')
  const marker: ProductionMarker = {
    id,
    ownerId,
    coord: { q: coord.q, r: coord.r },
    targetRegionId: regionId,
  }
  game.productionMarkers.push(marker)
  cell.productionMarkerId = id
  return []
}

export function removeProductionMarker(game: GameSnapshot, markerId: string, ownerId: string): string[] {
  const idx = game.productionMarkers.findIndex((m) => m.id === markerId)
  if (idx < 0) return ['Маркер не найден']
  const marker = game.productionMarkers[idx]
  if (marker.ownerId !== ownerId) return ['Нельзя снять чужой маркер']
  if (!canRemoveProductionMarkerThisTurn(game, ownerId)) {
    return [PRODUCTION_MARKER_REMOVE_BLOCKED_MSG]
  }

  game.productionMarkers.splice(idx, 1)
  const cell = cellAt(game, marker.coord)
  if (cell?.productionMarkerId === markerId) cell.productionMarkerId = null
  return []
}

export type MarkerKind = 'action' | 'production'

export function toggleMarkerAtCell(
  game: GameSnapshot,
  ownerId: string,
  coord: HexCoord,
  map: MapDefinition,
  kind: MarkerKind,
): string[] {
  const cell = cellAt(game, coord)
  if (!cell) return ['Клетка не найдена']

  if (kind === 'action') {
    if (cell.actionMarkerId) {
      if (game.phase !== 'planning' && game.phase !== 'actions') {
        return ['Маркеры действий снимаются в планировании и фазе действий']
      }
      return removeActionMarker(game, cell.actionMarkerId, ownerId)
    }
    return addActionMarker(game, ownerId, coord)
  }

  if (cell.productionMarkerId) {
    if (game.phase !== 'planning' && game.phase !== 'production') {
      return ['Маркеры производства снимаются в планировании и фазе производства']
    }
    return removeProductionMarker(game, cell.productionMarkerId, ownerId)
  }
  return addProductionMarker(game, ownerId, coord, map)
}

/** @deprecated используйте toggleMarkerAtCell с явным kind */
export function togglePhaseMarkerAtCell(
  game: GameSnapshot,
  ownerId: string,
  coord: HexCoord,
  _map: MapDefinition,
): string[] {
  const cell = cellAt(game, coord)
  if (!cell) return ['Клетка не найдена']

  if (cell.actionMarkerId) {
    if (game.phase !== 'planning' && game.phase !== 'actions') {
      return ['Маркеры действий снимаются в планировании и фазе действий']
    }
    return removeActionMarker(game, cell.actionMarkerId, ownerId)
  }

  if (cell.productionMarkerId) {
    if (game.phase !== 'planning' && game.phase !== 'production') {
      return ['Маркеры производства снимаются в планировании и фазе производства']
    }
    return removeProductionMarker(game, cell.productionMarkerId, ownerId)
  }

  if (game.phase !== 'planning') {
    return ['Маркеры ставятся только в фазе планирования']
  }

  return addActionMarker(game, ownerId, coord)
}

export function hasUnplacedActionMarkerCapacity(game: GameSnapshot, ownerId: string): boolean {
  const count = game.actionMarkers.filter((m) => m.ownerId === ownerId).length
  if (count >= MAX_ACTION_MARKERS_PER_PLAYER) return false
  return game.cells.some((cell) => {
    if (!cell.ships.some((s) => s.ownerId === ownerId)) return false
    if (!cell.actionMarkerId) return true
    const marker = game.actionMarkers.find((m) => m.id === cell.actionMarkerId)
    return marker?.ownerId !== ownerId
  })
}

export function hasUnplacedProductionMarkerCapacity(
  game: GameSnapshot,
  map: MapDefinition,
  ownerId: string,
): boolean {
  const state = gameStateFromSnapshot(game, map.id)
  const limit = maxProductionMarkersForPlayer(state, ownerId)
  const count = countProductionMarkersForPlayer(game, ownerId)
  return count < limit
}

export function shouldConfirmPlanningPhaseAdvance(
  game: GameSnapshot,
  map: MapDefinition,
  ownerId: string,
): boolean {
  if (game.phase !== 'planning' || game.activePlayerId !== ownerId) return false
  return (
    hasUnplacedActionMarkerCapacity(game, ownerId)
    || hasUnplacedProductionMarkerCapacity(game, map, ownerId)
  )
}
