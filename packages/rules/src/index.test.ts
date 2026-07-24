import { describe, expect, it } from 'vitest'
import type { GameSnapshot, ShipType } from './types.js'

function addTestShip(
  game: GameSnapshot,
  q: number,
  r: number,
  ownerId: string,
  type: ShipType = 'destroyer',
) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error(`cell ${q},${r} missing`)
  cell.ships.push({ id: `test-${ownerId}-${q}-${r}`, type, ownerId })
}
import {
  hexDistance,
  validateMapDefinition,
  getGhostSlots,
  createEmptyMap,
  canAddShipToCell,
  MAX_SHIPS_PER_CELL,
  MAX_SHIPS_PER_CELL_PER_PLAYER,
  applyCellContent,
  extractCellContent,
  getSymmetryOrbit,
  reflectHex,
  remapPlayerSlot,
  rotateHex,
  addCellOrbit,
  removeCellOrbit,
  syncCellOrbitContent,
  normalizeMapDefinition,
} from './map.js'
import {
  MAX_ACTION_MARKERS_PER_PLAYER,
  galaxySaveFromMap,
  gameSnapshotFromGameState,
  gameSnapshotFromMap,
  gameStateFromSnapshot,
  isMapOnlySave,
  parseGalaxySave,
  resolveRegionIdForCell,
  serializeGalaxySave,
  validateGalaxySave,
} from './save-file.js'
import { addActionMarker, addProductionMarker, removeActionMarker, toggleMarkerAtCell, togglePhaseMarkerAtCell, ACTION_MARKER_ALREADY_RESOLVED_MSG, ACTION_MARKER_REMOVE_BLOCKED_MSG, PRODUCTION_MARKER_ALREADY_RESOLVED_MSG } from './markers.js'
import { applyGameAction, buildObservation, gameStateFromMap, getLegalActions } from './game.js'
import {
  applyGameActionOnSnapshot,
  executeMarkerMovement,
  getLegalActionsForSnapshot,
  getMovableShipsAtMarker,
  getReachableHexKeys,
  validateMarkerMovement,
} from './movement.js'
import {
  autoAllocateTokens,
  executeProductionBatch,
  executeProductionBuild,
  executeProductionRecharge,
  getBuildableShipsForMarker,
  getRegionResourceSummary,
  getRegionTokensForMarker,
  needsProductionTokenChoice,
  validateProductionBatch,
  validateProductionBuild,
  validateProductionRecharge,
} from './production.js'
import { getShipMoveRange, getShipProductionCost, canBuildShipInRegionSize, getShipProductionRegionMin } from './ships.js'
import { trimGameEventLog } from './event-log.js'
import { advanceGamePhase, advanceGameSnapshot } from './turn.js'
import { renderAsciiMapFromDefinition } from './observation/index.js'

