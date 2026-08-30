import { applyDestroyerColonization, canDestroyerColonizeCell } from './claim.js'
import { trimGameEventLog } from './event-log.js'
import type { RuntimeCellState } from './save-file.js'
import { hexKey } from './types.js'
import {
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
  canExecuteActionMarkerThisTurn,
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
} from './markers.js'
import type { GameSnapshot } from './save-file.js'
import type { HexCoord, MapDefinition, ShipUnit } from './types.js'
import { applyVictoryAndDefeatChecks } from './victory.js'

function cellAt(game: GameSnapshot, coord: HexCoord): RuntimeCellState | undefined {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
}

export interface SacrificableDestroyerOption {
  ship: ShipUnit
  disabledReason?: string
}

function sacrificeDisabledReason(
  cell: NonNullable<ReturnType<typeof cellAt>>,
  playerId: string,
): string | undefined {
  if (cell.controlOwnerId === playerId) return 'Клетка уже под вашим контролем'
  if (!canDestroyerColonizeCell(cell, playerId)) {
    if (cell.controlOwnerId != null) return 'Жертва возможна только на нейтральной клетке'
    if (cell.ships.some((s) => s.ownerId !== playerId)) return 'На клетке есть вражеские корабли'
    return 'Клетку нельзя захватить'
  }
  return undefined
}

export function getSacrificableDestroyersAtMarker(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
): SacrificableDestroyerOption[] {
  if (!canExecuteActionMarkerThisTurn(game, playerId)) return []

  const cell = cellAt(game, from)
  if (!cell) return []

  const hasMarker = game.actionMarkers.some(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!hasMarker) return []

  const cellReason = sacrificeDisabledReason(cell, playerId)
  return cell.ships
    .filter((s) => s.ownerId === playerId && s.type === 'destroyer')
    .map((ship) => ({
      ship,
      disabledReason: cellReason,
    }))
}

export function validateDestroyerSacrifice(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  shipId: string,
): string[] {
  if (game.phase !== 'actions') return ['Жертва эсминца только в фазе «Действия»']
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (game.actionMarkerResolvedThisTurn) return [ACTION_MARKER_ALREADY_RESOLVED_MSG]

  const cell = cellAt(game, from)
  if (!cell) return [`Клетка ${hexKey(from.q, from.r)} не найдена`]

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!marker) return ['На клетке нет вашего маркера действия']

  const ship = cell.ships.find((s) => s.id === shipId)
  if (!ship) return ['Эсминец не найден на клетке маркера']
  if (ship.ownerId !== playerId) return ['Это не ваш корабль']
  if (ship.type !== 'destroyer') return ['Жертвовать можно только эсминец']

  const cellReason = sacrificeDisabledReason(cell, playerId)
  if (cellReason) return [cellReason]

  return []
}

export function executeDestroyerSacrifice(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  shipId: string,
): { errors: string[] } {
  const errors = validateDestroyerSacrifice(game, playerId, from, shipId)
  if (errors.length) return { errors }

  const cell = cellAt(game, from)!
  cell.ships = cell.ships.filter((s) => s.id !== shipId)
  applyDestroyerColonization(game, cell, playerId)

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (marker) removeActionMarker(game, marker.id, playerId)
  markActionMarkerResolvedThisTurn(game)

  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'claim',
    message: `Эсминец погиб — захвачена клетка (${from.q},${from.r})`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
  applyVictoryAndDefeatChecks(game, map.id)

  return { errors: [] }
}
