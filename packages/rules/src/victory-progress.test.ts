import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { ensurePlayerSlots, gameSnapshotFromMap } from './save-file.js'
import { victoryProgressForSnapshot, victoryThresholdFor } from './victory-progress.js'

/** Карта с заданным числом центров власти и стартовой клеткой на каждого игрока. */
function powerCenterMap(powerCenters: number) {
  const map = createEmptyMap('victory-progress-test', 'Прогресс победы')
  for (let i = 0; i < powerCenters; i++) {
    map.cells.push({ q: i, r: 0, isPowerCenter: true })
  }
  map.cells.push({ q: 0, r: 1, startPlayer: 1 })
  map.cells.push({ q: 1, r: 1, startPlayer: 2 })
  map.cells.push({ q: 2, r: 1, startPlayer: 3 })
  return map
}

function controlPowerCenters(game: ReturnType<typeof gameSnapshotFromMap>, owners: string[]) {
  const centers = game.cells.filter((c) => c.isPowerCenter)
  owners.forEach((ownerId, index) => {
    centers[index]!.controlOwnerId = ownerId
  })
}

describe('victory progress', () => {
  it('порог победы — строго больше половины центров власти карты', () => {
    expect(victoryThresholdFor(powerCenterMap(0))).toBe(0)
    expect(victoryThresholdFor(powerCenterMap(1))).toBe(1)
    expect(victoryThresholdFor(powerCenterMap(4))).toBe(3)
    expect(victoryThresholdFor(powerCenterMap(5))).toBe(3)
    expect(victoryThresholdFor(powerCenterMap(7))).toBe(4)
  })

  it('порог из карты главнее запасного правила — и в описании карты, и в партии', () => {
    const map = powerCenterMap(9)
    map.victoryPowerCenters = 6
    expect(victoryThresholdFor(map)).toBe(6)

    const game = gameSnapshotFromMap(map)
    ensurePlayerSlots(game, 2)
    game.participatingPlayerIds = ['player-1', 'player-2']
    controlPowerCenters(game, ['player-1', 'player-1'])
    const progress = victoryProgressForSnapshot(game, map)
    expect(progress.needed).toBe(6)
    expect(progress.entries.find((e) => e.playerId === 'player-1')?.remaining).toBe(4)
  })

  it('считает захваченные центры власти и остаток до порога', () => {
    const map = powerCenterMap(5)
    const game = gameSnapshotFromMap(map)
    ensurePlayerSlots(game, 3)
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    controlPowerCenters(game, ['player-1', 'player-1', 'player-2'])

    const progress = victoryProgressForSnapshot(game, map)
    expect(progress.total).toBe(5)
    expect(progress.needed).toBe(3)
    expect(progress.entries.map((e) => [e.playerId, e.controlled, e.remaining])).toEqual([
      ['player-1', 2, 1],
      ['player-2', 1, 2],
      ['player-3', 0, 3],
    ])
    expect(progress.entries.every((e) => !e.reached)).toBe(true)
  })

  it('набранный порог виден отдельным признаком', () => {
    const map = powerCenterMap(5)
    const game = gameSnapshotFromMap(map)
    ensurePlayerSlots(game, 3)
    controlPowerCenters(game, ['player-1', 'player-1', 'player-1'])

    const progress = victoryProgressForSnapshot(game, map)
    expect(progress.entries[0]).toMatchObject({
      playerId: 'player-1',
      controlled: 3,
      remaining: 0,
      reached: true,
    })
  })

  it('выбывшие уходят в конец списка, чужие слоты карты не показываются', () => {
    const map = powerCenterMap(4)
    const game = gameSnapshotFromMap(map)
    ensurePlayerSlots(game, 3)
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.players.find((p) => p.id === 'player-1')!.eliminated = true
    controlPowerCenters(game, ['player-2'])

    const progress = victoryProgressForSnapshot(game, map)
    expect(progress.entries.map((e) => e.playerId)).toEqual(['player-2', 'player-1'])
    expect(progress.entries[1]).toMatchObject({ playerId: 'player-1', eliminated: true })
  })

  it('на карте без центров власти прогресс пустой', () => {
    const map = createEmptyMap('no-power-centers', 'Без центров')
    map.cells.push({ q: 0, r: 0, startPlayer: 1 })
    map.cells.push({ q: 1, r: 0, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)

    expect(victoryProgressForSnapshot(game, map)).toMatchObject({
      total: 0,
      needed: 0,
      entries: [],
    })
  })
})