describe('hex map', () => {
  it('computes distance between neighbors as 1', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
  })

  it('validates map definition', () => {
    const map = createEmptyMap()
    expect(validateMapDefinition(map)).toEqual([])
  })

  it('finds ghost slots around single hex', () => {
    const ghosts = getGhostSlots(createEmptyMap())
    expect(ghosts).toHaveLength(6)
  })

  it('rejects more than 4 ships per player in a cell', () => {
    const map = createEmptyMap()
    map.cells[0].startingShips = [
      { type: 'destroyer', player: 1 },
      { type: 'destroyer', player: 1 },
      { type: 'destroyer', player: 1 },
      { type: 'destroyer', player: 1 },
      { type: 'destroyer', player: 1 },
    ]
    expect(validateMapDefinition(map).some((e) => e.includes('игрок 1'))).toBe(true)
  })

  it('allows up to 8 ships when two players share a cell', () => {
    const map = createEmptyMap()
    map.cells[0].startingShips = [
      ...Array.from({ length: 4 }, () => ({ type: 'destroyer' as const, player: 1 })),
      ...Array.from({ length: 4 }, () => ({ type: 'cruiser' as const, player: 2 })),
    ]
    expect(validateMapDefinition(map)).toEqual([])
    expect(map.cells[0].startingShips).toHaveLength(MAX_SHIPS_PER_CELL)
  })

  it('canAddShipToCell respects per-player and total limits', () => {
    const cell = { q: 0, r: 0, startingShips: [{ type: 'supply' as const, player: 1 }] }
    expect(canAddShipToCell(cell, 1)).toBe(true)
    cell.startingShips = Array(MAX_SHIPS_PER_CELL_PER_PLAYER)
      .fill(null)
      .map(() => ({ type: 'supply' as const, player: 1 }))
    expect(canAddShipToCell(cell, 1)).toBe(false)
    expect(canAddShipToCell(cell, 2)).toBe(true)
  })

  it('copies and pastes cell content without coordinates', () => {
    const source = {
      q: 0,
      r: 0,
      isPowerCenter: true,
      startPlayer: 2,
      resourceToken: { type: 'credits' as const, value: 5 as const, faceUp: true },
      startingShips: [{ type: 'destroyer' as const, player: 2 }],
    }
    const target = {
      q: 3,
      r: -1,
      startPlayer: 1,
      resourceToken: { type: 'production' as const, value: 1 as const },
      startingShips: [{ type: 'supply' as const, player: 1 }],
    }
    const content = extractCellContent(source)
    applyCellContent(target, content)
    expect(target.q).toBe(3)
    expect(target.r).toBe(-1)
    expect(target.isPowerCenter).toBe(true)
    expect(target.startPlayer).toBe(2)
    expect(target.resourceToken).toEqual(source.resourceToken)
    expect(target.startingShips).toEqual(source.startingShips)
  })

  it('paste clears target fields when source cell is empty', () => {
    const source = { q: 0, r: 0 }
    const target = {
      q: 1,
      r: 0,
      isPowerCenter: true,
      startPlayer: 3,
      resourceToken: { type: 'credits' as const, value: 9 as const },
      startingShips: [{ type: 'hyper' as const, player: 3 }],
    }
    applyCellContent(target, extractCellContent(source))
    expect(target.isPowerCenter).toBeUndefined()
    expect(target.startPlayer).toBeNull()
    expect(target.resourceToken).toBeUndefined()
    expect(target.startingShips).toBeUndefined()
  })

  it('renders ascii map snapshot', () => {
    const ascii = renderAsciiMapFromDefinition(createEmptyMap())
    expect(ascii).toContain('(0,0)')
    expect(ascii).toContain('Legend')
  })

  it('validates bundled tts-reference map', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = path.resolve(import.meta.dirname, '../../../maps/tts-reference.json')
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(map.cells.length).toBeGreaterThan(35)
    expect(validateMapDefinition(map)).toEqual([])
  })
})

