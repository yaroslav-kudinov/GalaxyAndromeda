import { describe, expect, it } from 'vitest'
import {
  ACTION_MARKER_LIMIT,
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
  it('action marker limit is the same for everyone regardless of power centers', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    // player-1 держит два центра власти, player-2 — один: прежняя формула дала бы 5 и 4.
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(ACTION_MARKER_LIMIT)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(ACTION_MARKER_LIMIT)
  })

  it('keeps the limit after a power center changes hands', () => {
    const map = powerCenterMap()
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'])

    game.cells.find((cell) => cell.coord.q === 1 && cell.coord.r === 0)!.controlOwnerId = 'player-2'
    refreshActionMarkerCapacity(game)

    // Сторож против возврата зависимости от центров власти: она делала центр двойной
    // наградой и ломала размен «одно на одно» с бюджетом перезарядки.
    expect(actionMarkerLimitForPlayer(game, 'player-1')).toBe(ACTION_MARKER_LIMIT)
    expect(actionMarkerLimitForPlayer(game, 'player-2')).toBe(ACTION_MARKER_LIMIT)
  })

  it('refuses to place more markers than the limit', () => {
    // Своя карта: клеток должно хватить на лимит плюс одну лишнюю попытку.
    const spots = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 2, r: 1 },
    ]
    const map: MapDefinition = {
      id: 'pc-am-wide',
      name: 'PC AM wide',
      cells: [
        ...spots.map((spot, index) => ({ ...spot, startPlayer: 1, isPowerCenter: index === 0 })),
        { q: 4, r: 0, startPlayer: 2, isPowerCenter: true },
      ],
    }
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    for (const spot of spots) addShip(game, spot.q, spot.r, 'player-1')

    for (let i = 0; i < ACTION_MARKER_LIMIT; i += 1) {
      expect(addActionMarker(game, 'player-1', spots[i]!)).toEqual([])
    }
    expect(game.actionMarkers).toHaveLength(ACTION_MARKER_LIMIT)
    expect(addActionMarker(game, 'player-1', spots[ACTION_MARKER_LIMIT]!)).not.toEqual([])
    expect(game.actionMarkers).toHaveLength(ACTION_MARKER_LIMIT)
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
