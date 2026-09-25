import type { GameSnapshot } from './save-file.js'
import type { ShipProductionCost } from './ships.js'

export const START_PRODUCTION_MARKER_LIMIT = 1
export const MAX_PRODUCTION_MARKERS_PER_PLAYER = 3

/**
 * Маркеров действия за ход — столько у каждого игрока, всю партию.
 *
 * Прежняя формула «3 + число центров власти» делала центр власти двойной наградой:
 * он и приближал победу, и давал лишнее действие, а цену платил только бюджет
 * перезарядки. Размен «одно на одно» требует, чтобы число маркеров было постоянным.
 *
 * Шесть выбрано под максимальный лимит захвата, чтобы прибавка к захвату была
 * реализуемой. Оставлено именованной константой: харнесс баланса сравнивает 5 и 6.
 */
export const ACTION_MARKER_LIMIT = 6

export const PRODUCTION_MARKER_EXPAND_COST: Record<2 | 3, ShipProductionCost> = {
  2: { credits: 8, production: 6 },
  3: { credits: 12, production: 9 },
}

export function countControlledPowerCenters(
  game: { cells: { isPowerCenter: boolean; controlOwnerId: string | null }[] },
  ownerId: string,
): number {
  let n = 0
  for (const cell of game.cells) {
    if (cell.isPowerCenter && cell.controlOwnerId === ownerId) n += 1
  }
  return n
}

export function computeActionMarkerLimit(_powerCenterCount?: number): number {
  return ACTION_MARKER_LIMIT
}

/**
 * Лимит маркеров действия, зафиксированный в начале игрового хода
 * (`actionMarkerLimitByPlayer`). Не считается заново по текущим центрам власти.
 */
export function actionMarkerLimitForPlayer(game: GameSnapshot, ownerId: string): number {
  const stored = game.actionMarkerLimitByPlayer?.[ownerId]
  if (stored != null) return stored
  return computeActionMarkerLimit(countControlledPowerCenters(game, ownerId))
}

/** Записать лимит = 2 + текущие центры власти. Не снимает маркеры с карты. */
export function syncActionMarkerLimits(game: GameSnapshot): void {
  game.actionMarkerLimitByPlayer ??= {}
  for (const player of game.players) {
    game.actionMarkerLimitByPlayer[player.id] = computeActionMarkerLimit(
      countControlledPowerCenters(game, player.id),
    )
  }
}

function compareActionMarkersStable(
  a: { id: string; coord: { q: number; r: number } },
  b: { id: string; coord: { q: number; r: number } },
): number {
  if (a.coord.q !== b.coord.q) return a.coord.q - b.coord.q
  if (a.coord.r !== b.coord.r) return a.coord.r - b.coord.r
  return a.id.localeCompare(b.id)
}

/**
 * Если на карте больше маркеров действия, чем замороженный лимит —
 * лишние снимаются детерминированно (сначала большие q/r, затем больший id).
 * Ход фазы не тратится.
 */
export function trimExcessActionMarkers(game: GameSnapshot): void {
  const byOwner = new Map<string, typeof game.actionMarkers>()
  for (const marker of game.actionMarkers) {
    const list = byOwner.get(marker.ownerId) ?? []
    list.push(marker)
    byOwner.set(marker.ownerId, list)
  }

  const removeIds = new Set<string>()
  for (const [ownerId, list] of byOwner) {
    const limit = actionMarkerLimitForPlayer(game, ownerId)
    if (list.length <= limit) continue
    const sorted = [...list].sort(compareActionMarkersStable)
    for (const extra of sorted.slice(limit)) {
      removeIds.add(extra.id)
    }
  }
  if (removeIds.size === 0) return

  game.actionMarkers = game.actionMarkers.filter((marker) => !removeIds.has(marker.id))
  for (const cell of game.cells) {
    if (cell.actionMarkerId && removeIds.has(cell.actionMarkerId)) {
      cell.actionMarkerId =
        game.actionMarkers.find((m) => m.coord.q === cell.coord.q && m.coord.r === cell.coord.r)?.id ?? null
    }
  }
}

/**
 * Пересчитать лимит в начале игрового хода и снять лишние с карты.
 * Не вызывать из боя, клейма, смены контроля в середине хода.
 */
export function refreshActionMarkerCapacity(game: GameSnapshot): void {
  syncActionMarkerLimits(game)
  trimExcessActionMarkers(game)
}

/** Для старых снимков без поля: заполнить 2+n, не перезаписывать замороженное. */
export function ensureActionMarkerLimits(game: GameSnapshot): void {
  game.actionMarkerLimitByPlayer ??= {}
  for (const player of game.players) {
    if (game.actionMarkerLimitByPlayer[player.id] == null) {
      game.actionMarkerLimitByPlayer[player.id] = computeActionMarkerLimit(
        countControlledPowerCenters(game, player.id),
      )
    }
  }
}

export function ensureProductionMarkerLimits(game: GameSnapshot): void {
  game.productionMarkerLimitByPlayer ??= {}
  for (const player of game.players) {
    if (game.productionMarkerLimitByPlayer[player.id] == null) {
      game.productionMarkerLimitByPlayer[player.id] = START_PRODUCTION_MARKER_LIMIT
    }
  }
}

export function ensureMarkerLimits(game: GameSnapshot): void {
  ensureActionMarkerLimits(game)
  ensureProductionMarkerLimits(game)
}

export function productionMarkerLimitForPlayer(game: GameSnapshot, ownerId: string): number {
  ensureProductionMarkerLimits(game)
  const raw = game.productionMarkerLimitByPlayer?.[ownerId] ?? START_PRODUCTION_MARKER_LIMIT
  return Math.min(MAX_PRODUCTION_MARKERS_PER_PLAYER, Math.max(START_PRODUCTION_MARKER_LIMIT, raw))
}

export function nextProductionMarkerExpandCost(currentLimit: number): ShipProductionCost | null {
  const next = (currentLimit + 1) as 2 | 3
  if (next !== 2 && next !== 3) return null
  return PRODUCTION_MARKER_EXPAND_COST[next]
}