describe('hex symmetry', () => {
  it('rotateHex preserves distance from origin', () => {
    const c = { q: 2, r: -1 }
    expect(hexDistance({ q: 0, r: 0 }, rotateHex(c, 3))).toBe(hexDistance({ q: 0, r: 0 }, c))
  })

  it('reflectHex is an involution', () => {
    const c = { q: 3, r: -1 }
    expect(reflectHex(reflectHex(c, 0), 0)).toEqual(c)
  })

  it('2-player orbit has size 2 off axis', () => {
    const orbit = getSymmetryOrbit({ q: 1, r: 0 }, { playerCount: 2, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(2)
  })

  it('3-player orbit has three distinct hexes', () => {
    const orbit = getSymmetryOrbit({ q: 1, r: 0 }, { playerCount: 3, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(3)
  })

  it('6-player orbit has six distinct hexes', () => {
    const orbit = getSymmetryOrbit({ q: 1, r: 0 }, { playerCount: 6, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(6)
  })

  it('remapPlayerSlot swaps 1 and 2 for mirrored copy', () => {
    expect(remapPlayerSlot(1, 1, 2)).toBe(2)
    expect(remapPlayerSlot(2, 1, 2)).toBe(1)
  })

  it('addCellOrbit adds symmetric cells', () => {
    const map = createEmptyMap()
    addCellOrbit(map, { q: 1, r: 0 }, { enabled: true, playerCount: 2, axisKind: 'line', axisIndex: 0 })
    expect(map.cells.length).toBe(3)
  })

  it('syncCellOrbitContent mirrors player slots for 2 players', () => {
    const map = createEmptyMap()
    addCellOrbit(map, { q: 1, r: 0 }, { enabled: true, playerCount: 2, axisKind: 'line', axisIndex: 0 })
    const source = map.cells.find((c) => c.q === 1 && c.r === 0)!
    source.startPlayer = 1
    syncCellOrbitContent(map, { q: 1, r: 0 }, {
      enabled: true,
      playerCount: 2,
      axisKind: 'line',
      axisIndex: 0,
    })
    const mirrored = map.cells.find((c) => c.q === 0 && c.r === 1)!
    expect(source.startPlayer).toBe(1)
    expect(mirrored.startPlayer).toBe(2)
  })

  it('removeCellOrbit removes all symmetric copies', () => {
    const map = createEmptyMap()
    const settings = { enabled: true, playerCount: 2, axisKind: 'line' as const, axisIndex: 0 }
    addCellOrbit(map, { q: 1, r: 0 }, settings)
    removeCellOrbit(map, { q: 1, r: 0 }, settings)
    expect(map.cells).toHaveLength(1)
  })
})

describe('galaxy save file', () => {
  it('roundtrips map-only save', () => {
    const map = createEmptyMap('save-test', 'Save Test')
    const save = galaxySaveFromMap(map)
    const json = serializeGalaxySave(save)
    const parsed = parseGalaxySave(JSON.parse(json))
    expect(isMapOnlySave(parsed)).toBe(true)
    expect(parsed.map.id).toBe('save-test')
    expect(validateGalaxySave(parsed)).toEqual([])
  })

  it('parses legacy MapDefinition JSON', () => {
    const map = createEmptyMap('legacy', 'Legacy')
    const parsed = parseGalaxySave(map)
    expect(parsed.format).toBe('galaxy-save')
    expect(parsed.map.id).toBe('legacy')
    expect(parsed.game).toBeUndefined()
  })

  it('rejects too many action markers per player', () => {
    const map = createEmptyMap()
    addCellOrbit(map, { q: 1, r: 0 }, { enabled: false, playerCount: 2, axisKind: 'line', axisIndex: 0 })
    const game = gameSnapshotFromMap(map)
    for (let i = 0; i <= MAX_ACTION_MARKERS_PER_PLAYER; i++) {
      game.actionMarkers.push({
        id: `act-${i}`,
        ownerId: 'player-1',
        coord: { q: i, r: 0 },
        placedInPhase: 'planning',
      })
    }
    const save = { ...galaxySaveFromMap(map), game }
    expect(validateGalaxySave(save).some((e) => e.includes('action markers'))).toBe(true)
  })

  it('resolves region id for production marker cell', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 2, r: 0, startPlayer: 1 })
    const state = gameStateFromMap(map)
    const regionId = resolveRegionIdForCell(state, { q: 1, r: 0 }, 'player-1')
    expect(regionId).toBe('region-0')
  })

  it('gameStateFromSnapshot strips marker refs from cells', () => {
    const map = createEmptyMap()
    const snapshot = gameSnapshotFromMap(map)
    snapshot.cells[0].actionMarkerId = 'act-1'
    const state = gameStateFromSnapshot(snapshot, map.id)
    expect(state.cells[0].actionMarkerId).toBeUndefined()
  })
})

describe('game markers', () => {
  it('places and removes action marker on owned cell', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')

    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(1)
    expect(removeActionMarker(game, game.actionMarkers[0].id, 'player-1')).toEqual([])
    expect(game.actionMarkers).toHaveLength(0)
  })

  it('rejects action marker on cell without own ship', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'

    const errors = addActionMarker(game, 'player-1', { q: 0, r: 0 })
    expect(errors.some((e) => e.includes('корабл'))).toBe(true)
    expect(game.actionMarkers).toHaveLength(0)
  })

  it('blocks removing action marker after another marker was resolved this turn', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    addActionMarker(game, 'player-1', { q: 0, r: 0 })
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    game.cells.push({
      coord: { q: 1, r: 0 },
      isPowerCenter: false,
      controlOwnerId: 'player-1',
      resourceTokens: [],
      ships: [{ id: 'ship-p1-1-0', type: 'destroyer', ownerId: 'player-1' }],
      actionMarkerId: null,
      productionMarkerId: null,
    })
    game.activePlayerId = 'player-1'
    addActionMarker(game, 'player-1', { q: 1, r: 0 })

    const markerId = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.actionMarkerId!
    expect(removeActionMarker(game, markerId, 'player-1')).toEqual([ACTION_MARKER_REMOVE_BLOCKED_MSG])
    expect(game.actionMarkers).toHaveLength(2)
  })

  it('togglePhaseMarkerAtCell rejects wrong phase', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'events'
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'

    expect(togglePhaseMarkerAtCell(game, 'player-1', { q: 0, r: 0 }, map).length).toBeGreaterThan(0)
  })

  it('allows production marker during planning', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    game.cells[1].controlOwnerId = 'player-1'

    expect(toggleMarkerAtCell(game, 'player-1', { q: 0, r: 0 }, map, 'production')).toEqual([])
    expect(game.productionMarkers).toHaveLength(1)
  })

  it('rejects second production marker in same region', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.cells[0].controlOwnerId = 'player-1'
    game.cells[1].controlOwnerId = 'player-1'

    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    const errors = addProductionMarker(game, 'player-1', { q: 1, r: 0 }, map)
    expect(errors.some((e) => e.includes('регионе'))).toBe(true)
    expect(game.productionMarkers).toHaveLength(1)
  })

  it('allows one production marker per separate region', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 2, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.cells[0].controlOwnerId = 'player-1'
    game.cells[1].controlOwnerId = 'player-1'

    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(addProductionMarker(game, 'player-1', { q: 2, r: 0 }, map)).toEqual([])
    expect(game.productionMarkers).toHaveLength(2)
  })

  it('validateGalaxySave rejects duplicate production markers per region', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.productionMarkers.push(
      {
        id: 'prod-1',
        ownerId: 'player-1',
        coord: { q: 0, r: 0 },
        targetRegionId: 'region-0',
      },
      {
        id: 'prod-2',
        ownerId: 'player-1',
        coord: { q: 1, r: 0 },
        targetRegionId: 'region-0',
      },
    )
    const save = { ...galaxySaveFromMap(map), game }
    expect(validateGalaxySave(save).some((e) => e.includes('multiple production markers'))).toBe(true)
  })
})

