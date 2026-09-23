import { doctrineRechargeModifier } from './doctrines.js'
import { trimGameEventLog } from './event-log.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { HexCoord } from './types.js'
import { victoryThresholdForSnapshot } from './victory.js'

/** Ссылка на конкретную фишку на клетке. Совпадает по форме с `TokenSpendRef` в производстве. */
export interface ResourceTokenRef {
  coord: HexCoord
  tokenIndex: number
}

/**
 * Бюджет перезарядки: сколько фишек игрок поднимает лицом вверх за один ход.
 *
 * Прежде переворачивались разом **все** потраченные фишки всех игроков раз в случайные
 * один-три хода, то есть доход был пропорционален территории и ничем не ограничен сверху.
 * Теперь возврат ограничен числом фишек, и это число падает с ростом числа центров власти:
 * центр власти даёт прибавку к захвату, но режет экономику. Размен «одно на одно».
 *
 * Формула выводится из порога победы, а не назначается: наклон задан требованием читаемого
 * размена (минус одна фишка за центр), ноль наступает ровно за шаг до победы. При пороге 6
 * это даёт 4-3-2-1-0.
 *
 * Бюджет ограничивает **скорость возврата**, а не объём трат: поднятые фишки не сгорают,
 * копить на дорогой корабль можно.
 */
export function computeRechargeBudget(
  game: GameSnapshot,
  ownerId: string,
  doctrineModifier = doctrineRechargeModifier(game, ownerId),
): number {
  const threshold = victoryThresholdForSnapshot(game)
  let powerCenters = 0
  for (const cell of game.cells) {
    if (cell.isPowerCenter && cell.controlOwnerId === ownerId) powerCenters += 1
  }
  return Math.max(0, threshold - 1 - powerCenters + doctrineModifier)
}

function faceDownTokensOf(game: GameSnapshot, ownerId: string): {
  cell: RuntimeCellState
  tokenIndex: number
  value: number
}[] {
  const found: { cell: RuntimeCellState; tokenIndex: number; value: number }[] = []
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== ownerId) continue
    cell.resourceTokens.forEach((token, tokenIndex) => {
      if (token.faceUp === false) found.push({ cell, tokenIndex, value: token.value })
    })
  }
  return found
}

export function countFaceDownTokens(game: GameSnapshot, ownerId: string): number {
  return faceDownTokensOf(game, ownerId).length
}

export function rechargePicksRemaining(game: GameSnapshot, ownerId: string): number {
  return game.rechargePicksRemainingByPlayer?.[ownerId] ?? 0
}

function setPicksRemaining(game: GameSnapshot, ownerId: string, value: number): void {
  game.rechargePicksRemainingByPlayer ??= {}
  if (value > 0) game.rechargePicksRemainingByPlayer[ownerId] = value
  else delete game.rechargePicksRemainingByPlayer[ownerId]
}

