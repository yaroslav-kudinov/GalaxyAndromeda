import { doctrineClaimLimitModifier } from './doctrines.js'
import { removeStaleProductionMarkerAt } from './markers.js'
import { grantRechargeBudgetFor, participantsOf } from './resource-recharge.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { HexCoord } from './types.js'
import { applyVictoryAndDefeatChecks } from './victory.js'

function hasEnemyShips(cell: RuntimeCellState, playerId: string): boolean {
  return cell.ships.some((ship) => ship.ownerId !== playerId)
}

function hasOwnShips(cell: RuntimeCellState, playerId: string): boolean {
  return cell.ships.some((ship) => ship.ownerId === playerId)
}

/**
 * Занять клетку может корабль любого класса.
 *
 * Прежде нейтраль брали только «колонизаторы» (крейсер и тяжелее), а эсминец — лишь ценой
 * собственной гибели. Ограничителем экспансии теперь служит лимит захвата, поэтому делить
 * корабли на колонизаторов и прочих незачем: эсминец дёшев и быстр, и его дело — экспансия
 * и диверсии.
 */
export function canClaimCell(cell: RuntimeCellState, playerId: string): boolean {
  if (!hasOwnShips(cell, playerId) || hasEnemyShips(cell, playerId)) return false
  return cell.controlOwnerId !== playerId
}

function countPowerCenters(game: GameSnapshot, playerId: string): number {
  let n = 0
  for (const cell of game.cells) {
    if (cell.isPowerCenter && cell.controlOwnerId === playerId) n += 1
  }
  return n
}

/**
 * Сколько клеток игрок занимает за один ход.
 *
 * Это единственный тормоз экспансии, и другого не нужно: сколько бы кораблей ни стояло на
 * нейтрали, за ход возьмётся не больше лимита. Лимит растёт с числом центров власти — это
 * прибавка, за которую платят бюджетом перезарядки.
 *
 * Константа от числа центров, а не «число неиспользованных маркеров»: фаза действий не
 * закрывается, пока маркеры остаются, поэтому к моменту захвата их всегда ноль.
 */
export function computeClaimLimit(game: GameSnapshot, playerId: string): number {
  return Math.max(0, 1 + countPowerCenters(game, playerId) + doctrineClaimLimitModifier(game, playerId))
}

export function eligibleClaimCells(game: GameSnapshot, playerId: string): RuntimeCellState[] {
  return game.cells.filter((cell) => canClaimCell(cell, playerId))
}

export function claimPicksRemaining(game: GameSnapshot, playerId: string): number {
  return game.claimPicksRemainingByPlayer?.[playerId] ?? 0
}

function setClaimPicksRemaining(game: GameSnapshot, playerId: string, value: number): void {
  game.claimPicksRemainingByPlayer ??= {}
  if (value > 0) game.claimPicksRemainingByPlayer[playerId] = value
  else delete game.claimPicksRemainingByPlayer[playerId]
}

function claimCell(game: GameSnapshot, cell: RuntimeCellState, playerId: string): void {
  cell.controlOwnerId = playerId
  removeStaleProductionMarkerAt(game, cell.coord)
}

function appendClaimEvent(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'claim',
    message,
    timestamp: Date.now(),
  })
}

/**
 * Порядок автоматического захвата: центры власти, затем клетки с дорогими фишками, затем
 * по координатам. Нужен, когда игрок выбор не сделал, — и обязан быть детерминированным,
 * иначе прогоны харнесса перестанут воспроизводиться.
 */
function claimPriority(a: RuntimeCellState, b: RuntimeCellState): number {
  if (a.isPowerCenter !== b.isPowerCenter) return a.isPowerCenter ? -1 : 1
  const valueOf = (cell: RuntimeCellState) =>
    cell.resourceTokens.reduce((sum, token) => sum + token.value, 0)
  const diff = valueOf(b) - valueOf(a)
  if (diff !== 0) return diff
  if (a.coord.q !== b.coord.q) return a.coord.q - b.coord.q
  return a.coord.r - b.coord.r
}

/**
 * Вход на клетку под контролем другого игрока: контроль сразу у входящего,
 * чужой маркер производства снимается. Нейтральную клетку не трогает.
 * Если на клетке ещё стоят чужие корабли — не захватывает (это бой).
 *
 * Центр власти так не переходит (ADR 019): защищённый берут штурмом или осадой, пустой —
 * захватом в конце хода, в счёт лимита. Иначе быстрые корабли снимали бы чужие центры
 * набегом без всякого лимита.
 */
export function transferControlIfEnemyOwned(
  game: GameSnapshot,
  cell: RuntimeCellState,
  enteringPlayerId: string,
): boolean {
  if (cell.isPowerCenter) return false
  if (!cell.controlOwnerId || cell.controlOwnerId === enteringPlayerId) return false
  if (hasEnemyShips(cell, enteringPlayerId)) return false
  cell.controlOwnerId = enteringPlayerId
  removeStaleProductionMarkerAt(game, cell.coord)
  return true
}

