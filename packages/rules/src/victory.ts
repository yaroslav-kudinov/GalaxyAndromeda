import { buildSpatialSummary } from './observation/ascii-map.js'
import { trimGameEventLog } from './event-log.js'
import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState } from './types.js'

export type VictoryReason = 'four_regions' | 'power_centers' | 'last_standing'

export type GameOverReason = VictoryReason

export interface GameOverState {
  winnerId: string
  reason: GameOverReason
}

const VICTORY_REGION_MIN_SIZE = 7
const VICTORY_REGION_COUNT = 4

const REASON_LABELS: Record<VictoryReason, string> = {
  four_regions: 'контроль 4 регионов от 7 клеток',
  power_centers: 'большинство энергоцентров',
  last_standing: 'единственный оставшийся игрок',
}

function activePlayers(state: GameState): string[] {
  return state.players.filter((p) => !p.eliminated).map((p) => p.id)
}

function regionsOfSizeForPlayer(state: GameState, playerId: string, minSize: number): number {
  const summary = buildSpatialSummary(state)
  return summary.regions.filter((r) => r.ownerId === playerId && r.size >= minSize).length
}

function powerCenterCounts(state: GameState): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cell of state.cells) {
    if (!cell.isPowerCenter || !cell.controlOwnerId) continue
    counts.set(cell.controlOwnerId, (counts.get(cell.controlOwnerId) ?? 0) + 1)
  }
  return counts
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
  if (regionsOfSizeForPlayer(state, winnerId, VICTORY_REGION_MIN_SIZE) >= VICTORY_REGION_COUNT) {
    return 'four_regions'
  }
  const pc = powerCenterCounts(state).get(winnerId) ?? 0
  const total = [...powerCenterCounts(state).values()].reduce((a, b) => a + b, 0)
  if (total > 0 && pc > total / 2) return 'power_centers'
  return 'last_standing'
}

/** Returns winner or null if no victory yet. */
export function checkVictory(state: GameState): { winnerId: string; reason: VictoryReason } | null {
  const players = activePlayers(state)
  if (players.length <= 1 && players.length > 0) {
    return { winnerId: players[0]!, reason: 'last_standing' }
  }

  for (const playerId of players) {
    if (regionsOfSizeForPlayer(state, playerId, VICTORY_REGION_MIN_SIZE) >= VICTORY_REGION_COUNT) {
      return { winnerId: playerId, reason: 'four_regions' }
    }
  }

  const pcCounts = powerCenterCounts(state)
  const totalPc = [...pcCounts.values()].reduce((a, b) => a + b, 0)
  if (totalPc > 0) {
    let bestId: string | null = null
    let bestCount = 0
    let tie = false
    for (const [playerId, count] of pcCounts) {
      if (!players.includes(playerId)) continue
      if (count > bestCount) {
        bestCount = count
        bestId = playerId
        tie = false
      } else if (count === bestCount && count > totalPc / 2) {
        tie = true
      }
    }
    if (bestId && !tie && bestCount > totalPc / 2) {
      return { winnerId: bestId, reason: 'power_centers' }
    }
  }

  const withPresence = players.filter((id) => playerHasPresence(state, id))
  if (withPresence.length === 1) {
    return { winnerId: withPresence[0]!, reason: 'last_standing' }
  }

  return null
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

export function applyVictoryAndDefeatChecks(
  game: GameSnapshot,
  mapId: string,
): { eliminated: string[]; gameOver: GameOverState | null } {
  if (game.gameOver) {
    return { eliminated: [], gameOver: game.gameOver }
  }

  const state = gameStateFromSnapshot(game, mapId)
  const eliminated = checkDefeat(state)

  for (const playerId of eliminated) {
    const player = game.players.find((p) => p.id === playerId)
    if (player && !player.eliminated) {
      player.eliminated = true
      game.eventLog.push({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        turn: game.turnNumber,
        phase: game.phase,
        type: 'elimination',
        message: `${player.name} выбыл — потеряны все энергоцентры`,
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
    game.gameOver = { winnerId: victory.winnerId, reason: victory.reason }
    const winner = game.players.find((p) => p.id === victory.winnerId)
    game.eventLog.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      turn: game.turnNumber,
      phase: game.phase,
      type: 'victory',
      message: `Победа: ${winner?.name ?? victory.winnerId} (${REASON_LABELS[victory.reason]})`,
      timestamp: Date.now(),
    })
    trimGameEventLog(game)
    return { eliminated, gameOver: game.gameOver }
  }

  trimGameEventLog(game)
  return { eliminated, gameOver: null }
}

export function victoryReasonLabel(state: GameState, winnerId: string): string {
  return REASON_LABELS[detectVictoryReason(state, winnerId)]
}
