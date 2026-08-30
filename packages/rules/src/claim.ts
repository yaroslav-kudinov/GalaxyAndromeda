import { removeStaleProductionMarkerAt } from './markers.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { ShipType } from './types.js'

const COLONIZER_TYPES: ReadonlySet<ShipType> = new Set([
  'cruiser',
  'battleship',
  'shield',
  'hyper',
])

function hasEnemyShipsOnCell(cell: RuntimeCellState, playerId: string): boolean {
  return cell.ships.some((ship) => ship.ownerId !== playerId)
}

function hasEnemyShips(cell: RuntimeCellState, playerId: string): boolean {
  return hasEnemyShipsOnCell(cell, playerId)
}

function hasOwnShips(cell: RuntimeCellState, playerId: string): boolean {
  return cell.ships.some((ship) => ship.ownerId === playerId)
}

function hasColonizer(cell: RuntimeCellState, playerId: string): boolean {
  return cell.ships.some((ship) => ship.ownerId === playerId && COLONIZER_TYPES.has(ship.type))
}

/** Эсминец захватывает нейтральную клетку жертвой (маркер действия, корабль гибнет). */
export function canDestroyerColonizeCell(cell: RuntimeCellState, playerId: string): boolean {
  if (cell.controlOwnerId != null) return false
  if (hasEnemyShipsOnCell(cell, playerId)) return false
  return true
}

export function applyDestroyerColonization(
  game: GameSnapshot,
  cell: RuntimeCellState,
  playerId: string,
): boolean {
  if (!canDestroyerColonizeCell(cell, playerId)) return false
  cell.controlOwnerId = playerId
  removeStaleProductionMarkerAt(game, cell.coord)
  return true
}

/** Нейтральную клетку не красим сразу — только объявление контроля в конце хода (кроме жертвы эсминца). */

function canClaimCell(cell: RuntimeCellState, playerId: string): boolean {
  if (!hasOwnShips(cell, playerId) || hasEnemyShips(cell, playerId)) return false
  if (cell.controlOwnerId === playerId) return false
  if (cell.controlOwnerId == null) return hasColonizer(cell, playerId)
  return true
}

/**
 * Вход на клетку под контролем другого игрока: контроль сразу у входящего,
 * чужой маркер производства снимается. Нейтральную клетку не трогает.
 * Если на клетке ещё стоят чужие корабли — не захватывает (это бой).
 */
export function transferControlIfEnemyOwned(
  game: GameSnapshot,
  cell: RuntimeCellState,
  enteringPlayerId: string,
): boolean {
  if (!cell.controlOwnerId || cell.controlOwnerId === enteringPlayerId) return false
  if (hasEnemyShips(cell, enteringPlayerId)) return false
  cell.controlOwnerId = enteringPlayerId
  removeStaleProductionMarkerAt(game, cell.coord)
  return true
}

/** Клейм в конце игрового хода (после фазы «Действия»). */
export function applyProductionHexClaims(game: GameSnapshot): { claimed: number } {
  let claimed = 0
  const owners = new Set(
    game.cells.flatMap((cell) => cell.ships.map((ship) => ship.ownerId)),
  )
  for (const playerId of owners) {
    const player = game.players.find((p) => p.id === playerId)
    if (!player || player.eliminated) continue
    for (const cell of game.cells) {
      if (!canClaimCell(cell, playerId)) continue
      cell.controlOwnerId = playerId
      removeStaleProductionMarkerAt(game, cell.coord)
      claimed += 1
    }
  }
  if (claimed) {
    game.eventLog.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      turn: game.turnNumber,
      phase: game.phase,
      type: 'claim',
      message: `Объявление контроля: занято клеток ${claimed}`,
      timestamp: Date.now(),
    })
  }
  return { claimed }
}

export function maybeApplyProductionHexClaims(
  game: GameSnapshot,
  previousPhase: string,
): void {
  if (previousPhase === 'actions' && game.phase === 'events') {
    applyProductionHexClaims(game)
  }
}

export function isColonizerShipType(type: ShipType): boolean {
  return COLONIZER_TYPES.has(type)
}
