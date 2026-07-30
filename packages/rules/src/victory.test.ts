import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import { applyVictoryAndDefeatChecks, checkDefeat, checkVictory } from './victory.js'
import { gameStateFromSnapshot } from './save-file.js'

function lineMap(count: number, startPlayer = 1) {
  const map = createEmptyMap('victory-test', 'Victory')
  for (let i = 0; i < count; i++) {
    map.cells.push({ q: i, r: 0, startPlayer })
  }
  return map
}

describe('victory', () => {
  it('checkDefeat eliminates player without power centers', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 0, r: 0, isPowerCenter: true, startPlayer: 1 })
    map.cells.push({ q: 1, r: 0, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    game.cells.find((c) => c.coord.q === 1)!.controlOwnerId = 'player-1'
    const eliminated = checkDefeat(gameStateFromSnapshot(game, map.id))
    expect(eliminated).toContain('player-2')
  })

  it('checkVictory: last player standing', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.players[1].eliminated = true
    const state = gameStateFromSnapshot(game, map.id)
    const result = checkVictory(state)
    expect(result?.winnerId).toBe('player-1')
    expect(result?.reason).toBe('last_standing')
  })

  it('applyVictoryAndDefeatChecks sets gameOver', () => {
    const map = lineMap(7)
    const game = gameSnapshotFromMap(map)
    for (const cell of game.cells) cell.controlOwnerId = 'player-1'
    applyVictoryAndDefeatChecks(game, map.id)
    expect(game.gameOver?.winnerId).toBe('player-1')
  })
})
