import { describe, expect, it } from 'vitest'
import type { GameSnapshot } from './save-file.js'
import type { ShipType } from './types.js'
import { hexKey } from './types.js'

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

function withPlanningPhase<T>(game: GameSnapshot, ownerId: string, fn: () => T): T {
  const prevPhase = game.phase
  const prevActive = game.activePlayerId
  game.phase = 'planning'
  game.activePlayerId = ownerId
  try {
    return fn()
  } finally {
    game.phase = prevPhase
    game.activePlayerId = prevActive
  }
}

function ensureActionMarkerCapacity(
  game: GameSnapshot,
  ownerId: string,
  needed: number,
) {
  game.actionMarkerLimitByPlayer ??= {}
  const current = game.actionMarkerLimitByPlayer[ownerId] ?? 0
  if (current < needed) game.actionMarkerLimitByPlayer[ownerId] = needed
}

function placeActionMarkerForTest(
  game: GameSnapshot,
  ownerId: string,
  coord: { q: number; r: number },
) {
  const already = game.actionMarkers.filter((m) => m.ownerId === ownerId).length
  ensureActionMarkerCapacity(game, ownerId, already + 1)
  return withPlanningPhase(game, ownerId, () => addActionMarker(game, ownerId, coord))
}

function placeProductionMarkerForTest(
  game: GameSnapshot,
  ownerId: string,
  coord: { q: number; r: number },
  _map?: ReturnType<typeof createEmptyMap>,
) {
  const cell = game.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
  if (cell) {
    cell.controlOwnerId ??= ownerId
    if (!cell.ships.some((s) => s.ownerId === ownerId)) {
      cell.ships.push({
        id: `test-ship-${coord.q}-${coord.r}`,
        type: 'destroyer',
        ownerId,
      })
    }
  }
  ensureActionMarkerCapacity(
    game,
    ownerId,
    game.actionMarkers.filter((m) => m.ownerId === ownerId).length + 1,
  )
  return placeActionMarkerForTest(game, ownerId, coord)
}

/** Линия из count смежных клеток (q, r), (q+1, r), … для тестов регионов */
function addHorizontalLine(
  map: ReturnType<typeof createEmptyMap>,
  count: number,
  startQ = 0,
  startR = 0,
  startPlayer = 1,
) {
  for (let i = 0; i < count; i++) {
    const q = startQ + i
    if (map.cells.some((c) => c.q === q && c.r === startR)) continue
    map.cells.push({ q, r: startR, startPlayer })
  }
}