/**
 * Конец игрового хода: занять клетки в пределах лимита.
 *
 * Если подходящих клеток не больше лимита — занимаем все молча. Если больше, выбор
 * откладывается: игрок закроет его в начале следующего планирования, до выдачи бюджета
 * перезарядки, потому что бюджет зависит от числа центров власти после захвата.
 */
export function applyTurnEndClaims(game: GameSnapshot, mapId: string): { claimed: number } {
  let claimed = 0
  game.claimPicksRemainingByPlayer = {}

  for (const playerId of participantsOf(game)) {
    const eligible = eligibleClaimCells(game, playerId)
    if (eligible.length === 0) continue

    const limit = computeClaimLimit(game, playerId)
    if (limit <= 0) continue

    if (eligible.length <= limit) {
      for (const cell of eligible) claimCell(game, cell, playerId)
      claimed += eligible.length
      continue
    }
    setClaimPicksRemaining(game, playerId, limit)
  }

  if (claimed) appendClaimEvent(game, `Объявление контроля: занято клеток ${claimed}`)
  if (claimed) applyVictoryAndDefeatChecks(game, mapId)
  return { claimed }
}

export function maybeApplyTurnEndClaims(
  game: GameSnapshot,
  previousPhase: string,
  mapId: string,
): void {
  if ((previousPhase === 'actions' || previousPhase === 'production') && game.phase === 'planning') {
    applyTurnEndClaims(game, mapId)
  }
}

export const CLAIM_PICK_ERRORS = {
  nothingOwed: 'Сейчас занимать клетки не нужно',
  tooMany: 'Выбрано больше клеток, чем позволяет лимит захвата',
  duplicate: 'Одна и та же клетка выбрана дважды',
  notEligible: 'Эту клетку занять нельзя',
  unknown: 'Клетка не найдена',
} as const

/** Занять выбранные клетки в счёт лимита. */
export function executeClaimPicks(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  picks: readonly HexCoord[],
): string[] {
  const remaining = claimPicksRemaining(game, playerId)
  if (remaining <= 0) return [CLAIM_PICK_ERRORS.nothingOwed]
  if (picks.length === 0) return [CLAIM_PICK_ERRORS.nothingOwed]
  if (picks.length > remaining) return [CLAIM_PICK_ERRORS.tooMany]

  const seen = new Set<string>()
  const resolved: RuntimeCellState[] = []
  for (const pick of picks) {
    const key = `${pick.q},${pick.r}`
    if (seen.has(key)) return [CLAIM_PICK_ERRORS.duplicate]
    seen.add(key)

    const cell = game.cells.find(
      (candidate) => candidate.coord.q === pick.q && candidate.coord.r === pick.r,
    )
    if (!cell) return [CLAIM_PICK_ERRORS.unknown]
    // Проверяем пригодность заново: между концом хода и выбором доска не менялась,
    // но полагаться на это нельзя.
    if (!canClaimCell(cell, playerId)) return [CLAIM_PICK_ERRORS.notEligible]
    resolved.push(cell)
  }

  for (const cell of resolved) claimCell(game, cell, playerId)
  setClaimPicksRemaining(game, playerId, remaining - resolved.length)
  appendClaimEvent(game, `Объявление контроля: занято клеток ${resolved.length}`)

  if (claimPicksRemaining(game, playerId) === 0) grantRechargeBudgetFor(game, playerId)
  applyVictoryAndDefeatChecks(game, mapId)
  return []
}

/** Закрыть выбор за игрока по приоритету: центры власти, затем дорогие фишки. */
export function autoResolveClaimPicks(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
): number {
  const remaining = claimPicksRemaining(game, playerId)
  if (remaining <= 0) return 0

  const taken = eligibleClaimCells(game, playerId).sort(claimPriority).slice(0, remaining)
  for (const cell of taken) claimCell(game, cell, playerId)
  setClaimPicksRemaining(game, playerId, 0)
  if (taken.length) appendClaimEvent(game, `Объявление контроля автоматически: занято клеток ${taken.length}`)

  grantRechargeBudgetFor(game, playerId)
  if (taken.length) applyVictoryAndDefeatChecks(game, mapId)
  return taken.length
}

/** Закрыть все незавершённые выборы: партия не должна вставать из-за несделанного выбора. */
export function autoResolveAllClaimPicks(game: GameSnapshot, mapId: string): void {
  for (const playerId of Object.keys(game.claimPicksRemainingByPlayer ?? {})) {
    autoResolveClaimPicks(game, mapId, playerId)
  }
}
