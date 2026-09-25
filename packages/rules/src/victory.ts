import { trimGameEventLog } from './event-log.js'
import { clearMarkersOwnedByPlayer } from './markers.js'
import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState } from './types.js'

export type VictoryReason = 'power_centers' | 'last_standing' | 'turn_limit'

export type GameOverReason = VictoryReason

export interface GameOverState {
  winnerId: string
  reason: GameOverReason
}

/** Пункт цепочки, на котором определился победитель по лимиту ходов. */
export type TurnLimitRung = 'power_centers' | 'cells' | 'face_up_value' | 'lot'

export interface TurnLimitOutcome {
  winnerId: string
  rung: TurnLimitRung
}

const REASON_LABELS: Record<VictoryReason, string> = {
  power_centers: 'большинство центров власти',
  last_standing: 'единственный оставшийся игрок',
  turn_limit: 'лимит ходов',
}

function activePlayers(state: GameState): string[] {
  return state.players.filter((p) => !p.eliminated).map((p) => p.id)
}

function powerCenterCounts(state: GameState): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cell of state.cells) {
    if (!cell.isPowerCenter || !cell.controlOwnerId) continue
    counts.set(cell.controlOwnerId, (counts.get(cell.controlOwnerId) ?? 0) + 1)
  }
  return counts
}

function totalPowerCentersOnMap(state: GameState): number {
  return state.cells.reduce((n, cell) => n + (cell.isPowerCenter ? 1 : 0), 0)
}

/**
 * Сколько центров власти нужно для победы.
 *
 * Порог задаётся картой и копируется в снимок при старте партии: карту можно
 * отредактировать между партиями, а начатая партия обязана доиграться со своим порогом.
 * Запасное правило «строго больше половины» остаётся для снимков без явного порога —
 * например, собранных в тестах напрямую из карты, без старта матча.
 */
export function victoryThresholdForState(state: GameState): number {
  const explicit = state.victoryPowerCenters
  if (explicit != null && explicit > 0) return explicit
  return Math.floor(totalPowerCentersOnMap(state) / 2) + 1
}

/**
 * То же, что `victoryThresholdForState`, но по снимку партии: экономике нужен порог там,
 * где `GameState` не строится. Правило одно и живёт в одном месте.
 */
export function victoryThresholdForSnapshot(game: GameSnapshot): number {
  const explicit = game.victoryPowerCenters
  if (explicit != null && explicit > 0) return explicit
  const total = game.cells.reduce((n, cell) => n + (cell.isPowerCenter ? 1 : 0), 0)
  return Math.floor(total / 2) + 1
}

function controlledCellCount(state: GameState, playerId: string): number {
  return state.cells.filter((cell) => cell.controlOwnerId === playerId).length
}

function faceUpTokenValue(state: GameState, playerId: string): number {
  let total = 0
  for (const cell of state.cells) {
    if (cell.controlOwnerId !== playerId) continue
    for (const token of cell.resourceTokens) {
      if (token.faceUp !== false) total += token.value
    }
  }
  return total
}

function playerHasPresence(state: GameState, playerId: string): boolean {
  const hasControl = state.cells.some((c) => c.controlOwnerId === playerId)
  const hasShips = state.cells.some((c) => c.ships.some((s) => s.ownerId === playerId))
  return hasControl || hasShips
}

function playerControlsAnyPowerCenter(state: GameState, playerId: string): boolean {
  return state.cells.some((c) => c.isPowerCenter && c.controlOwnerId === playerId)
}

function detectVictoryReason(state: GameState, winnerId: string): VictoryReason {
  const pc = powerCenterCounts(state).get(winnerId) ?? 0
  if (pc >= victoryThresholdForState(state)) return 'power_centers'
  return 'last_standing'
}

/** Детерминированный жребий: одинаков при повторной загрузке того же сейва. */
function drawLot(seed: number, candidates: readonly string[]): string {
  const sorted = [...candidates].sort()
  let hash = (seed ^ 0x9e3779b9) >>> 0
  for (const id of sorted) {
    for (let i = 0; i < id.length; i += 1) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0
    }
  }
  return sorted[hash % sorted.length]!
}