function setPlayerControl(
  game: { cells: { coord: { q: number; r: number }; controlOwnerId?: string | null }[] },
  ownerId: string,
  coords: { q: number; r: number }[],
) {
  for (const coord of coords) {
    const cell = game.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
    if (cell) cell.controlOwnerId = ownerId
  }
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
  getSymmetryAxisLabels,
  getSymmetryOrbit,
  horizontalThroughCentersPossible,
  reflectHex,
  remapPlayerSlot,
  rotateHex,
  addCellOrbit,
  removeCellOrbit,
  syncCellOrbitContent,
  normalizeMapDefinition,
  inferMapPlayerCount,
  resolveMapPlayerCount,
  syncCellControlWithShips,
  inferCellControlFromShips,
} from './map.js'
import {
  galaxySaveFromMap,
  gameSnapshotFromGameState,
  gameSnapshotFromMap,
  gameSnapshotFromObservation,
  gameStateFromSnapshot,
  isMapOnlySave,
  parseGalaxySave,
  participatingPlayerIdsForLobby,
  ensurePlayerSlots,
  resolveRegionIdForCell,
  maxProductionMarkersForPlayer,
  serializeGalaxySave,
  galaxySaveDownloadFileName,
  validateGalaxySave,
} from './save-file.js'
import {
  MIN_VALID_PRODUCTION_REGION_SIZE,
} from './regions.js'
import {
  defaultPreferredPlayerId,
  freeLobbyPlayerIds,
  resolveJoinPlayerId,
  resolveRejoinPlayerId,
} from './lobby.js'
import { addActionMarker, addProductionMarker, removeActionMarker, toggleMarkerAtCell, togglePhaseMarkerAtCell, ACTION_MARKER_ALREADY_RESOLVED_MSG, ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG, ACTION_MARKER_REMOVE_BLOCKED_MSG, shouldConfirmPlanningPhaseAdvance } from './markers.js'
import { applyGameAction, buildObservation, gameStateFromMap, getLegalActions } from './game.js'
import {
  applyGameActionOnSnapshot,
  executeMarkerMovement,
  getLegalActionsForSnapshot,
  getMovableShipsAtMarker,
  getReachableHexKeys,
  hexPathDistance,
  validateDestinationForMove,
  validateMarkerMovement,
} from './movement.js'
import { isCombatDestination, ONE_BATTLE_PER_MARKER_MSG } from './combat.js'
import {
  autoAllocateTokens,
  executeBuyProductionMarker,
  executeProductionBatch,
  executeProductionBuild,
  executeProductionRecharge,
  getBuildableShipsForMarker,
  getRegionForMarker,
  getRegionResourceSummary,
  getRegionTokensForMarker,
  needsProductionTokenChoice,
  countShipsForPlayer,
  getFleetLimitWarnings,
  validateProductionBuild,
  validateProductionRecharge,
  validateShipPlacements,
} from './production.js'
import { getShipMoveRange, getShipProductionCost, canBuildShipInRegionSize, getShipProductionRegionMin } from './ships.js'
import { MAX_FLEET_SIZE_PER_PLAYER } from './constants.js'
import { trimGameEventLog } from './event-log.js'
import { advanceGamePhase, advanceGameSnapshot, activePlayerOrder } from './turn.js'
import { isTurnEventResolved } from './events.js'
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

  it('syncCellControlWithShips sets startPlayer from sole ship owner', () => {
    const map = createEmptyMap()
    map.cells[0].startPlayer = 2
    map.cells[0].startingShips = [{ type: 'destroyer', player: 1 }]
    syncCellControlWithShips(map.cells[0])
    expect(map.cells[0].startPlayer).toBe(1)
    expect(inferCellControlFromShips(map.cells[0])).toBe(1)
  })

  it('normalizeMapDefinition fixes control/ship owner mismatch on load', () => {
    const map = createEmptyMap('sync-test', 'Sync')
    map.cells[0].startPlayer = 2
    map.cells[0].startingShips = [{ type: 'cruiser', player: 1 }]
    const normalized = normalizeMapDefinition(map)
    expect(normalized.cells[0].startPlayer).toBe(1)
    expect(validateMapDefinition(normalized)).toEqual([])
  })

  it('validateMapDefinition errors when control disagrees with ship owner', () => {
    const map = createEmptyMap()
    map.cells[0].startPlayer = 2
    map.cells[0].startingShips = [{ type: 'destroyer', player: 1 }]
    expect(
      validateMapDefinition(map).some((e) => e.includes('не совпадает')),
    ).toBe(true)
  })

  it('canAddShipToCell respects per-player and total limits', () => {
    const cell = { q: 0, r: 0, startingShips: [{ type: 'destroyer' as const, player: 1 }] }
    expect(canAddShipToCell(cell, 1)).toBe(true)
    cell.startingShips = Array(MAX_SHIPS_PER_CELL_PER_PLAYER)
      .fill(null)
      .map(() => ({ type: 'destroyer' as const, player: 1 }))
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
    const target: import('./types.js').MapCellDefinition = {
      q: 3,
      r: -1,
      startPlayer: 1,
      resourceToken: { type: 'production' as const, value: 1 as const },
      startingShips: [{ type: 'destroyer' as const, player: 1 }],
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

  it('reflectHex is an involution for all six axes', () => {
    const c = { q: 3, r: -1 }
    for (let axis = 0; axis < 6; axis++) {
      expect(reflectHex(reflectHex(c, axis), axis)).toEqual(c)
    }
  })

  it('even and odd axis steps are different reflection families', () => {
    const c = { q: 3, r: -1 }
    const images = new Set(
      Array.from({ length: 6 }, (_, axis) => {
        const m = reflectHex(c, axis)
        return `${m.q},${m.r}`
      }),
    )
    expect(images.size).toBe(6)
  })

  it('2-player through-centers axis 0 keeps the q-axis fixed', () => {
    const onAxis = getSymmetryOrbit({ q: 1, r: 0 }, { playerCount: 2, axisKind: 'line', axisIndex: 0 })
    expect(onAxis).toEqual([{ q: 1, r: 0 }])
  })

  it('2-player orbit has size 2 off a through-centers axis', () => {
    const orbit = getSymmetryOrbit({ q: 0, r: 1 }, { playerCount: 2, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(2)
    expect(orbit).toEqual(expect.arrayContaining([{ q: 0, r: 1 }, { q: 1, r: -1 }]))
  })

  it('2-player line and edge orbits differ for a generic hex', () => {
    const settingsBase = { playerCount: 2 as const, axisIndex: 0 }
    const line = getSymmetryOrbit({ q: 1, r: 1 }, { ...settingsBase, axisKind: 'line' })
    const edge = getSymmetryOrbit({ q: 1, r: 1 }, { ...settingsBase, axisKind: 'edge' })
    expect(line).toHaveLength(2)
    expect(edge).toHaveLength(2)
    expect(line).not.toEqual(edge)
  })

  it('horizontal through-centers labels exist only for pointy-top drawing', () => {
    expect(horizontalThroughCentersPossible('pointy')).toBe(true)
    expect(horizontalThroughCentersPossible('flat')).toBe(false)
    expect(getSymmetryAxisLabels('line', 'pointy')[0]).toBe('↔ горизонталь')
    expect(getSymmetryAxisLabels('line', 'flat')[0]).not.toBe('↔ горизонталь')
    expect(getSymmetryAxisLabels('edge', 'flat')[0]).toBe('↔ горизонталь')
  })

  it('3-player orbit has three distinct hexes', () => {
    const orbit = getSymmetryOrbit({ q: 1, r: 0 }, { playerCount: 3, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(3)
  })

  it('4-player orbit has four distinct hexes', () => {
    const orbit = getSymmetryOrbit({ q: 1, r: 1 }, { playerCount: 4, axisKind: 'line', axisIndex: 0 })
    expect(orbit).toHaveLength(4)
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
    addCellOrbit(map, { q: 0, r: 1 }, { enabled: true, playerCount: 2, axisKind: 'line', axisIndex: 0 })
    expect(map.cells.length).toBe(3)
  })

  it('syncCellOrbitContent mirrors player slots for 2 players', () => {
    const map = createEmptyMap()
    addCellOrbit(map, { q: 0, r: 1 }, { enabled: true, playerCount: 2, axisKind: 'line', axisIndex: 0 })
    const source = map.cells.find((c) => c.q === 0 && c.r === 1)!
    source.startPlayer = 1
    syncCellOrbitContent(map, { q: 0, r: 1 }, {
      enabled: true,
      playerCount: 2,
      axisKind: 'line',
      axisIndex: 0,
    })
    const mirrored = map.cells.find((c) => c.q === 1 && c.r === -1)!
    expect(source.startPlayer).toBe(1)
    expect(mirrored.startPlayer).toBe(2)
  })

  it('remapPlayerSlot rotates slots for 4 players', () => {
    expect(remapPlayerSlot(1, 1, 4)).toBe(2)
    expect(remapPlayerSlot(1, 3, 4)).toBe(4)
  })

  it('syncCellOrbitContent rotates player slots for 4 players', () => {
    const settings = { enabled: true, playerCount: 4 as const, axisKind: 'line' as const, axisIndex: 0 }
    const map = createEmptyMap()
    addCellOrbit(map, { q: 1, r: 1 }, settings)
    const source = map.cells.find((c) => c.q === 1 && c.r === 1)!
    source.startPlayer = 1
    syncCellOrbitContent(map, { q: 1, r: 1 }, settings)
    const orbit = getSymmetryOrbit({ q: 1, r: 1 }, { playerCount: 4, axisKind: 'line', axisIndex: 0 })
    const players = orbit.map((coord) =>
      map.cells.find((c) => c.q === coord.q && c.r === coord.r)?.startPlayer,
    )
    expect(players).toEqual([1, 2, 3, 4])
  })

  it('removeCellOrbit removes all symmetric copies', () => {
    const map = createEmptyMap()
    const settings = { enabled: true, playerCount: 2 as const, axisKind: 'line' as const, axisIndex: 0 }
    addCellOrbit(map, { q: 0, r: 1 }, settings)
    removeCellOrbit(map, { q: 0, r: 1 }, settings)
    expect(map.cells).toHaveLength(1)
  })
})

describe('map playerCount', () => {
  it('infers player count from start positions', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 3 })
    expect(inferMapPlayerCount(map)).toBe(3)
  })

  it('defaults to 2 when no player slots used', () => {
    expect(inferMapPlayerCount(createEmptyMap())).toBe(2)
  })

  it('resolveMapPlayerCount prefers explicit field', () => {
    const map = createEmptyMap()
    map.playerCount = 5
    expect(resolveMapPlayerCount(map)).toBe(5)
  })

  it('validates playerCount range', () => {
    const map = createEmptyMap()
    map.playerCount = 7
    expect(validateMapDefinition(map).some((e) => e.includes('игроков'))).toBe(true)
  })

  it('gameStateFromMap uses map playerCount for slots', () => {
    const map = createEmptyMap()
    map.playerCount = 4
    const state = gameStateFromMap(map)
    expect(state.players).toHaveLength(4)
  })
})

describe('galaxy save file', () => {
  it('download filename uses map display name, not id', () => {
    expect(galaxySaveDownloadFileName('Черновик', 'draft')).toBe('Черновик.galaxy.json')
    expect(galaxySaveDownloadFileName('карта: дуэль?*', 'duel-id')).toBe('карта_ дуэль__.galaxy.json')
    expect(galaxySaveDownloadFileName('  ', 'map-42')).toBe('map-42.galaxy.json')
    expect(galaxySaveDownloadFileName(undefined, 'fallback')).toBe('fallback.galaxy.json')
    expect(galaxySaveDownloadFileName('Новая карта.galaxy.json', 'id')).toBe('Новая карта.galaxy.json')
  })

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
    map.cells[0]!.isPowerCenter = true
    map.cells[0]!.startPlayer = 1
    const game = gameSnapshotFromMap(map)
    game.actionMarkers.push({
      id: 'act-0',
      ownerId: 'player-1',
      coord: { q: 0, r: 0 },
      placedInPhase: 'planning',
    })
    game.actionMarkers.push({
      id: 'act-1',
      ownerId: 'player-1',
      coord: { q: 1, r: 0 },
      placedInPhase: 'planning',
    })
    game.actionMarkers.push({
      id: 'act-2',
      ownerId: 'player-1',
      coord: { q: 2, r: 0 },
      placedInPhase: 'planning',
    })
    game.actionMarkers.push({
      id: 'act-3',
      ownerId: 'player-1',
      coord: { q: 3, r: 0 },
      placedInPhase: 'planning',
    })
    game.actionMarkers.push({
      id: 'act-4',
      ownerId: 'player-1',
      coord: { q: 4, r: 0 },
      placedInPhase: 'planning',
    })
    const save = { ...galaxySaveFromMap(map), game }
    expect(validateGalaxySave(save).some((e) => e.includes('action markers'))).toBe(true)
  })

  it('gameSnapshotFromObservation with production markers does not throw without map', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const preserve = gameSnapshotFromMap(map)
    preserve.cells[0].controlOwnerId = 'player-1'
    addTestShip(preserve, 0, 0, 'player-1')

    expect(() =>
      gameSnapshotFromObservation(
        {
          phase: preserve.phase,
          turnNumber: preserve.turnNumber,
          activePlayerId: preserve.activePlayerId,
          players: preserve.players,
          cells: preserve.cells,
          actionMarkers: [],
          productionMarkers: [
            {
              id: 'prod-1',
              ownerId: 'player-1',
              coord: { q: 0, r: 0 },
              targetRegionId: 'region-player-1-0,0',
            },
          ],
        },
        preserve,
      ),
    ).not.toThrow()
  })

  it('gameSnapshotFromObservation keeps participatingPlayerIds when server omits field', () => {
    const map = createEmptyMap()
    const preserve = gameSnapshotFromMap(map)
    preserve.participatingPlayerIds = ['player-1', 'player-2', 'player-3']

    const game = gameSnapshotFromObservation(
      {
        phase: preserve.phase,
        turnNumber: preserve.turnNumber,
        activePlayerId: preserve.activePlayerId,
        players: preserve.players,
        cells: preserve.cells,
        actionMarkers: [],
        productionMarkers: [],
      },
      preserve,
    )
    expect(game.participatingPlayerIds).toEqual(['player-1', 'player-2', 'player-3'])
  })

  it('gameSnapshotFromObservation clears pendingCombat when server sends null', () => {
    const map = createEmptyMap()
    const preserve = gameSnapshotFromMap(map)
    preserve.pendingCombat = {
      cellKey: '1,0',
      attackerId: 'player-1',
      defenderIds: ['player-2'],
      roundNumber: 1,
      phase: 'prep',
      prep: {
        phase: 'countdown',
        defenderId: 'player-2',
        readyBy: { 'player-1': true, 'player-2': true },
        combatOptions: {},
        countdownStartedAt: Date.now(),
      },
    }

    const game = gameSnapshotFromObservation(
      {
        phase: preserve.phase,
        turnNumber: preserve.turnNumber,
        activePlayerId: preserve.activePlayerId,
        players: preserve.players,
        cells: preserve.cells,
        actionMarkers: [],
        productionMarkers: [],
        pendingCombat: null,
      } as Parameters<typeof gameSnapshotFromObservation>[0] & { pendingCombat: null },
      preserve,
    )
    expect(game.pendingCombat).toBeUndefined()
  })

  it('gameSnapshotFromObservation clears turnEvent when server sends null', () => {
    const map = createEmptyMap()
    const preserve = gameSnapshotFromMap(map)
    preserve.turnEvent = { eventId: 'magnetic-storm', turnNumber: 1, resolvedAt: '2026-01-01' }

    const game = gameSnapshotFromObservation(
      {
        phase: preserve.phase,
        turnNumber: preserve.turnNumber,
        activePlayerId: preserve.activePlayerId,
        players: preserve.players,
        cells: preserve.cells,
        actionMarkers: [],
        productionMarkers: [],
        turnEvent: null,
      } as Parameters<typeof gameSnapshotFromObservation>[0] & { turnEvent: null },
      preserve,
    )
    expect(game.turnEvent).toBeUndefined()
  })

  it('gameSnapshotFromObservation replaces eventLog when server sends it', () => {
    const map = createEmptyMap()
    const preserve = gameSnapshotFromMap(map)
    preserve.eventLog = [{ id: 'local', turn: 1, phase: 'planning', type: 'info', message: 'local', timestamp: 1 }]

    const serverLog = [{ id: 'srv', turn: 1, phase: 'planning', type: 'info', message: 'server', timestamp: 2 }]
    const game = gameSnapshotFromObservation(
      {
        phase: preserve.phase,
        turnNumber: preserve.turnNumber,
        activePlayerId: preserve.activePlayerId,
        players: preserve.players,
        cells: preserve.cells,
        actionMarkers: [],
        productionMarkers: [],
        eventLog: serverLog,
      } as Parameters<typeof gameSnapshotFromObservation>[0] & { eventLog: typeof serverLog },
      preserve,
    )
    expect(game.eventLog).toEqual(serverLog)
  })

  it('buildObservation forwards explicit nulls for cleared snapshot fields', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.turnEvent = { eventId: 'magnetic-storm', turnNumber: 1 }

    const obs = buildObservation(
      {
        ...gameStateFromSnapshot(game, map.id),
        actionMarkers: game.actionMarkers,
        productionMarkers: game.productionMarkers,
        turnEvent: null,
        pendingCombat: null,
        gameOver: null,
        lastCombatResult: null,
        observationRevision: 3,
      } as Parameters<typeof buildObservation>[0] & Record<string, unknown>,
      [],
      { geometry: false },
    )

    const mech = obs.mechanics as Record<string, unknown>
    expect(mech.turnEvent).toBeNull()
    expect(mech.pendingCombat).toBeNull()
    expect(mech.gameOver).toBeNull()
    expect(mech.lastCombatResult).toBeNull()
    expect(mech.observationRevision).toBe(3)
  })

  it('buildObservation forwards resourceRechargeTurnsRemaining', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.resourceRechargeTurnsRemaining = 2

    const obs = buildObservation(
      {
        ...gameStateFromSnapshot(game, map.id),
        actionMarkers: game.actionMarkers,
        productionMarkers: game.productionMarkers,
        resourceRechargeTurnsRemaining: 2,
      } as Parameters<typeof buildObservation>[0] & Record<string, unknown>,
      [],
      { geometry: false },
    )

    expect((obs.mechanics as Record<string, unknown>).resourceRechargeTurnsRemaining).toBe(2)
  })

  it('gameSnapshotFromObservation syncs resourceRechargeTurnsRemaining from server', () => {
    const map = createEmptyMap()
    const local = gameSnapshotFromMap(map)
    local.resourceRechargeTurnsRemaining = 3

    const synced = gameSnapshotFromObservation(
      {
        phase: local.phase,
        turnNumber: local.turnNumber,
        activePlayerId: local.activePlayerId,
        players: local.players,
        cells: local.cells,
        actionMarkers: local.actionMarkers,
        productionMarkers: local.productionMarkers,
        resourceRechargeTurnsRemaining: 1,
      } as Parameters<typeof gameSnapshotFromObservation>[0] & Record<string, unknown>,
      local,
      map,
    )

    expect(synced.resourceRechargeTurnsRemaining).toBe(1)
  })

  it('ensurePlayerSlots pads players up to slot count', () => {
    const game = gameSnapshotFromMap(createEmptyMap())
    expect(game.players).toHaveLength(2)
    ensurePlayerSlots(game, 6)
    expect(game.players).toHaveLength(6)
    expect(game.players[5].id).toBe('player-6')
  })

  it('participatingPlayerIdsForLobby trims to maxPlayers', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    expect(participatingPlayerIdsForLobby(game, 2)).toEqual(['player-1', 'player-2'])
  })

  it('resolveJoinPlayerId picks preferred free slot', () => {
    expect(resolveJoinPlayerId(['player-1'], 3, 'player-3')).toEqual({
      ok: true,
      playerId: 'player-3',
    })
  })

  it('resolveJoinPlayerId rejects occupied slot with available list', () => {
    const result = resolveJoinPlayerId(['player-1', 'player-2'], 3, 'player-2')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('занят')
      expect(result.availablePlayerIds).toEqual(['player-3'])
    }
  })

  it('resolveJoinPlayerId falls back to first free slot', () => {
    expect(resolveJoinPlayerId(['player-2'], 3)).toEqual({
      ok: true,
      playerId: 'player-1',
    })
  })

  it('resolveRejoinPlayerId allows slot change for joined player', () => {
    expect(resolveRejoinPlayerId('player-1', ['player-1'], 3, 'player-3')).toEqual({
      ok: true,
      playerId: 'player-3',
      previousPlayerId: 'player-1',
    })
  })

  it('defaultPreferredPlayerId prefers claim then session', () => {
    expect(
      defaultPreferredPlayerId(['player-1'], 3, {
        claimPlayerId: 'player-2',
        sessionPlayerId: 'player-3',
      }),
    ).toBe('player-2')
    expect(
      defaultPreferredPlayerId(['player-1', 'player-2'], 3, {
        claimPlayerId: 'player-2',
        sessionPlayerId: 'player-3',
      }),
    ).toBe('player-3')
    expect(freeLobbyPlayerIds(['player-1', 'player-2'], 3)).toEqual(['player-3'])
  })

  it('resolveRegionIdForCell returns null for cluster below marker minimum', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const state = gameStateFromMap(map)
    state.cells[0].controlOwnerId = 'player-1'
    state.cells[1].controlOwnerId = 'player-1'

    expect(resolveRegionIdForCell(state, { q: 0, r: 0 }, 'player-1')).toBeNull()
  })

  it('resolveRegionIdForCell returns null when cell is not controlled by player', () => {
    const map = createEmptyMap()
    const state = gameStateFromMap(map)
    state.cells[0].controlOwnerId = 'player-2'

    expect(resolveRegionIdForCell(state, { q: 0, r: 0 }, 'player-1')).toBeNull()
  })

  it('resolves region id for production marker cell in valid region', () => {
    const map = createEmptyMap()
    addHorizontalLine(map, 3)
    const state = gameStateFromMap(map)
    setPlayerControl(state, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])
    const regionId = resolveRegionIdForCell(state, { q: 1, r: 0 }, 'player-1')
    expect(regionId).toBe('region-player-1-0,0')
  })

  it('gameStateFromSnapshot strips marker refs from cells', () => {
    const map = createEmptyMap()
    const snapshot = gameSnapshotFromMap(map)
    snapshot.cells[0].actionMarkerId = 'act-1'
    const state = gameStateFromSnapshot(snapshot, map.id)
    expect('actionMarkerId' in state.cells[0]).toBe(false)
  })
})

