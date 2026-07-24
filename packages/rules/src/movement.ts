import { MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER, SHIP_LABELS } from './constants.js'
import { trimGameEventLog } from './event-log.js'
import { getCellKeys, hexDistance } from './map.js'
import {
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
  canExecuteActionMarkerThisTurn,
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
  PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
} from './markers.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import {
  executeProductionBatch,
  executeProductionRecharge,
  type ProductionBatchPlan,
  type ShipPlacement,
  type TokenSpendRef,
} from './production.js'
import { getShipMoveRange } from './ships.js'
import { advanceGameSnapshot } from './turn.js'
import type { HexCoord, LegalAction, MapDefinition, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'
import { getLegalActions } from './game.js'

export interface ShipMovePlan {
  shipId: string
  to: HexCoord
  declareControl?: boolean
}

export interface MovableShipOption {
  ship: ShipUnit
  moveRange: number
  reachableKeys: string[]
  disabledReason?: string
}

function cellAt(game: GameSnapshot, coord: HexCoord): RuntimeCellState | undefined {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
}

function findShipOnBoard(
  game: GameSnapshot,
  shipId: string,
): (ShipUnit & { cellKey: string }) | null {
  for (const cell of game.cells) {
    const ship = cell.ships.find((s) => s.id === shipId)
    if (ship) {
      return { ...ship, cellKey: hexKey(cell.coord.q, cell.coord.r) }
    }
  }
  return null
}

function countPlayerShipsAt(cell: RuntimeCellState, playerId: string): number {
  return cell.ships.filter((s) => s.ownerId === playerId).length
}

function countIncomingMoves(
  moves: ShipMovePlan[],
  destKey: string,
  playerId: string,
  game: GameSnapshot,
): { player: number; total: number } {
  let player = 0
  let total = 0
  for (const move of moves) {
    if (hexKey(move.to.q, move.to.r) !== destKey) continue
    if (move.declareControl) continue
    const ship = findShipOnBoard(game, move.shipId)
    if (!ship) continue
    total += 1
    if (ship.ownerId === playerId) player += 1
  }
  return { player, total }
}

export function getReachableHexKeys(
  map: MapDefinition,
  from: HexCoord,
  shipType: ShipType,
): string[] {
  const range = getShipMoveRange(shipType)
  const fromKey = hexKey(from.q, from.r)
  const keys: string[] = []

  for (const key of getCellKeys(map)) {
    if (key === fromKey) continue
    const [q, r] = key.split(',').map(Number)
    const dist = hexDistance(from, { q, r })
    if (dist >= 1 && dist <= range) keys.push(key)
  }

  return keys
}

export function canDeclareControlForMove(
  ship: ShipUnit,
  dest: RuntimeCellState,
): boolean {
  return ship.type === 'supply' && dest.controlOwnerId === null
}

export function validateDestinationForMove(
  game: GameSnapshot,
  _map: MapDefinition,
  playerId: string,
  ship: ShipUnit,
  from: HexCoord,
  to: HexCoord,
  declareControl: boolean,
  priorMoves: ShipMovePlan[],
): string[] {
  const errors: string[] = []
  const dest = cellAt(game, to)
  if (!dest) return [`Клетка ${hexKey(to.q, to.r)} вне карты`]

  const fromKey = hexKey(from.q, from.r)
  const toKey = hexKey(to.q, to.r)
  if (fromKey === toKey) return ['Выберите другую клетку назначения']

  const dist = hexDistance(from, to)
  const range = getShipMoveRange(ship.type)
  if (dist < 1) return ['Нужна соседняя или более дальняя клетка']
  if (dist > range) {
    return [`Дальность ${range}, расстояние ${dist}`]
  }

  if (dest.controlOwnerId != null && dest.controlOwnerId !== playerId) {
    return ['Вражеская клетка — бой пока не реализован']
  }

  if (declareControl) {
    if (ship.type !== 'supply') errors.push('Контроль может объявить только корабль снабжения')
    if (dest.controlOwnerId !== null) errors.push('Клетка уже под контролем')
    return errors
  }

  const incoming = countIncomingMoves(priorMoves, toKey, playerId, game)
  const playerCount = countPlayerShipsAt(dest, playerId) + incoming.player
  const totalCount = dest.ships.length + incoming.total

  if (playerCount >= MAX_SHIPS_PER_CELL_PER_PLAYER) {
    errors.push(`Не более ${MAX_SHIPS_PER_CELL_PER_PLAYER} ваших кораблей на клетке`)
  }
  if (totalCount >= MAX_SHIPS_PER_CELL) {
    errors.push(`Не более ${MAX_SHIPS_PER_CELL} кораблей на клетке`)
  }

  return errors
}

export function getMovableShipsAtMarker(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
): MovableShipOption[] {
  if (!canExecuteActionMarkerThisTurn(game, playerId)) return []

  const fromCell = cellAt(game, from)
  if (!fromCell) return []

  const hasMarker = game.actionMarkers.some(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!hasMarker) return []

  return fromCell.ships
    .filter((s) => s.ownerId === playerId)
    .map((ship) => {
      const moveRange = getShipMoveRange(ship.type)
      const reachableKeys = getReachableHexKeys(map, from, ship.type).filter((key) => {
        const [q, r] = key.split(',').map(Number)
        return (
          validateDestinationForMove(game, map, playerId, ship, from, { q, r }, false, [])
            .length === 0
        )
      })

      let disabledReason: string | undefined
      if (reachableKeys.length === 0) {
        disabledReason = 'Нет доступных клеток в радиусе хода'
      }

      return { ship, moveRange, reachableKeys, disabledReason }
    })
}

export function validateMarkerMovement(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  moves: ShipMovePlan[],
): string[] {
  if (game.phase !== 'actions') return ['Движение только в фазе «Действия»']
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (game.actionMarkerResolvedThisTurn) return [ACTION_MARKER_ALREADY_RESOLVED_MSG]

  const fromCell = cellAt(game, from)
  if (!fromCell) return [`Клетка ${hexKey(from.q, from.r)} не найдена`]

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!marker) return ['На клетке нет вашего маркера действия']

  if (moves.length === 0) return ['Выберите хотя бы один корабль для перемещения']

  const errors: string[] = []
  const seenShipIds = new Set<string>()

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    if (seenShipIds.has(move.shipId)) {
      errors.push(`Корабль ${move.shipId} указан дважды`)
      continue
    }
    seenShipIds.add(move.shipId)

    const shipInfo = findShipOnBoard(game, move.shipId)
    if (!shipInfo) {
      errors.push(`Корабль ${move.shipId} не найден`)
      continue
    }
    if (shipInfo.ownerId !== playerId) {
      errors.push(`Корабль ${move.shipId} не ваш`)
      continue
    }
    if (shipInfo.cellKey !== hexKey(from.q, from.r)) {
      errors.push(`Корабль ${move.shipId} не на исходной клетке`)
      continue
    }

    errors.push(
      ...validateDestinationForMove(
        game,
        map,
        playerId,
        shipInfo,
        from,
        move.to,
        !!move.declareControl,
        moves.slice(0, i),
      ),
    )
  }

  return errors
}

