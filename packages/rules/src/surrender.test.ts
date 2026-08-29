import { describe, expect, it } from 'vitest'
import { applyGameActionOnSnapshot } from './movement.js'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import { canSupportCombatSide, surrenderPlayer } from './surrender.js'
import { checkVictory } from './victory.js'
import { gameStateFromSnapshot } from './save-file.js'

describe('surrender', () => {
  it('clears control and markers but keeps ships', () => {
    const map = createEmptyMap('surrender', 'Surrender')
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    const home = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    home.ships.push({ id: 'dd-1', type: 'destroyer', ownerId: 'player-1' })
    home.controlOwnerId = 'player-1'
    home.actionMarkerId = 'am-1'
    game.actionMarkers.push({
      id: 'am-1',
      ownerId: 'player-1',
      coord: { q: 0, r: 0 },
      placedInPhase: 'planning',
    })
    expect(surrenderPlayer(game, map.id, 'player-1')).toEqual([])
    expect(game.players.find((p) => p.id === 'player-1')?.eliminated).toBe(true)
    expect(home.controlOwnerId).toBeNull()
    expect(home.actionMarkerId).toBeNull()
    expect(game.actionMarkers).toHaveLength(0)
    expect(home.ships.some((s) => s.id === 'dd-1')).toBe(true)
  })

  it('orphan fleet does not keep the surrendered player as last standing', () => {
    const map = createEmptyMap('surrender-last', 'Surrender last')
    const game = gameSnapshotFromMap(map)
    game.cells[0]!.ships.push({ id: 'dd-1', type: 'destroyer', ownerId: 'player-1' })
    surrenderPlayer(game, map.id, 'player-1')
    const result = checkVictory(gameStateFromSnapshot(game, map.id))
    expect(result?.winnerId).toBe('player-2')
    expect(result?.reason).toBe('last_standing')
  })

  it('forbids support for an eliminated attacker', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.players[0]!.eliminated = true
    expect(canSupportCombatSide(game, 'attacker', 'player-1', ['player-2'])).toBe(false)
    expect(canSupportCombatSide(game, 'defender', 'player-1', ['player-2'])).toBe(true)
  })

  it('applyGameActionOnSnapshot accepts surrender off-turn', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    const result = applyGameActionOnSnapshot(game, map, 'player-2', 'surrender')
    expect(result.errors).toEqual([])
    expect(game.players.find((p) => p.id === 'player-2')?.eliminated).toBe(true)
  })
})