/**
 * Победитель по лимиту ходов. Цепочка обязана быть исчерпывающей: партия не может
 * закончиться без победителя.
 *
 * 1. больше центров власти;
 * 2. больше контролируемых клеток;
 * 3. больше суммарного номинала фишек лицом вверх;
 * 4. жребий по сиду партии — а не по номеру игрока, иначе одно и то же место
 *    выигрывало бы все ничьи во всех партиях на этой карте.
 */
export function resolveTurnLimitWinner(
  state: GameState,
  matchSeed = 0,
): TurnLimitOutcome | null {
  const players = activePlayers(state).filter((id) => playerHasPresence(state, id))
  if (players.length === 0) return null
  if (players.length === 1) return { winnerId: players[0]!, rung: 'power_centers' }

  const counts = powerCenterCounts(state)
  const rungs: { rung: TurnLimitRung; score: (playerId: string) => number }[] = [
    { rung: 'power_centers', score: (id) => counts.get(id) ?? 0 },
    { rung: 'cells', score: (id) => controlledCellCount(state, id) },
    { rung: 'face_up_value', score: (id) => faceUpTokenValue(state, id) },
  ]

  let pool = players
  for (const { rung, score } of rungs) {
    const best = Math.max(...pool.map(score))
    const leaders = pool.filter((id) => score(id) === best)
    if (leaders.length === 1) return { winnerId: leaders[0]!, rung }
    pool = leaders
  }

  return { winnerId: drawLot(matchSeed, pool), rung: 'lot' }
}

/**
 * Кто победил бы, закончись партия прямо сейчас, и по какому пункту цепочки он ведёт.
 * Для интерфейса: чтобы лимит ходов не выглядел внезапной концовкой. Возвращает null,
 * если партия уже завершена или считать не из кого.
 */
export function provisionalWinnerForSnapshot(
  game: GameSnapshot,
  mapId: string,
): TurnLimitOutcome | null {
  if (game.gameOver) return null
  const state = gameStateFromSnapshot(game, mapId)
  return resolveTurnLimitWinner(state, game.matchSeed ?? 0)
}

/** Returns winner or null if no victory yet. */
export function checkVictory(state: GameState): { winnerId: string; reason: VictoryReason } | null {
  const players = activePlayers(state)
  if (players.length <= 1 && players.length > 0) {
    return { winnerId: players[0]!, reason: 'last_standing' }
  }

  const pcCounts = powerCenterCounts(state)
  const threshold = victoryThresholdForState(state)
  if (totalPowerCentersOnMap(state) > 0) {
    let bestId: string | null = null
    let bestCount = 0
    let tie = false
    for (const playerId of players) {
      const count = pcCounts.get(playerId) ?? 0
      if (count > bestCount) {
        bestCount = count
        bestId = playerId
        tie = false
      } else if (count === bestCount && count >= threshold) {
        tie = true
      }
    }
    if (bestId && !tie && bestCount >= threshold) {
      return { winnerId: bestId, reason: 'power_centers' }
    }
  }

  const withPresence = players.filter((id) => playerHasPresence(state, id))
  if (withPresence.length === 1) {
    return { winnerId: withPresence[0]!, reason: 'last_standing' }
  }

  return null
}

/** Лимит ходов исчерпан: партия обязана завершиться на этом ходу. */
export function isTurnLimitReached(game: GameSnapshot): boolean {
  return game.turnLimit != null && game.turnNumber > game.turnLimit
}

/** Player ids that should be eliminated (lost all power centers). */
export function checkDefeat(state: GameState): string[] {
  const newlyEliminated: string[] = []
  const hasPc = state.cells.some((c) => c.isPowerCenter)
  if (!hasPc) return newlyEliminated

  for (const player of state.players) {
    if (player.eliminated) continue
    if (!playerControlsAnyPowerCenter(state, player.id)) {
      newlyEliminated.push(player.id)
    }
  }
  return newlyEliminated
}

