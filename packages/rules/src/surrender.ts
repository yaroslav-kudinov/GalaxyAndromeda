import { trimGameEventLog } from './event-log.js'
import { clearMarkersOwnedByPlayer } from './markers.js'
import { applyVictoryAndDefeatChecks } from './victory.js'
import type { GameSnapshot } from './save-file.js'
import { ensureActivePlayerParticipating } from './save-file.js'

export function isEliminatedPlayer(game: GameSnapshot, playerId: string): boolean {
  return game.players.find((p) => p.id === playerId)?.eliminated === true
}

/** Выбывший не подтверждает prep / continue / выбор уничтожения. */
export function isCombatInteractivePlayer(game: GameSnapshot, playerId: string): boolean {
  return !isEliminatedPlayer(game, playerId)
}

/** Готовность стороны в prep: выбывший считается готовым без нажатия. */
export function isCombatPrepSideReady(
  game: GameSnapshot,
  playerId: string,
  readyBy: Record<string, boolean>,
): boolean {
  if (!isCombatInteractivePlayer(game, playerId)) return true
  return readyBy[playerId] === true
}

export function surrenderPlayer(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
): string[] {
  if (game.gameOver) return ['Игра завершена']
  const player = game.players.find((p) => p.id === playerId)
  if (!player) return ['Игрок не найден']
  if (player.eliminated) return ['Вы уже выбыли']

  player.eliminated = true

  for (const cell of game.cells) {
    if (cell.controlOwnerId === playerId) cell.controlOwnerId = null
  }

  clearMarkersOwnedByPlayer(game, playerId)

  game.participatingPlayerIds = (game.participatingPlayerIds ?? game.players.map((p) => p.id))
    .filter((id) => id !== playerId)

  ensureActivePlayerParticipating(game)

  autoResolveSurrenderedCombatDecisions(game, playerId)

  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'surrender',
    message: `${player.name} сдался — контроль снят, боевой флот остаётся`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
  applyVictoryAndDefeatChecks(game, mapId)
  return []
}

function autoResolveSurrenderedCombatDecisions(game: GameSnapshot, playerId: string): void {
  const pending = game.pendingCombat
  if (!pending) return
  if (pending.phase === 'prep') {
    pending.prep.readyBy[playerId] = true
    if (pending.prep.combatOptions.supportSides) {
      delete pending.prep.combatOptions.supportSides[playerId]
    }
    const prep = pending.prep
    const attackerReady = isCombatPrepSideReady(game, pending.attackerId, prep.readyBy)
    const defenderReady = isCombatPrepSideReady(game, prep.defenderId, prep.readyBy)
    // Кандидаты поддержки пересчитываются в combat; здесь достаточно сторон боя.
    if (pending.trigger !== 'bombardment' && attackerReady && defenderReady && prep.phase === 'prep') {
      prep.phase = 'countdown'
      prep.countdownStartedAt = Date.now()
    } else if (pending.trigger === 'bombardment' && attackerReady && prep.phase === 'prep') {
      prep.phase = 'countdown'
      prep.countdownStartedAt = Date.now()
    }
  }
  if (pending.phase === 'awaiting-continue') {
    if (pending.attackerId === playerId) pending.continueDecisions.attacker = true
    if (pending.defenderIds.includes(playerId)) pending.continueDecisions.defender = true
  }
}

export function canSupportCombatSide(
  game: GameSnapshot,
  side: 'attacker' | 'defender',
  attackerId: string,
  defenderIds: string[],
): boolean {
  if (side === 'attacker') return !isEliminatedPlayer(game, attackerId)
  return defenderIds.some((id) => !isEliminatedPlayer(game, id))
}
