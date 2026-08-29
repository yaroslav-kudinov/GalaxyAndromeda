import { describe, expect, it } from 'vitest'
import {
  actionMarkerLimitForPlayer,
  nextProductionMarkerExpandCost,
  refreshActionMarkerCapacity,
} from './marker-pools.js'
import {
  executeBuyProductionMarker,
  executeProductionBatch,
  validateBuyProductionMarker,
} from './production.js'
import { addActionMarker, addProductionMarker, PRODUCTION_MARKER_ALREADY_BOUGHT_MSG } from './markers.js'
import { resetTurnEventTracking } from './events.js'
import { beginMatchForParticipants } from './match-start.js'
import { getLegalActionsForSnapshot } from './movement.js'
import { gameSnapshotFromMap } from './save-file.js'
import { advanceGameSnapshot, activePlayerOrder } from './turn.js'
import { gameStateFromSnapshot } from './save-file.js'
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
  it('start with 1 power center gives 3 action markers', () => {
    const map = onePowerCenterMap()
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'])
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(3)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(3)
    expect(game.actionMarkerLimitByPlayer?.['player-1']).toBe(3)
  })

  it('2 power centers at turn start give 4 action markers', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(3)
    expect(game.actionMarkerLimitByPlayer?.['player-1']).toBe(4)
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
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    expect(game.actionMarkers).toHaveLength(3)
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(4)

    getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    expect(game.actionMarkers).toHaveLength(4)
  })

  it('strips extras at the next turn start after losing a center', () => {
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
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([])

    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-2'
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    expect(game.actionMarkers).toHaveLength(4)

    game.phase = 'production'
    game.productionMarkers = []
    const prodOrder = activePlayerOrder(game.players, null, {
      state: gameStateFromSnapshot(game, map.id),
      phase: 'production',
    })
    game.activePlayerId = prodOrder[prodOrder.length - 1]!
    game.eventDeck = ['empty-void']
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(3)
    expect(game.actionMarkers).toHaveLength(3)
    expect(game.actionMarkers.map((marker) => marker.coord)).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ])
    expect(game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 1)!.actionMarkerId).toBeNull()
  })

  it('occupying a power center in planning does not grant a slot until next turn', () => {
    const map = onePowerCenterMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1')
    addShip(game, 2, 0, 'player-1')
    addShip(game, 0, 1, 'player-1')
    addShip(game, 1, 1, 'player-1')
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(3)
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 2, r: 0 })).toEqual([])
    expect(addActionMarker(game, 'player-1', { q: 0, r: 1 })).toEqual([])

    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-1'
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(3)
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })[0]).toMatch(/Не более 3/)

    refreshActionMarkerCapacity(game)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(4)
    game.activePlayerId = 'player-1'
    game.phase = 'planning'
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([])
  })

  it('cannot buy action markers in production', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    game.phase = 'production'
    const marker = game.productionMarkers[0]!
    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: marker.id,
      ships: [],
      buyActionMarkers: 1,
    })
    expect(errors.some((e) => e.includes('Покупка маркеров действия отключена'))).toBe(true)
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(2)
  })

  it('production marker prices are 8+6 then 12+9', () => {
    expect(nextProductionMarkerExpandCost(1)).toEqual({ credits: 8, production: 6 })
    expect(nextProductionMarkerExpandCost(2)).toEqual({ credits: 12, production: 9 })
    expect(nextProductionMarkerExpandCost(3)).toBeNull()
  })

  it('buying a production marker removes selected tokens from the map', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    const credit = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const prod = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    const errors = executeBuyProductionMarker(game, map.id, 'player-1', [
      { coord: credit.coord, tokenIndex: 0 },
      { coord: prod.coord, tokenIndex: 0 },
    ])
    expect(errors).toEqual([])
    expect(credit.resourceTokens).toHaveLength(0)
    expect(prod.resourceTokens).toHaveLength(0)
    expect(game.productionMarkerLimitByPlayer?.['player-1']).toBe(2)
    expect(game.productionMarkerBoughtByPlayerThisTurn?.['player-1']).toBe(true)
    expect(game.productionMarkerResolvedThisTurn).toBeFalsy()
  })

  it('rejects a second production-marker purchase in the same game turn', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    const credit = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const prod = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    expect(
      executeBuyProductionMarker(game, map.id, 'player-1', [
        { coord: credit.coord, tokenIndex: 0 },
        { coord: prod.coord, tokenIndex: 0 },
      ]),
    ).toEqual([])

    const leftoverCredit = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    leftoverCredit.resourceTokens.push({ type: 'credits', value: 9, faceUp: true })
    leftoverCredit.resourceTokens.push({ type: 'credits', value: 9, faceUp: true })
    const leftoverProd = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 1)!
    leftoverProd.resourceTokens.push({ type: 'production', value: 9, faceUp: true })

    expect(
      validateBuyProductionMarker(game, 'player-1', [
        { coord: leftoverCredit.coord, tokenIndex: leftoverCredit.resourceTokens.length - 2 },
        { coord: leftoverCredit.coord, tokenIndex: leftoverCredit.resourceTokens.length - 1 },
        { coord: leftoverProd.coord, tokenIndex: leftoverProd.resourceTokens.length - 1 },
      ]),
    ).toEqual([PRODUCTION_MARKER_ALREADY_BOUGHT_MSG])
  })

  it('allows another production-marker purchase on the next game turn', () => {
    const map = productionMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    const credit = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const prod = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    expect(
      executeBuyProductionMarker(game, map.id, 'player-1', [
        { coord: credit.coord, tokenIndex: 0 },
        { coord: prod.coord, tokenIndex: 0 },
      ]),
    ).toEqual([])

    resetTurnEventTracking(game)
    const leftoverCredit = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    leftoverCredit.resourceTokens = [
      { type: 'credits', value: 9, faceUp: true },
      { type: 'credits', value: 9, faceUp: true },
    ]
    const leftoverProd = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 1)!
    leftoverProd.resourceTokens = [{ type: 'production', value: 9, faceUp: true }]

    expect(
      executeBuyProductionMarker(game, map.id, 'player-1', [
        { coord: leftoverCredit.coord, tokenIndex: 0 },
        { coord: leftoverCredit.coord, tokenIndex: 1 },
        { coord: leftoverProd.coord, tokenIndex: 0 },
      ]),
    ).toEqual([])
    expect(game.productionMarkerLimitByPlayer?.['player-1']).toBe(3)
  })
})