describe('turn flow', () => {
  it('passes turn within planning before changing phase', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2', 'P3'])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe('player-1')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe('player-2')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe('player-3')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('actions')
    expect(state.activePlayerId).toBe('player-1')
  })

  it('passes turn within actions and production when no markers remain', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2'])
    state.phase = 'actions'
    state.activePlayerId = 'player-1'

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('actions')
    expect(state.activePlayerId).toBe('player-2')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('production')
    expect(state.activePlayerId).toBe('player-1')
  })

  it('actions phase wraps to first player while action markers remain', () => {
    const map = createEmptyMap()
    const base = gameStateFromMap(map, ['P1', 'P2'])
    base.phase = 'actions'
    base.activePlayerId = 'player-1'
    const game = gameSnapshotFromGameState(base)
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    game.activePlayerId = 'player-2'

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    expect(game.activePlayerId).toBe('player-1')
    expect(game.actionMarkers).toHaveLength(1)
  })

  it('actions phase advances to production when all markers spent', () => {
    const map = createEmptyMap()
    const base = gameStateFromMap(map, ['P1', 'P2'])
    base.phase = 'actions'
    base.activePlayerId = 'player-2'
    const game = gameSnapshotFromGameState(base)

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('production')
    expect(game.activePlayerId).toBe('player-1')
  })

  it('starts new turn with events after all players produce', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2', 'P3'])
    state.phase = 'production'
    state.activePlayerId = 'player-1'
    state.turnNumber = 1

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('production')
    expect(state.activePlayerId).toBe('player-2')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.activePlayerId).toBe('player-3')

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('events')
    expect(state.activePlayerId).toBe('player-1')
    expect(state.turnNumber).toBe(2)
  })

  it('events phase skips player rotation', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2'])
    state.phase = 'events'
    state.activePlayerId = 'player-1'

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe('player-1')
  })

  it('advanceGameSnapshot keeps markers when passing turn', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.players.push({ id: 'player-2', name: 'P2', color: '#22C55E', isAi: false, eliminated: false })
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    addActionMarker(game, 'player-1', { q: 0, r: 0 })

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.activePlayerId).toBe('player-2')
    expect(game.actionMarkers).toHaveLength(1)
  })

  it('getLegalActions only for active player', () => {
    const state = gameStateFromMap(createEmptyMap())
    state.activePlayerId = 'player-1'
    expect(getLegalActions(state, 'player-1')).toHaveLength(1)
    expect(getLegalActions(state, 'player-2')).toHaveLength(0)
    expect(applyGameAction(state, 'player-2', 'advance-phase')[0]).toMatch(/другого/i)
  })

  it('buildObservation can omit geometry for UI', () => {
    const state = gameStateFromMap(createEmptyMap())
    const full = buildObservation(state, [])
    const light = buildObservation(state, [], { geometry: false })
    expect(full.geometry.asciiMap.length).toBeGreaterThan(0)
    expect(light.geometry.asciiMap).toBe('')
    expect(light.geometry.spatialSummary.regions).toEqual([])
  })

  it('trimGameEventLog keeps tail', () => {
    const state = gameStateFromMap(createEmptyMap())
    for (let i = 0; i < 250; i++) {
      state.eventLog.push({
        id: `e-${i}`,
        turn: 1,
        phase: 'planning',
        type: 'test',
        message: String(i),
        timestamp: i,
      })
    }
    trimGameEventLog(state, 200)
    expect(state.eventLog).toHaveLength(200)
    expect(state.eventLog[0]?.message).toBe('50')
  })
})

