import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import {
  applyVictoryAndDefeatChecks,
  checkDefeat,
  checkVictory,
  provisionalWinnerForSnapshot,
  resolveTurnLimitWinner,
  victoryThresholdForState,
} from './victory.js'
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

  it('victory threshold comes from the map, not from half the power centers', () => {
    const map = createEmptyMap('pc-threshold', 'Threshold')
    map.cells = []
    // Девять центров: запасное правило потребовало бы пять, карта просит три.
    for (let i = 0; i < 9; i += 1) map.cells.push({ q: i, r: 0, isPowerCenter: true })
    map.cells.push({ q: 0, r: 1, startPlayer: 1 }, { q: 1, r: 1, startPlayer: 2 })
    map.victoryPowerCenters = 3

    const game = gameSnapshotFromMap(map)
    for (const cell of game.cells) cell.controlOwnerId = null
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 1)!.controlOwnerId = 'player-2'

    expect(victoryThresholdForState(gameStateFromSnapshot(game, map.id))).toBe(3)

    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-1'
    expect(checkVictory(gameStateFromSnapshot(game, map.id))).toBeNull()

    game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!.controlOwnerId = 'player-1'
    const won = checkVictory(gameStateFromSnapshot(game, map.id))
    expect(won?.winnerId).toBe('player-1')
    expect(won?.reason).toBe('power_centers')
  })

  it('falls back to more than half when the map sets no threshold', () => {
    const map = createEmptyMap('pc-fallback', 'Fallback')
    map.cells = []
    for (let i = 0; i < 5; i += 1) map.cells.push({ q: i, r: 0, isPowerCenter: true })
    map.cells.push({ q: 0, r: 1, startPlayer: 1 }, { q: 1, r: 1, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    expect(victoryThresholdForState(gameStateFromSnapshot(game, map.id))).toBe(3)
  })

  it('turn limit resolves through the whole chain and always names a winner', () => {
    const map = createEmptyMap('turn-limit', 'Turn limit')
    map.cells = []
    map.cells.push(
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 2, r: 0, startPlayer: 1, resourceToken: { type: 'credits', value: 5, faceUp: true } },
      { q: 3, r: 0, startPlayer: 2 },
      { q: 4, r: 0, startPlayer: 2 },
    )
    const game = gameSnapshotFromMap(map)

    // Центры власти поровну, клеток больше у player-2 → ведёт он, по второму пункту.
    const byCells = resolveTurnLimitWinner(gameStateFromSnapshot(game, map.id), 1)
    expect(byCells).toEqual({ winnerId: 'player-2', rung: 'cells' })

    // Уравняли клетки (по две у каждого): решает номинал фишек лицом вверх.
    game.cells.find((c) => c.coord.q === 4)!.controlOwnerId = null
    const byValue = resolveTurnLimitWinner(gameStateFromSnapshot(game, map.id), 1)
    expect(byValue).toEqual({ winnerId: 'player-1', rung: 'face_up_value' })

    // Первый пункт важнее остальных.
    game.cells.find((c) => c.coord.q === 1)!.controlOwnerId = 'player-1'
    const byPowerCenters = resolveTurnLimitWinner(gameStateFromSnapshot(game, map.id), 1)
    expect(byPowerCenters).toEqual({ winnerId: 'player-1', rung: 'power_centers' })
  })

  it('turn limit falls back to a lot, and the lot follows the match seed', () => {
    const map = createEmptyMap('turn-limit-lot', 'Lot')
    map.cells = []
    map.cells.push(
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
    )
    const game = gameSnapshotFromMap(map)
    const state = gameStateFromSnapshot(game, map.id)

    // Всё поровну — цепочка обязана всё равно назвать победителя.
    const winners = new Set<string>()
    for (let seed = 0; seed < 40; seed += 1) {
      const outcome = resolveTurnLimitWinner(state, seed)
      expect(outcome?.rung).toBe('lot')
      winners.add(outcome!.winnerId)
    }
    // Жребий зависит от сида, а не от номера игрока: за сорок сидов выпадают оба.
    expect(winners.size).toBe(2)
    // И он детерминирован: тот же сид даёт тот же исход.
    expect(resolveTurnLimitWinner(state, 7)).toEqual(resolveTurnLimitWinner(state, 7))
  })

  it('applyVictoryAndDefeatChecks ends the game when the turn limit passes', () => {
    const map = createEmptyMap('turn-limit-apply', 'Apply')
    map.cells = []
    map.cells.push(
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 2, r: 0, startPlayer: 1 },
    )
    const game = gameSnapshotFromMap(map)
    game.turnLimit = 15
    game.matchSeed = 1

    game.turnNumber = 15
    applyVictoryAndDefeatChecks(game, map.id)
    expect(game.gameOver).toBeUndefined()

    game.turnNumber = 16
    applyVictoryAndDefeatChecks(game, map.id)
    expect(game.gameOver?.reason).toBe('turn_limit')
    expect(game.gameOver?.winnerId).toBe('player-1')
  })

  it('provisional winner reports the rung it currently leads by', () => {
    const map = createEmptyMap('provisional', 'Provisional')
    map.cells = []
    map.cells.push(
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 2, r: 0, startPlayer: 1 },
    )
    const game = gameSnapshotFromMap(map)
    expect(provisionalWinnerForSnapshot(game, map.id)).toEqual({
      winnerId: 'player-1',
      rung: 'cells',
    })

    game.gameOver = { winnerId: 'player-2', reason: 'power_centers' }
    expect(provisionalWinnerForSnapshot(game, map.id)).toBeNull()
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