describe('game markers', () => {
  it('places and removes action marker on cell with own ship', () => {
    const map = createEmptyMap()
    map.cells[0]!.isPowerCenter = true
    map.cells[0]!.startPlayer = 1
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')

    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(1)
    expect(removeActionMarker(game, game.actionMarkers[0].id, 'player-1')).toEqual([])
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('allows action marker on controlled power center without ships', () => {
    const map = createEmptyMap()
    map.cells[0]!.isPowerCenter = true
    map.cells[0]!.startPlayer = 1
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    expect(game.cells[0].ships).toHaveLength(0)

    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(1)
  })

  it('allows action marker on cell with ship even without control', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, isPowerCenter: true, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-2'
    addTestShip(game, 0, 0, 'player-1')

    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(game.actionMarkers).toHaveLength(1)
  })

  it('rejects action marker on enemy power center without own ships', () => {
    const map = createEmptyMap()
    map.cells[0]!.isPowerCenter = true
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-2'

    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([
      'Маркер действия ставится на клетку с вашим кораблём или на ваш центр власти',
    ])
  })

  it('rejects adding action marker outside planning phase', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')

    const errors = addActionMarker(game, 'player-1', { q: 0, r: 0 })
    expect(errors.some((e) => e.includes('планирован'))).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('rejects adding production marker outside planning phase', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'production'
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'

    const errors = addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    expect(errors.some((e) => e.includes('планирован'))).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('toggleMarkerAtCell allows removal but not adding in actions phase', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    game.cells[1].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    addTestShip(game, 1, 0, 'player-1')
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: 0 })

    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    expect(toggleMarkerAtCell(game, 'player-1', { q: 0, r: 0 }, map, 'action')).toEqual([])
    expect(game.productionMarkers).toHaveLength(0)

    const addErrors = toggleMarkerAtCell(game, 'player-1', { q: 1, r: 0 }, map, 'action')
    expect(addErrors.some((e) => e.includes('планирован'))).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('shouldConfirmPlanningPhaseAdvance when markers remain available', () => {
    const map = createEmptyMap()
    addHorizontalLine(map, 3)
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])
    addTestShip(game, 0, 0, 'player-1')
    addTestShip(game, 1, 0, 'player-1')

    expect(shouldConfirmPlanningPhaseAdvance(game, map, 'player-1')).toBe(true)

    placeActionMarkerForTest(game, 'player-1', { q: 0, r: 0 })
    expect(shouldConfirmPlanningPhaseAdvance(game, map, 'player-1')).toBe(true)
  })

  it('rejects action marker on cell without own ship', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'

    const errors = addActionMarker(game, 'player-1', { q: 0, r: 0 })
    expect(errors.some((e) => e.includes('корабл'))).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('blocks removing action marker after another marker was resolved this turn', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: 0 })
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
    placeActionMarkerForTest(game, 'player-1', { q: 1, r: 0 })
    game.phase = 'actions'
    game.actionMarkerResolvedThisTurn = true

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
    addHorizontalLine(map, 3)
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])

    expect(toggleMarkerAtCell(game, 'player-1', { q: 0, r: 0 }, map, 'production')).toEqual([])
    expect(game.productionMarkers).toHaveLength(1)
  })

  it('rejects production marker in two-cell region (below destroyer minimum)', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ])

    const errors = addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes(String(MIN_VALID_PRODUCTION_REGION_SIZE)))).toBe(true)
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('maxProductionMarkersForPlayer uses purchased pool, not region count', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    expect(maxProductionMarkersForPlayer(game, 'player-1')).toBe(1)
    game.productionMarkerLimitByPlayer = { 'player-1': 3 }
    expect(maxProductionMarkersForPlayer(game, 'player-1')).toBe(3)
  })

  it('allows the second production marker in the same region without the overtime event', () => {
    const map = createEmptyMap()
    addHorizontalLine(map, 3)
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.productionMarkerLimitByPlayer = { 'player-1': 2 }
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])

    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(addProductionMarker(game, 'player-1', { q: 1, r: 0 }, map)).toEqual([])
    expect(game.productionMarkers).toHaveLength(2)
  })

  it('allows the second production marker after the pool is expanded', () => {
    const map = createEmptyMap()
    for (const startQ of [0, 10, 20]) {
      addHorizontalLine(map, 4, startQ)
    }
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.productionMarkerLimitByPlayer = { 'player-1': 2 }
    setPlayerControl(
      game,
      'player-1',
      game.cells.map((cell) => cell.coord),
    )

    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(addProductionMarker(game, 'player-1', { q: 10, r: 0 }, map)).toEqual([])
    expect(game.productionMarkers).toHaveLength(2)
    const errors = addProductionMarker(game, 'player-1', { q: 20, r: 0 }, map)
    expect(errors.some((error) => error.includes('Не более 2'))).toBe(true)
  })

  it('allows the third production marker after the pool is expanded to 3', () => {
    const map = createEmptyMap()
    for (const startQ of [0, 10, 20, 30, 40]) {
      addHorizontalLine(map, 4, startQ)
    }
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.productionMarkerLimitByPlayer = { 'player-1': 3 }
    setPlayerControl(
      game,
      'player-1',
      game.cells.map((cell) => cell.coord),
    )

    expect(addProductionMarker(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(addProductionMarker(game, 'player-1', { q: 10, r: 0 }, map)).toEqual([])
    expect(addProductionMarker(game, 'player-1', { q: 20, r: 0 }, map)).toEqual([])
    expect(game.productionMarkers).toHaveLength(3)
  })

  it('validateGalaxySave allows duplicate production markers per region', () => {
    const map = createEmptyMap()
    addHorizontalLine(map, 3)
    const game = gameSnapshotFromMap(map)
    game.productionMarkers.push(
      {
        id: 'prod-1',
        ownerId: 'player-1',
        coord: { q: 0, r: 0 },
        targetRegionId: 'region-player-1-0,0',
      },
      {
        id: 'prod-2',
        ownerId: 'player-1',
        coord: { q: 1, r: 0 },
        targetRegionId: 'region-player-1-0,0',
      },
    )
    const save = { ...galaxySaveFromMap(map), game }
    expect(validateGalaxySave(save).some((e) => e.includes('multiple production markers'))).toBe(false)
  })

  it('getRegionForMarker finds region by marker coord when targetRegionId is stale', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 2, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    game.cells[0].controlOwnerId = 'player-1'
    game.cells[1].controlOwnerId = 'player-1'
    game.cells[2].controlOwnerId = 'player-1'
    const marker = {
      id: 'prod-stale',
      ownerId: 'player-1',
      coord: { q: 1, r: 0 },
      targetRegionId: 'region-0',
    }
    game.productionMarkers.push(marker)

    const region = getRegionForMarker(game, map.id, marker)
    expect(region).not.toBeNull()
    expect(region!.hexes).toContain('1,0')
    expect(getBuildableShipsForMarker(game, map.id, 'player-1', marker.id).every((o) => o.disabledReason !== 'Регион маркера не найден')).toBe(true)
  })
})