describe('movement', () => {
  function movementTestMap() {
    return normalizeMapDefinition({
      id: 'move-test',
      name: 'Move test',
      cells: [
        { q: 0, r: -7, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
        { q: 1, r: -6 },
        { q: 1, r: -7, startPlayer: 2 },
        { q: 0, r: -5 },
        { q: 0, r: -4 },
        { q: 0, r: -3 },
        { q: 0, r: 0, startPlayer: 2 },
      ],
    })
  }

  it('getShipMoveRange matches ships.yaml', () => {
    expect(getShipMoveRange('destroyer')).toBe(3)
    expect(getShipMoveRange('supply')).toBe(3)
    expect(getShipMoveRange('battleship')).toBe(1)
  })

  it('getReachableHexKeys respects move range', () => {
    const map = movementTestMap()
    const from = { q: 0, r: -7 }
    const keys = getReachableHexKeys(map, from, 'destroyer')
    expect(keys).toContain('1,-6')
    expect(keys).toContain('0,-5')
    expect(keys).toContain('0,-4')
    expect(keys).not.toContain('0,0')
  })

  it('executeMarkerMovement moves ships and removes marker', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'dd-2',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'sp-1',
      type: 'supply',
      ownerId: 'player-1',
    })
    addActionMarker(game, 'player-1', { q: 0, r: -7 })

    const from = { q: 0, r: -7 }
    const errors = executeMarkerMovement(game, map, 'player-1', from, [
      { shipId: 'start-0--7-0', to: { q: 1, r: -6 } },
      { shipId: 'dd-2', to: { q: 0, r: -5 } },
      { shipId: 'sp-1', to: { q: 0, r: -4 }, declareControl: true },
    ])
    expect(errors).toEqual([])

    const source = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!
    expect(source.ships.filter((s) => s.ownerId === 'player-1')).toHaveLength(0)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.ships).toHaveLength(1)
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!.controlOwnerId).toBe(
      'player-1',
    )
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!.ships).toHaveLength(0)
    expect(game.actionMarkers).toHaveLength(0)
    expect(source.actionMarkerId).toBeNull()
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('supply can move to neutral without occupying — ship stays, no control', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'sp-1',
      type: 'supply',
      ownerId: 'player-1',
    })
    addActionMarker(game, 'player-1', { q: 0, r: -7 })

    const errors = executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
      { shipId: 'sp-1', to: { q: 0, r: -4 } },
    ])
    expect(errors).toEqual([])

    const dest = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!
    expect(dest.controlOwnerId).toBeNull()
    expect(dest.ships).toHaveLength(1)
    expect(dest.ships[0]?.type).toBe('supply')
  })

  it('validateMarkerMovement rejects enemy cell and out of range', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addActionMarker(game, 'player-1', { q: 0, r: -7 })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.controlOwnerId = 'player-2'

    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 1, r: -6 } },
      ])[0],
    ).toMatch(/бой|враж/i)

    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 0, r: -3 } },
      ])[0],
    ).toMatch(/дальность/i)
  })

  it('getMovableShipsAtMarker lists player ships with ranges', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addActionMarker(game, 'player-1', { q: 0, r: -7 })

    const options = getMovableShipsAtMarker(game, map, 'player-1', { q: 0, r: -7 })
    expect(options).toHaveLength(1)
    expect(options[0]?.moveRange).toBe(3)
    expect(options[0]?.reachableKeys).toContain('1,-6')
  })

  it('applyGameActionOnSnapshot executes marker movement', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addActionMarker(game, 'player-1', { q: 0, r: -7 })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id

    const errors = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: -7 },
      moves: [{ shipId, to: { q: 1, r: -6 } }],
    })
    expect(errors).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.ships).toHaveLength(1)
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('blocks second action marker resolution in the same actions-phase turn', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -5)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -5)!.ships.push({
      id: 'dd-3',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    addActionMarker(game, 'player-1', { q: 0, r: -7 })
    addActionMarker(game, 'player-1', { q: 0, r: -5 })

    const shipAtFirst = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id
    expect(
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId: shipAtFirst, to: { q: 1, r: -6 } },
      ]),
    ).toEqual([])

    const shipAtSecond = 'dd-3'
    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -5 }, [
        { shipId: shipAtSecond, to: { q: 0, r: -4 } },
      ]),
    ).toEqual([ACTION_MARKER_ALREADY_RESOLVED_MSG])
    expect(getMovableShipsAtMarker(game, map, 'player-1', { q: 0, r: -5 })).toEqual([])
  })

  it('resets action marker resolution when passing turn within actions phase', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true
    const cell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    cell.controlOwnerId = 'player-2'
    addTestShip(game, 0, 0, 'player-2')
    addActionMarker(game, 'player-2', { q: 0, r: 0 })

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.activePlayerId).toBe('player-2')
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('resets action marker resolution when entering actions phase', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.activePlayerId).toBe('player-2')

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    expect(game.activePlayerId).toBe('player-1')
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('getLegalActionsForSnapshot notes when action marker already used', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true
    addActionMarker(game, 'player-1', { q: 0, r: -7 })

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((a) => a.id === 'action-marker-used')).toBe(true)
  })
})

