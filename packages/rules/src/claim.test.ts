import { describe, expect, it } from 'vitest'
import {
  applyProductionHexClaims,
  maybeApplyProductionHexClaims,
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
  it('destroyers do not claim neutral hexes', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'destroyer', 'dd-n')
    applyProductionHexClaims(game)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBeNull()
  })

  it('cruiser claims a neutral hex', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-n')
    applyProductionHexClaims(game)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBe(
      'player-1',
    )
  })

  it('destroyers raid enemy control without enemy ships and remove production marker', () => {
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
    addShip(game, 0, 1, 'player-1', 'destroyer', 'dd-raid')
    applyProductionHexClaims(game)
    expect(dest.controlOwnerId).toBe('player-1')
    expect(dest.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('does not claim a hex with enemy ships', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    const dest = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'dd-2')
    applyProductionHexClaims(game)
    expect(dest.controlOwnerId).toBeNull()
  })

  it('runs once when entering production from actions', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-1', 'cruiser', 'cr-n')
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1']
    game.actionMarkers = []
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('production')
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId).toBe(
      'player-1',
    )
  })

  it('does not claim again while wrapping production', () => {
    const map = claimMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    maybeApplyProductionHexClaims(game, 'production')
    expect(game.eventLog.some((e) => e.type === 'claim')).toBe(false)
  })
})