export function executeMarkerMovement(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  moves: ShipMovePlan[],
): string[] {
  const errors = validateMarkerMovement(game, map, playerId, from, moves)
  if (errors.length) return errors

  const fromCell = cellAt(game, from)!
  const summaries: string[] = []

  for (const move of moves) {
    const destCell = cellAt(game, move.to)!
    const shipIdx = fromCell.ships.findIndex((s) => s.id === move.shipId)
    if (shipIdx < 0) continue
    const [ship] = fromCell.ships.splice(shipIdx, 1)

    if (move.declareControl && canDeclareControlForMove(ship, destCell)) {
      destCell.controlOwnerId = playerId
      summaries.push(
        `${SHIP_LABELS[ship.type]} занял (${move.to.q},${move.to.r}), снят с карты`,
      )
    } else {
      destCell.ships.push(ship)
      summaries.push(`${SHIP_LABELS[ship.type]} → (${move.to.q},${move.to.r})`)
    }
  }

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
    type: 'movement',
    message: `Движение с (${from.q},${from.r}): ${summaries.join('; ')}`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)

  return []
}

export function getLegalActionsForSnapshot(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
): LegalAction[] {
  const state = gameStateFromSnapshot(game, mapId)
  const actions = getLegalActions(state, playerId)

  if (game.phase === 'actions' && game.activePlayerId === playerId) {
    const ownMarkers = game.actionMarkers.filter((m) => m.ownerId === playerId)
    if (ownMarkers.length > 0 && game.actionMarkerResolvedThisTurn) {
      actions.push({
        id: 'action-marker-used',
        type: 'info',
        description: ACTION_MARKER_ALREADY_RESOLVED_MSG,
      })
    }
  }

  if (game.phase === 'production' && game.activePlayerId === playerId) {
    const ownMarkers = game.productionMarkers.filter((m) => m.ownerId === playerId)
    if (ownMarkers.length > 0 && game.productionMarkerResolvedThisTurn) {
      actions.push({
        id: 'production-marker-used',
        type: 'info',
        description: PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
      })
    }
  }

  return actions
}

export function applyGameActionOnSnapshot(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
): string[] {
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']

  if (actionId === 'advance-phase') {
    return advanceGameSnapshot(game, map.id)
  }

  if (actionId === 'execute-marker-movement') {
    const from = params?.from as HexCoord | undefined
    const moves = params?.moves as ShipMovePlan[] | undefined
    if (!from || !Array.isArray(moves)) return ['Некорректные параметры действия']
    return executeMarkerMovement(game, map, playerId, from, moves)
  }

  if (actionId === 'execute-production') {
    const markerId = params?.markerId as string | undefined
    const ships = params?.ships as ShipPlacement[] | undefined
    const spentTokens = params?.spentTokens as TokenSpendRef[] | undefined
    if (!markerId || !Array.isArray(ships) || ships.length === 0) {
      return ['Некорректные параметры действия']
    }
    const plan: ProductionBatchPlan = { markerId, ships }
    return executeProductionBatch(game, map.id, playerId, plan, spentTokens)
  }

  if (actionId === 'execute-production-recharge') {
    const markerId = params?.markerId as string | undefined
    if (!markerId) return ['Некорректные параметры действия']
    return executeProductionRecharge(game, map.id, playerId, { markerId })
  }

  return [`Неизвестное действие: ${actionId}`]
}