describe('production', () => {
  function productionTestMap() {
    return normalizeMapDefinition({
      id: 'prod-test',
      name: 'Production test',
      cells: [
        {
          q: 0,
          r: 0,
          startPlayer: 1,
          resourceToken: { type: 'credits', value: 3, faceUp: true },
        },
        {
          q: 1,
          r: 0,
          startPlayer: 1,
          resourceToken: { type: 'credits', value: 2, faceUp: true },
        },
        {
          q: 0,
          r: 1,
          startPlayer: 1,
          resourceToken: { type: 'production', value: 3, faceUp: true },
        },
        { q: 2, r: 0, startPlayer: 2 },
      ],
    })
  }

  it('getShipProductionCost matches ships.yaml', () => {
    expect(getShipProductionCost('destroyer')).toEqual({ credits: 2, production: 2 })
    expect(getShipProductionCost('supply')).toEqual({ credits: 3, production: 1 })
  })

  it('canBuildShipInRegionSize uses minimum region size only', () => {
    expect(getShipProductionRegionMin('supply')).toBe(1)
    expect(canBuildShipInRegionSize('supply', 1)).toBe(true)
    expect(canBuildShipInRegionSize('supply', 5)).toBe(true)
    expect(canBuildShipInRegionSize('destroyer', 2)).toBe(false)
    expect(canBuildShipInRegionSize('destroyer', 3)).toBe(true)
    expect(canBuildShipInRegionSize('destroyer', 10)).toBe(true)
  })

  it('executeProductionBatch spends tokens and places ships', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    const options = getBuildableShipsForMarker(game, map.id, 'player-1', marker.id)
    expect(options.find((o) => o.type === 'destroyer')?.disabledReason).toBeUndefined()
    expect(options.find((o) => o.type === 'destroyer')?.maxCount).toBeGreaterThanOrEqual(1)

    const tokens = getRegionTokensForMarker(game, map.id, marker)
    expect(tokens.length).toBeGreaterThanOrEqual(2)

    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: marker.id,
      ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
    })
    expect(errors).toEqual([])

    const cell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    expect(cell.ships.some((s) => s.type === 'destroyer' && s.ownerId === 'player-1')).toBe(true)
    expect(cell.resourceTokens[0]?.faceUp).toBe(false)
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.resourceTokens[0]?.faceUp).toBe(
      false,
    )
    expect(game.productionMarkers).toHaveLength(0)
    expect(cell.productionMarkerId).toBeNull()
    expect(game.productionMarkerResolvedThisTurn).toBe(true)
  })

  it('executeProductionBuild wrapper still works for single ship', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    const spent = autoAllocateTokens(game, map.id, marker, 2, 2)
    expect(spent).not.toBeNull()

    const errors = executeProductionBuild(game, map.id, 'player-1', {
      markerId: marker.id,
      shipType: 'destroyer',
      spentTokens: spent!,
    })
    expect(errors).toEqual([])
    expect(game.productionMarkerResolvedThisTurn).toBe(true)
  })

  it('places multiple ships across region cells', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: marker.id,
      ships: [
        { type: 'destroyer', coord: { q: 0, r: 0 } },
        { type: 'supply', coord: { q: 1, r: 0 } },
      ],
    })
    expect(errors).toEqual([])

    expect(
      game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.ships.some((s) => s.type === 'destroyer'),
    ).toBe(true)
    expect(
      game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.ships.some((s) => s.type === 'supply'),
    ).toBe(true)
  })

  it('needsProductionTokenChoice when face-up and face-down production coexist', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    expect(needsProductionTokenChoice(game, map.id, marker)).toBe(false)

    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.resourceTokens.push({
      type: 'production',
      value: 2,
      faceUp: false,
    })
    expect(needsProductionTokenChoice(game, map.id, marker)).toBe(true)
    expect(getRegionResourceSummary(game, map.id, marker).faceDownProductionCount).toBe(1)
  })

  it('executeProductionRecharge flips face-down production tokens', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    const prodCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    prodCell.resourceTokens.push({ type: 'production', value: 2, faceUp: false })

    const errors = executeProductionRecharge(game, map.id, 'player-1', { markerId: marker.id })
    expect(errors).toEqual([])
    expect(prodCell.resourceTokens.every((t) => t.faceUp !== false)).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
    expect(game.productionMarkerResolvedThisTurn).toBe(true)
  })

  it('validateProductionRecharge requires face-down production tokens', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    expect(validateProductionRecharge(game, map.id, 'player-1', { markerId: marker.id })).toEqual([
      'В регионе нет перевёрнутых фишек производства',
    ])
  })

  it('blocks second production marker build in the same turn', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    expect(
      executeProductionBatch(game, map.id, 'player-1', {
        markerId: marker.id,
        ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
      }),
    ).toEqual([])

    expect(
      validateProductionBuild(game, map.id, 'player-1', {
        markerId: 'removed-marker',
        shipType: 'destroyer',
        spentTokens: [],
      }),
    ).toEqual([PRODUCTION_MARKER_ALREADY_RESOLVED_MSG])
  })

  it('applyGameActionOnSnapshot executes production', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.productionMarkers[0]!

    const errors = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-production', {
      markerId: marker.id,
      ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
    })
    expect(errors).toEqual([])
    expect(game.productionMarkerResolvedThisTurn).toBe(true)
  })

  it('production phase wraps while markers remain', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-2'
    addProductionMarker(game, 'player-2', { q: 2, r: 0 }, map)

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('production')
    expect(game.activePlayerId).toBe('player-1')
    expect(game.productionMarkerResolvedThisTurn).toBe(false)
  })

  it('getLegalActionsForSnapshot notes when production marker already used', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    game.productionMarkerResolvedThisTurn = true
    addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((a) => a.id === 'production-marker-used')).toBe(true)
  })
})

describe('scaffold', () => {
  it('passes', () => {
    expect(true).toBe(true)
  })
})