function appendRechargeEvent(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'recharge',
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

export function participantsOf(game: GameSnapshot): string[] {
  const participating = game.participatingPlayerIds?.length
    ? new Set(game.participatingPlayerIds)
    : null
  return game.players
    .filter((player) => !player.eliminated && (!participating || participating.has(player.id)))
    .map((player) => player.id)
}

/**
 * Выдать бюджет одному игроку.
 *
 * Отдельно для каждого, потому что бюджет зависит от числа центров власти, а оно
 * уточняется захватом: пока у игрока не разрешён выбор клеток, считать ему бюджет рано.
 *
 * Если перевёрнутых фишек не больше бюджета — поднимаем все молча: диалог нужен только
 * когда выбирать действительно приходится.
 */
export function grantRechargeBudgetFor(game: GameSnapshot, playerId: string): void {
  setPicksRemaining(game, playerId, 0)
  // Бюджет зависит от доктрины: пока выбор открыт, выдавать рано.
  if (game.doctrineChoice) return
  const faceDown = faceDownTokensOf(game, playerId)
  if (faceDown.length === 0) return

  const budget = computeRechargeBudget(game, playerId)
  if (budget === 0) return

  if (faceDown.length <= budget) {
    for (const entry of faceDown) {
      const token = entry.cell.resourceTokens[entry.tokenIndex]
      if (token) token.faceUp = true
    }
    return
  }
  setPicksRemaining(game, playerId, budget)
}

/**
 * Начало игрового хода: выдать бюджет всем, у кого не осталось незакрытого выбора клеток
 * для захвата. Остальным бюджет выдаётся в момент закрытия этого выбора.
 */
export function refreshRechargeBudgets(
  game: GameSnapshot,
  hasPendingClaims: (playerId: string) => boolean = () => false,
): void {
  game.rechargePicksRemainingByPlayer = {}
  for (const playerId of participantsOf(game)) {
    if (hasPendingClaims(playerId)) continue
    grantRechargeBudgetFor(game, playerId)
  }
}

export const RECHARGE_PICK_ERRORS = {
  nothingOwed: 'Сейчас переворачивать фишки не нужно',
  tooMany: 'Выбрано больше фишек, чем позволяет бюджет перезарядки',
  notYours: 'Фишка не на вашей клетке',
  notFaceDown: 'Фишка уже лицом вверх',
  duplicate: 'Одна и та же фишка выбрана дважды',
  unknown: 'Фишка не найдена',
} as const

/** Перевернуть выбранные фишки лицом вверх в счёт бюджета. */
export function executeRechargePicks(
  game: GameSnapshot,
  playerId: string,
  picks: readonly ResourceTokenRef[],
): string[] {
  const remaining = rechargePicksRemaining(game, playerId)
  if (remaining <= 0) return [RECHARGE_PICK_ERRORS.nothingOwed]
  if (picks.length === 0) return [RECHARGE_PICK_ERRORS.nothingOwed]
  if (picks.length > remaining) return [RECHARGE_PICK_ERRORS.tooMany]

  const seen = new Set<string>()
  const resolved: { cell: RuntimeCellState; tokenIndex: number }[] = []
  for (const pick of picks) {
    const key = `${pick.coord.q},${pick.coord.r}:${pick.tokenIndex}`
    if (seen.has(key)) return [RECHARGE_PICK_ERRORS.duplicate]
    seen.add(key)

    const cell = game.cells.find(
      (candidate) => candidate.coord.q === pick.coord.q && candidate.coord.r === pick.coord.r,
    )
    if (!cell) return [RECHARGE_PICK_ERRORS.unknown]
    if (cell.controlOwnerId !== playerId) return [RECHARGE_PICK_ERRORS.notYours]
    const token = cell.resourceTokens[pick.tokenIndex]
    if (!token) return [RECHARGE_PICK_ERRORS.unknown]
    if (token.faceUp !== false) return [RECHARGE_PICK_ERRORS.notFaceDown]
    resolved.push({ cell, tokenIndex: pick.tokenIndex })
  }

  for (const entry of resolved) {
    const token = entry.cell.resourceTokens[entry.tokenIndex]
    if (token) token.faceUp = true
  }
  setPicksRemaining(game, playerId, remaining - resolved.length)
  appendRechargeEvent(game, `Перезарядка: поднято фишек ${resolved.length}`)
  return []
}

/**
 * Разрешить долг за игрока: самые крупные номиналы первыми.
 *
 * Нужно для ИИ, для таймаута и при закрытии фазы планирования — иначе игрок, не сделавший
 * выбор, подвесит партию. Порядок детерминирован, чтобы прогон был воспроизводим.
 *
 * Сортируем по печатному номиналу, а не по эффективному: бонус события прибавляется всем
 * фишкам одинаково и порядка не меняет.
 */
export function autoResolveRechargePicks(game: GameSnapshot, playerId: string): number {
  const remaining = rechargePicksRemaining(game, playerId)
  if (remaining <= 0) return 0

  const ordered = faceDownTokensOf(game, playerId).sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value
    if (a.cell.coord.q !== b.cell.coord.q) return a.cell.coord.q - b.cell.coord.q
    if (a.cell.coord.r !== b.cell.coord.r) return a.cell.coord.r - b.cell.coord.r
    return a.tokenIndex - b.tokenIndex
  })

  const taken = ordered.slice(0, remaining)
  for (const entry of taken) {
    const token = entry.cell.resourceTokens[entry.tokenIndex]
    if (token) token.faceUp = true
  }
  setPicksRemaining(game, playerId, 0)
  if (taken.length > 0) {
    appendRechargeEvent(game, `Перезарядка автоматически: поднято фишек ${taken.length}`)
  }
  return taken.length
}

/** Закрыть все незавершённые долги: партия не должна вставать из-за несделанного выбора. */
export function autoResolveAllRechargePicks(game: GameSnapshot): void {
  for (const playerId of Object.keys(game.rechargePicksRemainingByPlayer ?? {})) {
    autoResolveRechargePicks(game, playerId)
  }
}

/** Текст для игрока: сколько фишек можно поднять в этом ходу. */
export function formatRechargeBudgetHint(budget: number, owed: number): string {
  if (owed > 0) return `Перезарядка: выберите фишки, осталось ${owed}`
  if (budget <= 0) return 'Перезарядка недоступна: слишком много центров власти'
  return `Перезарядка: до ${budget} фишек за ход`
}
