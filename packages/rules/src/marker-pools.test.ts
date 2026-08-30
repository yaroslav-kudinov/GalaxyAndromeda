import { describe, expect, it } from 'vitest'
import {
  actionMarkerLimitForPlayer,
  nextProductionMarkerExpandCost,
  refreshActionMarkerCapacity,
} from './marker-pools.js'
import {
  executeBuyProductionMarker,
  executeProductionBatch,
} from './production.js'
import { addActionMarker } from './markers.js'
import { beginMatchForParticipants } from './match-start.js'
import { getLegalActionsForSnapshot } from './movement.js'
import { gameSnapshotFromMap } from './save-file.js'
import type { MapDefinition } from './types.js'

function productionMap(): MapDefinition {
  return {
    id: 'pool-prod',
    name: 'Pool prod',
    cells: [
      {
        q: 0,
        r: 0,
        startPlayer: 1,
        resourceToken: { type: 'credits', value: 8, faceUp: true },
      },
      {
        q: 1,
        r: 0,
        startPlayer: 1,
        resourceToken: { type: 'credits', value: 8, faceUp: true },
      },
      {
        q: 0,
        r: 1,
        startPlayer: 1,
        resourceToken: { type: 'production', value: 8, faceUp: true },
      },
      {
        q: 1,
        r: 1,
        startPlayer: 1,
        resourceToken: { type: 'production', value: 8, faceUp: true },
      },
    ],
  }
}

function powerCenterMap(): MapDefinition {
  return {
    id: 'pc-am',
    name: 'PC AM',
    cells: [
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 2, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 0, r: 1, startPlayer: 1 },
      { q: 1, r: 1, startPlayer: 1 },
    ],
  }
}

function onePowerCenterMap(): MapDefinition {
  return {
    id: 'pc-am-one',
    name: 'PC AM one',
    cells: [
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
      { q: 2, r: 0, startPlayer: 1 },
      { q: 0, r: 1, startPlayer: 1 },
      { q: 1, r: 1, startPlayer: 1 },
    ],
  }
}

function addShip(
  game: ReturnType<typeof gameSnapshotFromMap>,
  q: number,
  r: number,
  ownerId: string,
) {
  game.cells.find((cell) => cell.coord.q === q && cell.coord.r === r)!.ships.push({
    id: `s-${ownerId}-${q}-${r}`,
    type: 'destroyer',
    ownerId,
  })
}

describe('marker pools', () => {
  it('start with 1 power center gives 4 action markers', () => {
    const map = onePowerCenterMap()
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'])
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(4)
    expect(game.actionMarkerLimitByPlayer?.['player-1']).toBe(4)
  })

  it('2 power centers at turn start give 5 action markers', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(5)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(4)
    expect(game.actionMarkerLimitByPlayer?.['player-1']).toBe(5)
  })

  it('losing a power center mid-turn keeps the frozen limit', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1')
    addShip(game, 1, 0, 'player-1')
    addShip(game, 0, 1, 'player-1')
    addShip(game, 1, 1, 'player-1')
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 1, r: 0 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 0, r: 1 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(3)

    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-2'
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(5)
    expect(game.actionMarkers).toHaveLength(3)
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(4)

    getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(5)
    expect(game.actionMarkers).toHaveLength(4)
  })

  it('strips extras at the next turn start after losing a center', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    game.actionMarkerLimitByPlayer = { 'player-1': 5 }
    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-2'
    refreshActionMarkerCapacity(game)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
  })

  it('occupying a power center in planning does not grant a slot until next turn', () => {
    const map = onePowerCenterMap()
    const game = gameSnapshotFromMap(map)
    game.actionMarkerLimitByPlayer = { 'player-1': 4 }
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1')
    addShip(game, 2, 0, 'player-1')
    addShip(game, 0, 1, 'player-1')
    addShip(game, 1, 1, 'player-1')
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 0, r: 1 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 2, r: 0 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(4)

    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-1'
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)

    refreshActionMarkerCapacity(game)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(5)
    addShip(game, 1, 0, 'player-1')
    expect(addActionMarker(game, 'player-1', { q: 1, r: 0 })).toEqual([])
  })

  it('cannot buy action markers via production batch', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    const home = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    home.ships.push({ id: 'dd', type: 'destroyer', ownerId: 'player-1' })
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    game.phase = 'actions'
    const marker = game.actionMarkers[0]!
    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: marker.id,
      ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
      buyActionMarkers: 1,
    })
    expect(errors.some((e) => e.includes('Покупка маркеров действия отключена'))).toBe(true)
  })

  it('production marker expand costs remain defined for legacy saves', () => {
    expect(nextProductionMarkerExpandCost(1)).toEqual({ credits: 8, production: 6 })
    expect(nextProductionMarkerExpandCost(2)).toEqual({ credits: 12, production: 9 })
    expect(nextProductionMarkerExpandCost(3)).toBeNull()
  })

  it('executeBuyProductionMarker is disabled', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    const credit = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const prod = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    const errors = executeBuyProductionMarker(game, map.id, 'player-1', [
      { coord: credit.coord, tokenIndex: 0 },
      { coord: prod.coord, tokenIndex: 0 },
    ])
    expect(errors).toEqual(['Маркеры производства отключены'])
  })
})
