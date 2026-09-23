import { describe, expect, it } from 'vitest'
import {
  applyTurnEndClaims,
  autoResolveClaimPicks,
  claimPicksRemaining,
  computeClaimLimit,
  executeClaimPicks,
  maybeApplyTurnEndClaims,
  transferControlIfEnemyOwned,
} from './claim.js'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import { advanceGameSnapshot } from './turn.js'
import type { ShipType } from './types.js'

function claimMap() {
  const map = createEmptyMap('claim-test', 'Claim')
  map.cells = [
    { q: 0, r: 0, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
    { q: 1, r: 0 },
    { q: 0, r: 1, startPlayer: 2 },
    { q: -1, r: 1 },
  ]
  return map
}

function addShip(
  game: ReturnType<typeof gameSnapshotFromMap>,
  q: number,
  r: number,
  ownerId: string,
  type: ShipType,
  id: string,
) {
  game.cells.find((c) => c.coord.q === q && c.coord.r === r)!.ships.push({
    id,
    type,
    ownerId,
  })
}

describe('transferControlIfEnemyOwned', () => {
  it('captures an empty enemy-controlled hex and removes the production marker', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    const dest = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    dest.controlOwnerId = 'player-2'
    dest.productionMarkerId = 'pm-2'
    game.productionMarkers.push({
      id: 'pm-2',
      ownerId: 'player-2',
      coord: { q: 0, r: 1 },
      targetRegionId: 'r2',
    })
    addShip(game, 0, 1, 'player-1', 'destroyer', 'dd-enter')
    expect(transferControlIfEnemyOwned(game, dest, 'player-1')).toBe(true)
    expect(dest.controlOwnerId).toBe('player-1')
    expect(dest.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('does not paint a neutral hex', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    const dest = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-n')
    expect(transferControlIfEnemyOwned(game, dest, 'player-1')).toBe(false)
    expect(dest.controlOwnerId).toBeNull()
  })

  it('does not capture while enemy ships remain', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    const dest = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    dest.controlOwnerId = 'player-2'
    addShip(game, 0, 1, 'player-1', 'destroyer', 'dd-1')
    addShip(game, 0, 1, 'player-2', 'destroyer', 'dd-2')
    expect(transferControlIfEnemyOwned(game, dest, 'player-1')).toBe(false)
    expect(dest.controlOwnerId).toBe('player-2')
  })
})

describe('production hex claims', () => {
  it('a destroyer claims a neutral hex like any other class', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'destroyer', 'dd-n')
    applyTurnEndClaims(game, map.id)
    // Деления на колонизаторов и прочих больше нет: тормозом служит лимит захвата.
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBe(
      'player-1',
    )
  })

  it('cruiser claims a neutral hex', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-n')
    applyTurnEndClaims(game, map.id)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBe(
      'player-1',
    )
  })

  it('does not claim a hex with enemy ships', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    const dest = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'dd-2')
    applyTurnEndClaims(game, map.id)
    expect(dest.controlOwnerId).toBeNull()
  })

  it('runs once when ending the turn after actions', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-n')
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1']
    game.actionMarkers = []
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.turnNumber).toBeGreaterThanOrEqual(1)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBe(
      'player-1',
    )
  })

  it('claim limit caps how much a player takes in one turn', () => {
    const map = createEmptyMap('claim-limit', 'Claim limit')
    map.cells = [
      { q: 0, r: 0, startPlayer: 1, isPowerCenter: true },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ]
    const game = gameSnapshotFromMap(map)
    for (const q of [1, 2, 3, 4]) addShip(game, q, 0, 'player-1', 'destroyer', `dd-${q}`)

    // Один центр власти → лимит два, а подходящих клеток четыре.
    expect(computeClaimLimit(game, 'player-1')).toBe(2)
    applyTurnEndClaims(game, map.id)
    expect(claimPicksRemaining(game, 'player-1')).toBe(2)
    expect(game.cells.filter((c) => c.controlOwnerId === 'player-1')).toHaveLength(1)
  })

  it('player picks which cells to take, within the limit', () => {
    const map = createEmptyMap('claim-pick', 'Claim pick')
    map.cells = [
      { q: 0, r: 0, startPlayer: 1, isPowerCenter: true },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ]
    const game = gameSnapshotFromMap(map)
    for (const q of [1, 2, 3]) addShip(game, q, 0, 'player-1', 'destroyer', `dd-${q}`)
    applyTurnEndClaims(game, map.id)
    expect(claimPicksRemaining(game, 'player-1')).toBe(2)

    expect(executeClaimPicks(game, map.id, 'player-1', [{ q: 3, r: 0 }])).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 3)!.controlOwnerId).toBe('player-1')
    expect(claimPicksRemaining(game, 'player-1')).toBe(1)
  })

  it('auto-resolve prefers power centers, then valuable tokens', () => {
    const map = createEmptyMap('claim-auto', 'Claim auto')
    map.cells = [
      { q: 0, r: 0, startPlayer: 1, isPowerCenter: true },
      { q: 1, r: 0, resourceToken: { type: 'credits', value: 2, faceUp: true } },
      { q: 2, r: 0, resourceToken: { type: 'credits', value: 9, faceUp: true } },
      { q: 3, r: 0, isPowerCenter: true },
    ]
    const game = gameSnapshotFromMap(map)
    for (const q of [1, 2, 3]) addShip(game, q, 0, 'player-1', 'destroyer', `dd-${q}`)
    applyTurnEndClaims(game, map.id)

    expect(autoResolveClaimPicks(game, map.id, 'player-1')).toBe(2)
    // Центр власти первым, затем дорогая фишка; дешёвая остаётся нейтральной.
    expect(game.cells.find((c) => c.coord.q === 3)!.controlOwnerId).toBe('player-1')
    expect(game.cells.find((c) => c.coord.q === 2)!.controlOwnerId).toBe('player-1')
    expect(game.cells.find((c) => c.coord.q === 1)!.controlOwnerId).toBeNull()
  })

  it('does not claim again while wrapping actions', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'events'
    maybeApplyTurnEndClaims(game, 'actions', map.id)
    expect(game.eventLog.some((e) => e.type === 'claim')).toBe(false)
  })
})