describe('turn flow', () => {
  it('passes turn within planning before changing phase', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2', 'P3'])
    const order = activePlayerOrder(state.players, null, { state, phase: 'planning' })
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe(order[0])

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe(order[1])

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe(order[2])

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('actions')
    expect(state.activePlayerId).toBe(order[0])
  })

  it('keeps the same player order from planning through actions and production', () => {
    const map = createEmptyMap()
    addHorizontalLine(map, 3, 0, 0, 1)
    addHorizontalLine(map, 3, 5, 0, 2)
    map.cells.push({ q: 10, r: 0, startPlayer: 2 })
    const state = gameStateFromMap(map, ['P1', 'P2', 'P3'])

    for (const cell of state.cells) {
      if (cell.coord.q <= 2) cell.controlOwnerId = 'player-1'
      if (cell.coord.q >= 5 && cell.coord.q <= 7) cell.controlOwnerId = 'player-2'
      if (cell.coord.q === 10) cell.controlOwnerId = 'player-2'
    }

    const ctx = (phase: 'planning' | 'actions' | 'production') => ({ state, phase })
    const planning = activePlayerOrder(state.players, null, ctx('planning'))
    expect(planning).toHaveLength(3)
    expect(activePlayerOrder(state.players, null, ctx('actions'))).toEqual(planning)
    expect(activePlayerOrder(state.players, null, ctx('production'))).toEqual(planning)

    state.phase = 'planning'
    state.activePlayerId = planning[0]!
    advanceGamePhase(state)
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe(planning[1])
    advanceGamePhase(state)
    advanceGamePhase(state)
    expect(state.phase).toBe('actions')
    expect(state.activePlayerId).toBe(planning[0])
  })

  it('shuffles turn order by game turn, stable within planning/actions/production', () => {
    const map = createEmptyMap()
    map.cells = [
      { q: 0, r: 0, startPlayer: 1 },
      { q: 1, r: 0, startPlayer: 2 },
    ]
    const state = gameStateFromMap(map, ['P1', 'P2'])
    for (const cell of state.cells) cell.controlOwnerId = null

    const ctx = (turn: number, phase: 'events' | 'planning' | 'actions' | 'production') => ({
      state: { ...state, turnNumber: turn },
      phase,
    })
    const first = activePlayerOrder(state.players, null, ctx(1, 'planning'))
    expect(activePlayerOrder(state.players, null, ctx(1, 'planning'))).toEqual(first)
    expect(activePlayerOrder(state.players, null, ctx(1, 'events'))).toEqual(first)
    expect(activePlayerOrder(state.players, null, ctx(1, 'actions'))).toEqual(first)
    expect(activePlayerOrder(state.players, null, ctx(1, 'production'))).toEqual(first)

    const seen = new Set<string>()
    for (let turn = 1; turn <= 48; turn++) {
      seen.add(activePlayerOrder(state.players, null, ctx(turn, 'planning')).join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(seen.has('player-1,player-2')).toBe(true)
    expect(seen.has('player-2,player-1')).toBe(true)
  })

  it('skips non-participating players when only two joined', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromGameState(gameStateFromMap(map, ['P1', 'P2', 'P3']))
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.activePlayerId = 'player-1'

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    const actionsOrder = activePlayerOrder(game.players, game.participatingPlayerIds, {
      state: gameStateFromSnapshot(game, map.id),
      phase: 'actions',
    })
    expect(game.activePlayerId).toBe(actionsOrder[0])
  })

  it('passes turn within actions when no markers remain', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2'])
    state.phase = 'actions'
    const actionsOrder = activePlayerOrder(state.players, null, { state, phase: 'actions' })
    state.activePlayerId = actionsOrder[0]!

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('actions')
    expect(state.activePlayerId).toBe(actionsOrder[1])

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('events')
    expect(state.turnNumber).toBe(2)
  })

  it('actions phase wraps to first player while action markers remain', () => {
    const map = createEmptyMap()
    const base = gameStateFromMap(map, ['P1', 'P2'])
    base.phase = 'actions'
    base.activePlayerId = 'player-1'
    const game = gameSnapshotFromGameState(base)
    game.cells[0].controlOwnerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    expect(placeActionMarkerForTest(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    game.activePlayerId = 'player-2'

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    expect(game.activePlayerId).toBe('player-1')
    expect(game.actionMarkers).toHaveLength(1)
  })

  it('actions phase advances to events when all markers spent', () => {
    const map = createEmptyMap()
    const base = gameStateFromMap(map, ['P1', 'P2'])
    base.phase = 'actions'
    const actionsOrder = activePlayerOrder(base.players, null, { state: base, phase: 'actions' })
    base.activePlayerId = actionsOrder[actionsOrder.length - 1]!
    const game = gameSnapshotFromGameState(base)

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.turnNumber).toBe(2)
  })

  it('starts new turn with events after actions end', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2', 'P3'])
    state.phase = 'actions'
    state.turnNumber = 1
    const actionsOrder = activePlayerOrder(state.players, null, { state, phase: 'actions' })
    state.activePlayerId = actionsOrder[actionsOrder.length - 1]!

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('events')
    expect(state.turnNumber).toBe(2)
    expect(state.activePlayerId).toBe(
      activePlayerOrder(state.players, null, { state, phase: 'events' })[0],
    )
  })

  it('auto-applies the turn event and enters planning after actions', () => {
    const map = createEmptyMap()
    const base = gameStateFromMap(map, ['P1', 'P2'])
    base.phase = 'actions'
    base.turnNumber = 1
    const actionsOrder = activePlayerOrder(base.players, null, { state: base, phase: 'actions' })
    base.activePlayerId = actionsOrder[actionsOrder.length - 1]!
    const game = gameSnapshotFromGameState(base)
    game.eventDeck = ['empty-void', 'magnetic-storm']

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.turnNumber).toBe(2)
    expect(game.turnEvent?.eventId).toBe('empty-void')
    expect(isTurnEventResolved(game)).toBe(true)
    expect(game.activePlayerId).toBe(
      activePlayerOrder(game.players, null, {
        state: gameStateFromSnapshot(game, map.id),
        phase: 'planning',
      })[0],
    )
  })

  it('getLegalActionsForSnapshot auto-completes a leftover events phase', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'events'
    game.turnNumber = 2
    game.activePlayerId = 'player-1'
    game.eventDeck = ['magnetic-storm']

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(game.phase).toBe('planning')
    expect(isTurnEventResolved(game)).toBe(true)
    expect(game.turnEvent?.eventId).toBe('magnetic-storm')
    expect(actions.some((a) => a.id === 'advance-phase')).toBe(true)
  })

  it('events phase skips player rotation', () => {
    const state = gameStateFromMap(createEmptyMap(), ['P1', 'P2'])
    state.phase = 'events'
    state.activePlayerId = 'player-1'

    expect(advanceGamePhase(state)).toEqual([])
    expect(state.phase).toBe('planning')
    expect(state.activePlayerId).toBe(
      activePlayerOrder(state.players, null, { state, phase: 'planning' })[0],
    )
  })

  it('keeps markers and skips a planning player without actions', () => {
    const map = createEmptyMap()
    map.cells = [
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1 },
      { q: 1, r: 0, isPowerCenter: true, startPlayer: 2 },
    ]
    const game = gameSnapshotFromMap(map)
    game.activePlayerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    addActionMarker(game, 'player-1', { q: 0, r: 0 })

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.actionMarkers).toHaveLength(1)
    expect(game.players.find((p) => p.id === 'player-2')?.eliminated).toBeFalsy()
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
        { q: 0, r: -7, startPlayer: 1, isPowerCenter: true, startingShips: [{ type: 'destroyer', player: 1 }] },
        { q: 0, r: -6 },
        { q: 1, r: -6 },
        { q: 1, r: -7, startPlayer: 2, isPowerCenter: true },
        { q: 0, r: -5 },
        { q: 0, r: -4 },
        { q: 0, r: -3 },
        { q: 0, r: 0, startPlayer: 2, isPowerCenter: true },
      ],
    })
  }

  it('getShipMoveRange matches ships.yaml', () => {
    expect(getShipMoveRange('destroyer')).toBe(3)
    expect(getShipMoveRange('cruiser')).toBe(2)
    expect(getShipMoveRange('battleship')).toBe(1)
  })

  it('getReachableHexKeys uses game cells when map is smaller than state', () => {
    const map = createEmptyMap()
    const game = gameSnapshotFromMap({
      ...map,
      id: 'wide',
      name: 'wide',
      cells: [
        { q: 4, r: -1, startPlayer: 2, startingShips: [{ type: 'destroyer', player: 2 }] },
        { q: 3, r: -1 },
        { q: 5, r: -1, startPlayer: 2 },
      ],
    })
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.phase = 'actions'
    game.activePlayerId = 'player-2'
    placeActionMarkerForTest(game, 'player-2', { q: 4, r: -1 })

    const options = getMovableShipsAtMarker(game, map, 'player-2', { q: 4, r: -1 })
    expect(options.length).toBeGreaterThan(0)
    expect(options[0]?.reachableKeys.length).toBeGreaterThan(0)
    expect(options[0]?.disabledReason).toBeUndefined()
  })

  it('getReachableHexKeys cannot cross map holes (missing hexes)', () => {
    const gapMap = {
      id: 'gap',
      name: 'gap',
      cells: [
        { q: 0, r: 0 },
        { q: 2, r: 0 },
      ],
    }
    // Осевое расстояние 2, но гекса 1,0 нет — пути нет
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2)
    expect(hexPathDistance(new Set(['0,0', '2,0']), { q: 0, r: 0 }, { q: 2, r: 0 }, 3)).toBeNull()
    expect(getReachableHexKeys(gapMap, { q: 0, r: 0 }, 'destroyer')).not.toContain('2,0')

    const bridgeMap = {
      id: 'bridge',
      name: 'bridge',
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
    }
    expect(hexPathDistance(new Set(['0,0', '1,0', '2,0']), { q: 0, r: 0 }, { q: 2, r: 0 }, 3)).toBe(2)
    expect(getReachableHexKeys(bridgeMap, { q: 0, r: 0 }, 'destroyer')).toContain('2,0')
  })

  it('cannot path through enemy ships; can end move on them for combat', () => {
    const lineMap = {
      id: 'enemy-block',
      name: 'enemy-block',
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
    }
    const game = gameSnapshotFromMap(lineMap)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.ships = [
      { id: 'p1-dd', type: 'destroyer', ownerId: 'player-1' },
    ]
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.ships = [
      { id: 'p2-dd', type: 'destroyer', ownerId: 'player-2' },
    ]

    const keys = new Set(game.cells.map((c) => hexKey(c.coord.q, c.coord.r)))
    const blocks = (key: string) => {
      const [q, r] = key.split(',').map(Number)
      return isCombatDestination(game, 'player-1', { q: q!, r: r! })
    }

    // Через врага на B к C — нельзя
    expect(
      hexPathDistance(keys, { q: 0, r: 0 }, { q: 2, r: 0 }, 3, { blocksTransit: blocks }),
    ).toBeNull()
    expect(getReachableHexKeys(lineMap, { q: 0, r: 0 }, 'destroyer', game, 'player-1')).not.toContain(
      '2,0',
    )
    // На клетку с врагом — можно (бой)
    expect(
      hexPathDistance(keys, { q: 0, r: 0 }, { q: 1, r: 0 }, 3, { blocksTransit: blocks }),
    ).toBe(1)
    expect(getReachableHexKeys(lineMap, { q: 0, r: 0 }, 'destroyer', game, 'player-1')).toContain(
      '1,0',
    )

    const ship = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.ships[0]!
    expect(
      validateDestinationForMove(
        game,
        lineMap,
        'player-1',
        ship,
        { q: 0, r: 0 },
        { q: 2, r: 0 },
        false,
        [],
      ).length,
    ).toBeGreaterThan(0)
    expect(
      validateDestinationForMove(
        game,
        lineMap,
        'player-1',
        ship,
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        false,
        [],
      ),
    ).toEqual([])
  })

  it('treats absent player territory as neutral for movement', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.phase = 'actions'
    game.activePlayerId = 'player-2'
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.controlOwnerId = 'player-3'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'dd-p2',
      type: 'destroyer',
      ownerId: 'player-2',
    })
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.controlOwnerId = 'player-2'
    placeActionMarkerForTest(game, 'player-2', { q: 0, r: -7 })

    const options = getMovableShipsAtMarker(game, map, 'player-2', { q: 0, r: -7 })
    expect(options[0]?.reachableKeys).toContain('1,-6')
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
      id: 'dd-3',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

    const from = { q: 0, r: -7 }
    const { errors } = executeMarkerMovement(game, map, 'player-1', from, [
      { shipId: 'start-0--7-0', to: { q: 1, r: -6 } },
      { shipId: 'dd-2', to: { q: 0, r: -5 } },
      { shipId: 'dd-3', to: { q: 0, r: -4 } },
    ])
    expect(errors).toEqual([])

    const source = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!
    expect(source.ships.filter((s) => s.ownerId === 'player-1')).toHaveLength(0)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.ships).toHaveLength(1)
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!.controlOwnerId).toBeNull()
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!.ships).toHaveLength(1)
    expect(game.productionMarkers).toHaveLength(0)
    expect(source.actionMarkerId).toBeNull()
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('peaceful move onto empty hex does not take control', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'dd-p',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

    const { errors } = executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
      { shipId: 'dd-p', to: { q: 0, r: -4 } },
    ])
    expect(errors).toEqual([])

    const dest = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -4)!
    expect(dest.controlOwnerId).toBeNull()
    expect(dest.ships).toHaveLength(1)
    expect(dest.ships[0]?.type).toBe('destroyer')
  })

  it('destroyer walking onto empty enemy-controlled hex takes control immediately', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const dest = game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!
    dest.controlOwnerId = 'player-2'
    dest.ships = []
    dest.productionMarkerId = 'prod-p2'
    game.productionMarkers.push({
      id: 'prod-p2',
      ownerId: 'player-2',
      coord: { q: 1, r: -6 },
      targetRegionId: 'region-p2',
    })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id

    expect(
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 1, r: -6 } },
      ]).errors,
    ).toEqual([])

    expect(game.pendingCombat).toBeUndefined()
    expect(dest.controlOwnerId).toBe('player-1')
    expect(dest.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
    expect(dest.ships.some((s) => s.id === shipId)).toBe(true)
  })

  it('validateMarkerMovement allows contested cell in range and rejects out of range', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!.controlOwnerId = 'player-2'

    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 1, r: -6 } },
      ]),
    ).toEqual([])

    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 0, r: -3 } },
      ])[0],
    ).toMatch(/дальност|нет пути/i)
  })

  it('validateMarkerMovement rejects two combat destinations in one order', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const dd1 = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships.push({
      id: 'dd-2',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    const cellA = game.cells.find((c) => c.coord.q === 1 && c.coord.r === -6)!
    const cellB = game.cells.find((c) => c.coord.q === 1 && c.coord.r === -7)!
    cellA.controlOwnerId = 'player-2'
    cellA.ships.push({ id: 'enemy-a', type: 'destroyer', ownerId: 'player-2' })
    cellB.controlOwnerId = 'player-2'
    cellB.ships.push({ id: 'enemy-b', type: 'destroyer', ownerId: 'player-2' })

    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId: dd1, to: { q: 1, r: -6 } },
        { shipId: 'dd-2', to: { q: 1, r: -7 } },
      ]),
    ).toEqual([ONE_BATTLE_PER_MARKER_MSG])
  })

  it('getMovableShipsAtMarker lists player ships with ranges', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

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
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id

    const { errors } = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
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
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -5 })

    const shipAtFirst = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id
    expect(
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId: shipAtFirst, to: { q: 1, r: -6 } },
      ]).errors,
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
    placeActionMarkerForTest(game, 'player-2', { q: 0, r: 0 })

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.activePlayerId).toBe('player-2')
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('does not leave actions while markers remain after mid-order player resolves one', () => {
    const map = createEmptyMap('wrap-markers', 'wrap')
    map.cells = [
      { q: 0, r: 0, startPlayer: 1 },
      { q: 1, r: 0, startPlayer: 2 },
      { q: 2, r: 0, startPlayer: 2 },
      { q: 3, r: 0, startPlayer: 3 },
    ]
    const game = gameSnapshotFromMap(map)
    ensurePlayerSlots(game, 3)
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    game.phase = 'actions'
    const cell0 = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const cell1 = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    const cell2 = game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!
    const cell3 = game.cells.find((c) => c.coord.q === 3 && c.coord.r === 0)!
    cell0.controlOwnerId = 'player-1'
    cell0.isPowerCenter = true
    cell1.controlOwnerId = 'player-2'
    cell1.isPowerCenter = true
    cell2.controlOwnerId = 'player-2'
    cell2.isPowerCenter = true
    cell3.controlOwnerId = 'player-3'
    cell3.isPowerCenter = true
    cell0.ships = [{ id: 'p1', type: 'destroyer', ownerId: 'player-1' }]
    cell1.ships = [{ id: 'p2a', type: 'destroyer', ownerId: 'player-2' }]
    cell2.ships = [{ id: 'p2b', type: 'destroyer', ownerId: 'player-2' }]
    cell3.ships = [{ id: 'p3', type: 'destroyer', ownerId: 'player-3' }]
    placeActionMarkerForTest(game, 'player-2', { q: 1, r: 0 })
    placeActionMarkerForTest(game, 'player-2', { q: 2, r: 0 })

    game.activePlayerId = 'player-2'
    // Уже исполнил один маркер за круг; второй ещё на карте
    game.actionMarkerResolvedThisTurn = true
    expect(game.actionMarkers.filter((m) => m.ownerId === 'player-2')).toHaveLength(2)

    // player-2 передаёт ход; player-3 без маркеров → wrap, не production
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    expect(game.actionMarkers.length).toBe(2)
    expect(game.activePlayerId).toBe('player-2')
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('resets action marker resolution when entering actions phase', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    const planningOrder = activePlayerOrder(game.players, null, {
      state: gameStateFromSnapshot(game, map.id),
      phase: 'planning',
    })
    game.activePlayerId = planningOrder[planningOrder.length - 1]!
    game.actionMarkerResolvedThisTurn = true

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    const order = activePlayerOrder(game.players, null, {
      state: gameStateFromSnapshot(game, map.id),
      phase: 'actions',
    })
    expect(game.activePlayerId).toBe(order[0])
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('getLegalActionsForSnapshot notes when action marker already used', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((a) => a.id === 'action-marker-used')).toBe(true)
  })

  it('blocks advance-phase when own action markers are unresolved', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

    expect(advanceGameSnapshot(game, map.id)).toEqual([
      ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
    ])
    expect(game.activePlayerId).toBe('player-1')
    expect(game.phase).toBe('actions')
  })

  it('allows advance after executing action marker', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const shipId = game.cells.find((c) => c.coord.q === 0 && c.coord.r === -7)!.ships[0]!.id

    expect(
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: -7 }, [
        { shipId, to: { q: 1, r: -6 } },
      ]).errors,
    ).toEqual([])

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.turnNumber).toBe(2)
  })

  it('allows advance after removing all own action markers', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    const markerId = game.actionMarkers[0]!.id

    expect(removeActionMarker(game, markerId, 'player-1')).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('planning')
    expect(game.turnNumber).toBe(2)
  })

  it('removing an action marker in actions counts as the turn (cannot execute another)', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -5)!.controlOwnerId = 'player-1'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === -5)!.ships.push({
      id: 'dd-keep',
      type: 'destroyer',
      ownerId: 'player-1',
    })
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -5 })
    const discardId = game.actionMarkers.find(
      (m) => m.coord.q === 0 && m.coord.r === -7,
    )!.id

    expect(removeActionMarker(game, discardId, 'player-1')).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
    expect(game.actionMarkers).toHaveLength(1)

    const shipId = 'dd-keep'
    expect(
      validateMarkerMovement(game, map, 'player-1', { q: 0, r: -5 }, [
        { shipId, to: { q: 0, r: -4 } },
      ]),
    ).toEqual([ACTION_MARKER_ALREADY_RESOLVED_MSG])
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
  })

  it('removing an action marker in planning does not spend the actions-phase turn', () => {
    const map = createEmptyMap()
    map.cells[0]!.isPowerCenter = true
    map.cells[0]!.startPlayer = 1
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    addTestShip(game, 0, 0, 'player-1')
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    expect(removeActionMarker(game, game.actionMarkers[0]!.id, 'player-1')).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBeFalsy()
  })

  it('getLegalActionsForSnapshot omits advance-phase when action marker unresolved', () => {
    const map = movementTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeActionMarkerForTest(game, 'player-1', { q: 0, r: -7 })

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((a) => a.id === 'advance-phase')).toBe(false)
    expect(actions.some((a) => a.id === 'action-marker-unresolved')).toBe(true)
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
          resourceToken: { type: 'production', value: 4, faceUp: true },
        },
        { q: 2, r: 0, startPlayer: 2 },
      ],
    })
  }

  it('getShipProductionCost matches ships.yaml', () => {
    expect(getShipProductionCost('destroyer')).toEqual({ credits: 2, production: 2 })
    expect(getShipProductionCost('cruiser')).toEqual({ credits: 5, production: 3 })
  })

  it('MIN_VALID_PRODUCTION_REGION_SIZE matches destroyer minimum (rulebook marker slot)', () => {
    expect(MIN_VALID_PRODUCTION_REGION_SIZE).toBe(getShipProductionRegionMin('destroyer'))
    expect(MIN_VALID_PRODUCTION_REGION_SIZE).toBe(3)
  })

  it('canBuildShipInRegionSize uses minimum region size only', () => {
    expect(getShipProductionRegionMin('shield')).toBe(12)
    expect(getShipProductionRegionMin('battleship')).toBe(18)
    expect(getShipProductionRegionMin('hyper')).toBe(21)
    expect(getShipProductionRegionMin('cruiser')).toBe(5)
    expect(canBuildShipInRegionSize('destroyer', 2)).toBe(false)
    expect(canBuildShipInRegionSize('destroyer', 3)).toBe(true)
    expect(canBuildShipInRegionSize('destroyer', 10)).toBe(true)
    expect(canBuildShipInRegionSize('cruiser', 4)).toBe(false)
    expect(canBuildShipInRegionSize('cruiser', 5)).toBe(true)
  })

  it('executeProductionBatch spends tokens and places ships', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

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
    expect(game.actionMarkers).toHaveLength(0)
    expect(cell.actionMarkerId).toBeNull()
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('action marker build still pays from shared region when two markers overlap', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    ensureActionMarkerCapacity(game, 'player-1', 2)
    expect(placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(placeProductionMarkerForTest(game, 'player-1', { q: 1, r: 0 }, map)).toEqual([])
    expect(game.actionMarkers).toHaveLength(2)

    game.phase = 'actions'
    const first = game.actionMarkers[0]!
    const secondId = game.actionMarkers[1]!.id
    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: first.id,
      ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
    })
    expect(errors).toEqual([])
    expect(game.actionMarkers.some((m) => m.id === secondId)).toBe(true)
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.resourceTokens[0]?.faceUp).toBe(
      false,
    )
  })

  it('executeProductionBuild wrapper still works for single ship', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    const spent = autoAllocateTokens(game, map.id, marker, 2, 2)
    expect(spent).not.toBeNull()

    const errors = executeProductionBuild(game, map.id, 'player-1', {
      markerId: marker.id,
      shipType: 'destroyer',
      spentTokens: spent!,
    })
    expect(errors).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('places multiple ships on marker cell', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    const errors = executeProductionBatch(game, map.id, 'player-1', {
      markerId: marker.id,
      ships: [
        { type: 'destroyer', coord: { q: 0, r: 0 } },
        { type: 'destroyer', coord: { q: 0, r: 0 } },
      ],
    })
    expect(errors).toEqual([])

    const markerCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    expect(markerCell.ships.filter((s) => s.type === 'destroyer' && s.ownerId === 'player-1')).toHaveLength(3)
  })

  it('rejects ship placement outside marker cell', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    const errors = validateShipPlacements(game, map.id, marker, [
      { type: 'destroyer', coord: { q: 1, r: 0 } },
    ])
    expect(errors.some((e) => e.includes('только на клетку маркера'))).toBe(true)
  })

  it('needsProductionTokenChoice when face-up and face-down production coexist', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    expect(needsProductionTokenChoice(game, map.id, marker)).toBe(false)

    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.resourceTokens.push({
      type: 'production',
      value: 2,
      faceUp: false,
    })
    expect(needsProductionTokenChoice(game, map.id, marker)).toBe(true)
    expect(getRegionResourceSummary(game, map.id, marker).faceDownProductionCount).toBe(1)
  })

  it('executeProductionRecharge is disabled (automatic turn recharge)', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    const errors = executeProductionRecharge(game, map.id, 'player-1', { markerId: marker.id })
    expect(errors).toEqual(['Перезарядка фишек выполняется автоматически через случайный интервал один, два или три полных хода'])
  })

  it('validateProductionRecharge reports automatic recharge policy', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    expect(validateProductionRecharge(game, map.id, 'player-1', { markerId: marker.id })).toEqual([
      'Перезарядка фишек выполняется автоматически через случайный интервал один, два или три полных хода',
    ])
  })

  it('blocks second production marker build in the same turn', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

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
    ).toEqual([ACTION_MARKER_ALREADY_RESOLVED_MSG])
  })

  it('applyGameActionOnSnapshot executes production', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    const { errors } = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-production', {
      markerId: marker.id,
      ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
    })
    expect(errors).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('gameSnapshotFromObservation keeps ships after production action response', () => {
    const map = productionTestMap()
    const before = gameSnapshotFromMap(map)
    before.phase = 'actions'
    before.activePlayerId = 'player-1'
    placeProductionMarkerForTest(before, 'player-1', { q: 0, r: 0 }, map)
    const marker = before.actionMarkers[0]!

    const serverGame = structuredClone(before)
    expect(
      applyGameActionOnSnapshot(serverGame, map, 'player-1', 'execute-production', {
        markerId: marker.id,
        ships: [{ type: 'destroyer', coord: { q: 0, r: 0 } }],
      }).errors,
    ).toEqual([])

    const obs = buildObservation(
      {
        mapId: map.id,
        phase: serverGame.phase,
        turnNumber: serverGame.turnNumber,
        activePlayerId: serverGame.activePlayerId,
        players: serverGame.players,
        cells: serverGame.cells,
        eventLog: serverGame.eventLog,
        actionMarkers: serverGame.actionMarkers,
        productionMarkers: serverGame.productionMarkers,
        actionMarkerResolvedThisTurn: serverGame.actionMarkerResolvedThisTurn,
      },
      [],
      { geometry: false },
    )

    const synced = gameSnapshotFromObservation(obs.mechanics, before, map)
    const cell = synced.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    expect(cell.ships.some((s) => s.type === 'destroyer' && s.ownerId === 'player-1')).toBe(true)
    expect(synced.actionMarkers).toHaveLength(0)
  })

  it('does not allow passing while own action marker is unresolved', () => {
    const map = productionTestMap()
    addHorizontalLine(map, 3, 2, 0, 2)
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-2'
    setPlayerControl(game, 'player-2', [
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ])
    placeProductionMarkerForTest(game, 'player-2', { q: 2, r: 0 }, map)

    expect(advanceGameSnapshot(game, map.id)).toEqual([
      ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
    ])
    expect(game.phase).toBe('actions')
    expect(game.activePlayerId).toBe('player-2')
    expect(game.actionMarkerResolvedThisTurn).toBe(false)
  })

  it('getLegalActionsForSnapshot notes when action marker already used', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.actionMarkerResolvedThisTurn = true
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((a) => a.id === 'action-marker-used')).toBe(true)
  })

  it('blocks advance-phase when own action marker is unresolved', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)

    expect(advanceGameSnapshot(game, map.id)).toEqual([
      ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
    ])
    expect(game.activePlayerId).toBe('player-1')

    const actions = getLegalActionsForSnapshot(game, map.id, 'player-1')
    expect(actions.some((action) => action.id === 'advance-phase')).toBe(false)
    expect(actions.some((action) => action.id === 'action-marker-unresolved')).toBe(true)
  })

  it('skips players without action markers in actions phase', () => {
    const map = productionTestMap()
    addHorizontalLine(map, 3, 2, 0, 2)
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    setPlayerControl(game, 'player-2', [
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ])
    placeProductionMarkerForTest(game, 'player-2', { q: 2, r: 0 }, map)

    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.phase).toBe('actions')
    expect(game.activePlayerId).toBe('player-2')
  })

  function spreadShipsForPlayer(
    game: GameSnapshot,
    ownerId: string,
    type: ShipType,
    count: number,
    coords: { q: number; r: number }[],
  ) {
    let placed = 0
    for (const coord of coords) {
      while (placed < count) {
        const cell = game.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
        if (!cell) break
        if (cell.ships.filter((s) => s.ownerId === ownerId).length >= MAX_SHIPS_PER_CELL_PER_PLAYER) break
        addTestShip(game, coord.q, coord.r, ownerId, type)
        placed += 1
      }
      if (placed >= count) break
    }
  }

  function productionTestMapWide() {
    const map = productionTestMap()
    addHorizontalLine(map, 6, 3, 0, 1)
    return map
  }

  const fleetSpreadCoords = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: 3, r: 0 },
    { q: 4, r: 0 },
    { q: 5, r: 0 },
  ]

  it('getBuildableShipsForMarker disables ship type at fleet cap', () => {
    const map = productionTestMapWide()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    spreadShipsForPlayer(
      game,
      'player-1',
      'destroyer',
      MAX_FLEET_SIZE_PER_PLAYER.destroyer - 1,
      fleetSpreadCoords,
    )
    expect(countShipsForPlayer(game, 'player-1', 'destroyer')).toBe(
      MAX_FLEET_SIZE_PER_PLAYER.destroyer,
    )

    const destroyerOption = getBuildableShipsForMarker(
      game,
      map.id,
      'player-1',
      marker.id,
    ).find((o) => o.type === 'destroyer')!
    expect(destroyerOption.maxCount).toBe(0)
    expect(destroyerOption.fleetRemaining).toBe(0)
    expect(destroyerOption.disabledReason).toMatch(/Лимит флота/)
  })

  it('executeProductionBatch rejects build that would exceed fleet cap', () => {
    const map = productionTestMapWide()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const marker = game.actionMarkers[0]!

    spreadShipsForPlayer(
      game,
      'player-1',
      'destroyer',
      MAX_FLEET_SIZE_PER_PLAYER.destroyer - 1,
      fleetSpreadCoords,
    )

    expect(
      validateShipPlacements(game, map.id, marker, [
        { type: 'destroyer', coord: { q: 0, r: 0 } },
        { type: 'destroyer', coord: { q: 1, r: 0 } },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/лимит флота/i),
      ]),
    )

    const prodCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    prodCell.resourceTokens.push({ type: 'production', value: 3, faceUp: true })
    const spent = autoAllocateTokens(game, map.id, marker, 4, 4)
    expect(spent).not.toBeNull()

    expect(
      executeProductionBatch(game, map.id, 'player-1', {
        markerId: marker.id,
        ships: [
          { type: 'destroyer', coord: { q: 0, r: 0 } },
          { type: 'destroyer', coord: { q: 1, r: 0 } },
        ],
      }, spent!),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/лимит флота/i),
      ]),
    )
  })

  it('getFleetLimitWarnings reports overflow on map', () => {
    const map = productionTestMapWide()
    const game = gameSnapshotFromMap(map)
    spreadShipsForPlayer(
      game,
      'player-1',
      'hyper',
      MAX_FLEET_SIZE_PER_PLAYER.hyper + 1,
      fleetSpreadCoords,
    )
    expect(getFleetLimitWarnings(game).some((w) => w.includes('Гиперпространственное орудие'))).toBe(true)
  })

  it('removes an action marker for free even with zero tokens', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)
    const markerId = game.actionMarkers[0]!.id
    for (const cell of game.cells) cell.resourceTokens = []

    expect(removeActionMarker(game, markerId, 'player-1')).toEqual([])
    expect(game.actionMarkers).toHaveLength(0)
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
  })

  it('executeBuyProductionMarker is disabled', () => {
    const map = productionTestMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    expect(
      executeBuyProductionMarker(game, map.id, 'player-1', [
        { coord: { q: 0, r: 0 }, tokenIndex: 0 },
        { coord: { q: 0, r: 1 }, tokenIndex: 0 },
      ]),
    ).toEqual(['Маркеры производства отключены'])
  })

  it('still blocks removing a second action marker after one was resolved', () => {
    const map = productionTestMap()
    addHorizontalLine(map, 3, 10, 0)
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    ensureActionMarkerCapacity(game, 'player-1', 2)
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: 10, r: 0 },
      { q: 11, r: 0 },
      { q: 12, r: 0 },
    ])
    expect(placeProductionMarkerForTest(game, 'player-1', { q: 0, r: 0 }, map)).toEqual([])
    expect(placeProductionMarkerForTest(game, 'player-1', { q: 10, r: 0 }, map)).toEqual([])
    game.phase = 'actions'
    const firstId = game.actionMarkers[0]!.id
    const secondId = game.actionMarkers[1]!.id

    expect(removeActionMarker(game, firstId, 'player-1')).toEqual([])
    expect(removeActionMarker(game, secondId, 'player-1')).toEqual([
      ACTION_MARKER_REMOVE_BLOCKED_MSG,
    ])
  })
})

describe('scaffold', () => {
  it('passes', () => {
    expect(true).toBe(true)
  })
})
