import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import { refreshActionMarkerCapacity } from './marker-pools.js'
import { refreshRechargeBudgets } from './resource-recharge.js'
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
/**
 * Жёсткий лимит ходов. По его достижении победитель определяется цепочкой тай-брейков
 * (`resolveTurnLimitWinner`): партия не может закончиться без победителя.
 */
export const DEFAULT_TURN_LIMIT = 15

export interface BeginMatchOptions {
  /**
   * Лимит ходов партии. `null` — без лимита: обучение не должно обрываться на середине
   * урока. По умолчанию `DEFAULT_TURN_LIMIT`.
   */
  turnLimit?: number | null
}

export function beginMatchForParticipants(
  game: GameSnapshot,
  mapId: string,
  participatingIds: string[],
  options?: BeginMatchOptions,
): void {
  const ids = [...new Set(participatingIds.filter(Boolean))]
  game.participatingPlayerIds = ids

  // Сид партии: разрешение ничьих должно быть одинаковым при повторной загрузке сейва,
  // но разным от партии к партии — иначе одно и то же место выигрывало бы все ничьи.
  game.matchSeed ??= Math.floor(Math.random() * 0xffffffff) >>> 0
  const turnLimit = options?.turnLimit === undefined ? DEFAULT_TURN_LIMIT : options.turnLimit
  if (turnLimit == null) game.turnLimit = undefined
  else game.turnLimit ??= turnLimit

  // Бюджет перезарядки выдаётся каждый игровой ход, включая первый.
  refreshRechargeBudgets(game)

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
    refreshActionMarkerCapacity(game)
    return
  }

  const state = gameStateFromSnapshot(game, mapId)
  game.activePlayerId =
    activePlayerOrder(state.players, ids, { state, phase: 'planning' })[0] ?? ids[0] ?? null
  refreshActionMarkerCapacity(game)
}
