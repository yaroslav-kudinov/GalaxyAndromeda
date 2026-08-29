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
    expect(game.gameOver?.reason).toBe('last_standing')
  })

  it('four separate regions of 7 cells is not a victory', () => {
    const map = createEmptyMap('four-regions', 'Four')
    map.cells = []
    for (let region = 0; region < 4; region++) {
      const baseQ = region * 10
      for (let i = 0; i < 7; i++) {
        map.cells.push({ q: baseQ + i, r: 0, startPlayer: 1 })
      }
    }
    map.cells.push({ q: 0, r: 1, isPowerCenter: true, startPlayer: 1 })
    map.cells.push({ q: 1, r: 1, isPowerCenter: true, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    expect(checkVictory(gameStateFromSnapshot(game, map.id))).toBeNull()
  })

  it('power_centers: majority of ALL power centers on map, not only occupied', () => {
    const map = createEmptyMap('pc-majority', 'PC')
    map.cells = []
    // 5 центров: нужно > 2.5 → ≥ 3. Два игрока явно на карте.
    map.cells.push(
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 2, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 3, r: 0, isPowerCenter: true },
      { q: 4, r: 0, isPowerCenter: true },
    )
    const game = gameSnapshotFromMap(map)
    expect(game.players.map((p) => p.id)).toEqual(['player-1', 'player-2'])
    for (const c of game.cells) c.controlOwnerId = null
    game.cells.find((c) => c.coord.q === 0)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 1)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 2)!.controlOwnerId = 'player-2'
    expect(checkVictory(gameStateFromSnapshot(game, map.id))).toBeNull()

    game.cells.find((c) => c.coord.q === 3)!.controlOwnerId = 'player-1'
    const won = checkVictory(gameStateFromSnapshot(game, map.id))
    expect(won?.winnerId).toBe('player-1')
    expect(won?.reason).toBe('power_centers')
  })
})
