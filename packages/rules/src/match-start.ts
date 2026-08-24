import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import { activePlayerOrder } from './turn.js'

/** Новая партия: ход 1, планирование, без маркеров и боя. */
export function isPristineMatchSnapshot(game: GameSnapshot): boolean {
  return (
    game.turnNumber === 1
    && game.phase === 'planning'
    && !(game.actionMarkers?.length)
    && !(game.productionMarkers?.length)
    && !game.pendingCombat
    && !game.gameOver
  )
}

/**
 * Старт матча для реально вошедших слотов: очередь хода только среди них,
 * корабли и контроль пустых слотов снимаются (иначе «призраки» на карте).
 */
export function beginMatchForParticipants(
  game: GameSnapshot,
  mapId: string,
  participatingIds: string[],
): void {
  const ids = [...new Set(participatingIds.filter(Boolean))]
  game.participatingPlayerIds = ids

  for (const cell of game.cells) {
    cell.ships = cell.ships.filter((ship) => ids.includes(ship.ownerId))
    if (cell.controlOwnerId && !ids.includes(cell.controlOwnerId)) {
      cell.controlOwnerId = null
    }
  }

  game.actionMarkers = (game.actionMarkers ?? []).filter((marker) => ids.includes(marker.ownerId))
  game.productionMarkers = (game.productionMarkers ?? []).filter((marker) =>
    ids.includes(marker.ownerId),
  )
  const actionIds = new Set(game.actionMarkers.map((marker) => marker.id))
  const productionIds = new Set(game.productionMarkers.map((marker) => marker.id))
  for (const cell of game.cells) {
    if (cell.actionMarkerId && !actionIds.has(cell.actionMarkerId)) cell.actionMarkerId = null
    if (cell.productionMarkerId && !productionIds.has(cell.productionMarkerId)) {
      cell.productionMarkerId = null
    }
  }

  game.phase = 'planning'
  game.turnNumber = 1
  game.pendingCombat = undefined

  if (!ids.length) {
    game.activePlayerId = null
    return
  }

  const state = gameStateFromSnapshot(game, mapId)
  game.activePlayerId =
    activePlayerOrder(state.players, ids, { state, phase: 'planning' })[0] ?? ids[0] ?? null
}