/**
 * Захваты хода ещё не подсчитаны: кто-то из оставшихся в партии не выбрал клетки.
 *
 * Захваты всех игроков в начале хода одновременны. Если проверить победу, пока один уже занял
 * клетки, а другой ещё выбирает, первый может победить центром, который второй в тот же момент
 * у него отбирает. Поэтому центры власти считаются только после захватов всех.
 */
function remainingPlayerIds(game: GameSnapshot): Set<string> {
  return new Set(
    game.players
      .filter((player) => !player.eliminated
        && (!game.participatingPlayerIds?.length || game.participatingPlayerIds.includes(player.id)))
      .map((player) => player.id),
  )
}

function activePlayerCount(game: GameSnapshot): number {
  return remainingPlayerIds(game).size
}

export function turnClaimsUnsettled(game: GameSnapshot): boolean {
  const remaining = remainingPlayerIds(game)
  // Последний оставшийся побеждает сразу: оспаривать его захват некому.
  if (remaining.size <= 1) return false
  return Object.entries(game.claimPicksRemainingByPlayer ?? {})
    .some(([playerId, picks]) => picks > 0 && remaining.has(playerId))
}

export function applyVictoryAndDefeatChecks(
  game: GameSnapshot,
  mapId: string,
): { eliminated: string[]; gameOver: GameOverState | null } {
  if (game.gameOver) {
    return { eliminated: [], gameOver: game.gameOver }
  }
  // Ни победу, ни выбывание до конца захватов хода не проверяем: последний закрывший выбор
  // клеток вызовет проверку сам (`executeClaimPicks`, `autoResolveClaimPicks`).
  if (turnClaimsUnsettled(game)) {
    return { eliminated: [], gameOver: null }
  }
  // Центры власти считаются только в начале хода, после тика осад и всех захватов: чужой
  // центр переходит к вошедшему посреди хода, и до начала следующего его можно отбить.
  // Исключение — в партии остался один игрок (остальные сдались): ждать некого.
  if (game.phase !== 'planning' && activePlayerCount(game) > 1) {
    return { eliminated: [], gameOver: null }
  }

  const state = gameStateFromSnapshot(game, mapId)
  const eliminated = checkDefeat(state)

  for (const playerId of eliminated) {
    const player = game.players.find((p) => p.id === playerId)
    if (player && !player.eliminated) {
      player.eliminated = true
      clearMarkersOwnedByPlayer(game, playerId)
      game.eventLog.push({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        turn: game.turnNumber,
        phase: game.phase,
        type: 'elimination',
        message: `${player.name} выбыл — потеряны все центры власти`,
        timestamp: Date.now(),
      })
    }
  }

  if (eliminated.length) {
    game.participatingPlayerIds = (game.participatingPlayerIds ?? game.players.map((p) => p.id))
      .filter((id) => {
        const p = game.players.find((pl) => pl.id === id)
        return p && !p.eliminated
      })
  }

  const freshState = gameStateFromSnapshot(game, mapId)
  const victory = checkVictory(freshState)
  if (victory) {
    return finishGame(game, victory.winnerId, victory.reason, eliminated)
  }

  // Лимит ходов проверяется последним: обычная победа всегда важнее разрешения ничьей.
  if (isTurnLimitReached(game)) {
    const outcome = resolveTurnLimitWinner(freshState, game.matchSeed ?? 0)
    if (outcome) return finishGame(game, outcome.winnerId, 'turn_limit', eliminated)
  }

  trimGameEventLog(game)
  return { eliminated, gameOver: null }
}

function finishGame(
  game: GameSnapshot,
  winnerId: string,
  reason: VictoryReason,
  eliminated: string[],
): { eliminated: string[]; gameOver: GameOverState } {
  game.gameOver = { winnerId, reason }
  const winner = game.players.find((p) => p.id === winnerId)
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'victory',
    message: `Победа: ${winner?.name ?? winnerId} (${REASON_LABELS[reason]})`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
  return { eliminated, gameOver: game.gameOver }
}

export function victoryReasonLabel(state: GameState, winnerId: string): string {
  return REASON_LABELS[detectVictoryReason(state, winnerId)]
}
