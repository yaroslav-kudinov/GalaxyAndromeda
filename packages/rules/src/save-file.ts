import { MAX_SHIPS_PER_CELL } from './constants.js'
import { gameStateFromMap } from './game.js'
import { normalizeMapDefinition, validateMapDefinition } from './map-editor.js'
import { buildSpatialSummary } from './observation/ascii-map.js'
import { syncActionMarkerTurnTracking, syncProductionMarkerTurnTracking } from './markers.js'
import type {
  CellState,
  GameEvent,
  GameState,
  HexCoord,
  MapDefinition,
  Phase,
  PlayerState,
} from './types.js'
import { hexKey, parseHexKey } from './types.js'

export const GALAXY_SAVE_FORMAT = 'galaxy-save' as const
export const GALAXY_SAVE_VERSION = 1 as const
export const MAX_ACTION_MARKERS_PER_PLAYER = 6

/** Максимум маркеров производства = число контролируемых регионов (1 маркер на регион) */
export function maxProductionMarkersForPlayer(state: GameState, ownerId: string): number {
  const summary = buildSpatialSummary(state)
  return summary.regions.filter((r) => r.ownerId === ownerId).length
}

export function countProductionMarkersForPlayer(game: GameSnapshot, ownerId: string): number {
  return game.productionMarkers.filter((m) => m.ownerId === ownerId).length
}

export interface PendingEvent {
  id: string
  type: string
  message: string
  resolved?: boolean
}

export interface ActionMarker {
  id: string
  ownerId: string
  coord: HexCoord
  placedInPhase: 'planning' | 'actions'
}

export interface ProductionMarker {
  id: string
  ownerId: string
  coord: HexCoord
  targetRegionId: string
}

export interface RuntimeCellState extends CellState {
  actionMarkerId?: string | null
  productionMarkerId?: string | null
}

export interface GameSnapshot {
  phase: Phase
  turnNumber: number
  activePlayerId: string | null
  players: PlayerState[]
  cells: RuntimeCellState[]
  eventLog: GameEvent[]
  pendingEvents: PendingEvent[]
  actionMarkers: ActionMarker[]
  productionMarkers: ProductionMarker[]
  /** Активный игрок уже исполнил маркер действия в текущем ходу фазы «Действия» */
  actionMarkerResolvedThisTurn?: boolean
  /** Активный игрок уже построил по маркеру в текущем ходу фазы «Производство» */
  productionMarkerResolvedThisTurn?: boolean
}

export interface GalaxySaveFile {
  format: typeof GALAXY_SAVE_FORMAT
  version: typeof GALAXY_SAVE_VERSION
  savedAt: string
  map: MapDefinition
  game?: GameSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isGalaxySaveFile(value: unknown): value is GalaxySaveFile {
  return isRecord(value) && value.format === GALAXY_SAVE_FORMAT && value.version === GALAXY_SAVE_VERSION
}

export function isLegacyMapDefinition(value: unknown): value is MapDefinition {
  if (!isRecord(value)) return false
  if (value.format === GALAXY_SAVE_FORMAT) return false
  return typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.cells)
}

export function isMapOnlySave(save: GalaxySaveFile): boolean {
  return save.game == null
}

export function galaxySaveFromMap(map: MapDefinition, savedAt = new Date().toISOString()): GalaxySaveFile {
  return {
    format: GALAXY_SAVE_FORMAT,
    version: GALAXY_SAVE_VERSION,
    savedAt,
    map: normalizeMapDefinition(map),
  }
}

export function gameSnapshotFromGameState(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    players: state.players.map((p) => ({ ...p })),
    cells: state.cells.map((c) => ({
      ...c,
      resourceTokens: c.resourceTokens.map((t) => ({ ...t })),
      ships: c.ships.map((s) => ({ ...s })),
      actionMarkerId: null,
      productionMarkerId: null,
    })),
    eventLog: state.eventLog.map((e) => ({ ...e })),
    pendingEvents: [],
    actionMarkers: [],
    productionMarkers: [],
    actionMarkerResolvedThisTurn: false,
    productionMarkerResolvedThisTurn: false,
  }
}

export function galaxySaveFromGameState(
  map: MapDefinition,
  state: GameState,
  savedAt = new Date().toISOString(),
): GalaxySaveFile {
  return {
    format: GALAXY_SAVE_FORMAT,
    version: GALAXY_SAVE_VERSION,
    savedAt,
    map: normalizeMapDefinition(map),
    game: gameSnapshotFromGameState(state),
  }
}

export function gameStateFromSnapshot(snapshot: GameSnapshot, mapId: string): GameState {
  return {
    mapId,
    phase: snapshot.phase,
    turnNumber: snapshot.turnNumber,
    activePlayerId: snapshot.activePlayerId,
    players: snapshot.players,
    cells: snapshot.cells.map(({ actionMarkerId: _a, productionMarkerId: _p, ...cell }) => cell),
    eventLog: snapshot.eventLog,
  }
}

export function parseGalaxySave(raw: unknown): GalaxySaveFile {
  if (isGalaxySaveFile(raw)) {
    return normalizeGalaxySave(raw)
  }
  if (isLegacyMapDefinition(raw)) {
    return galaxySaveFromMap(normalizeMapDefinition(raw))
  }
  throw new Error('Unrecognized save format: expected galaxy-save or MapDefinition JSON')
}

export function normalizeGalaxySave(save: GalaxySaveFile): GalaxySaveFile {
  const normalized: GalaxySaveFile = {
    format: GALAXY_SAVE_FORMAT,
    version: GALAXY_SAVE_VERSION,
    savedAt: save.savedAt || new Date().toISOString(),
    map: normalizeMapDefinition(save.map),
    game: save.game ? normalizeGameSnapshot(save.game) : undefined,
  }
  return normalized
}

function normalizeGameSnapshot(game: GameSnapshot): GameSnapshot {
  const cells: RuntimeCellState[] = game.cells.map((c) => ({
    coord: { q: c.coord.q, r: c.coord.r },
    isPowerCenter: !!c.isPowerCenter,
    controlOwnerId: c.controlOwnerId ?? null,
    resourceTokens: c.resourceTokens ?? [],
    ships: c.ships ?? [],
    actionMarkerId: c.actionMarkerId ?? null,
    productionMarkerId: c.productionMarkerId ?? null,
  }))

  const actionMarkers = (game.actionMarkers ?? []).map((m) => ({ ...m, coord: { ...m.coord } }))
  const productionMarkers = (game.productionMarkers ?? []).map((m) => ({ ...m, coord: { ...m.coord } }))

  syncMarkerRefs(cells, actionMarkers, productionMarkers)

  return {
    phase: game.phase,
    turnNumber: game.turnNumber,
    activePlayerId: game.activePlayerId ?? null,
    players: game.players ?? [],
    cells,
    eventLog: game.eventLog ?? [],
    pendingEvents: game.pendingEvents ?? [],
    actionMarkers,
    productionMarkers,
    actionMarkerResolvedThisTurn: game.actionMarkerResolvedThisTurn ?? false,
    productionMarkerResolvedThisTurn: game.productionMarkerResolvedThisTurn ?? false,
  }
}

function syncMarkerRefs(
  cells: RuntimeCellState[],
  actionMarkers: ActionMarker[],
  productionMarkers: ProductionMarker[],
): void {
  const cellByKey = new Map(cells.map((c) => [hexKey(c.coord.q, c.coord.r), c]))
  for (const cell of cells) {
    cell.actionMarkerId = null
    cell.productionMarkerId = null
  }
  for (const marker of actionMarkers) {
    const cell = cellByKey.get(hexKey(marker.coord.q, marker.coord.r))
    if (cell) cell.actionMarkerId = marker.id
  }
  for (const marker of productionMarkers) {
    const cell = cellByKey.get(hexKey(marker.coord.q, marker.coord.r))
    if (cell) cell.productionMarkerId = marker.id
  }
}

export function serializeGalaxySave(save: GalaxySaveFile, pretty = true): string {
  const normalized = normalizeGalaxySave(save)
  return JSON.stringify(normalized, null, pretty ? 2 : undefined)
}

export function resolveRegionIdForCell(state: GameState, coord: HexCoord, ownerId: string): string | null {
  const summary = buildSpatialSummary(state)
  const key = hexKey(coord.q, coord.r)
  const region = summary.regions.find(
    (r) => r.ownerId === ownerId && r.hexes.includes(key),
  )
  return region?.id ?? null
}

export function validateGalaxySave(save: GalaxySaveFile): string[] {
  const errors = [...validateMapDefinition(save.map)]
  if (save.format !== GALAXY_SAVE_FORMAT) errors.push('Invalid format field')
  if (save.version !== GALAXY_SAVE_VERSION) errors.push(`Unsupported save version: ${save.version}`)
  if (!save.savedAt?.trim()) errors.push('Missing savedAt timestamp')
  if (!save.game) return errors

  const gameErrors = validateGameSnapshot(save.game, save.map)
  return [...errors, ...gameErrors]
}

export function validateGameSnapshot(game: GameSnapshot, map: MapDefinition): string[] {
  const errors: string[] = []
  const mapKeys = new Set(map.cells.map((c) => hexKey(c.q, c.r)))
  const cellKeys = new Set<string>()

  for (const cell of game.cells) {
    const key = hexKey(cell.coord.q, cell.coord.r)
    if (!mapKeys.has(key)) errors.push(`Game cell ${key} not on map`)
    if (cellKeys.has(key)) errors.push(`Duplicate game cell ${key}`)
    cellKeys.add(key)

    if (cell.ships.length > MAX_SHIPS_PER_CELL) {
      errors.push(`${key}: too many ships (${cell.ships.length})`)
    }
  }

  const actionByCell = new Map<string, string>()
  const actionByPlayer = new Map<string, number>()

  for (const marker of game.actionMarkers) {
    const key = hexKey(marker.coord.q, marker.coord.r)
    if (actionByCell.has(key)) errors.push(`${key}: multiple action markers`)
    actionByCell.set(key, marker.ownerId)

    const count = (actionByPlayer.get(marker.ownerId) ?? 0) + 1
    actionByPlayer.set(marker.ownerId, count)
    if (count > MAX_ACTION_MARKERS_PER_PLAYER) {
      errors.push(`Player ${marker.ownerId}: more than ${MAX_ACTION_MARKERS_PER_PLAYER} action markers`)
    }
    if (marker.placedInPhase !== 'planning' && marker.placedInPhase !== 'actions') {
      errors.push(`Action marker ${marker.id}: invalid placedInPhase`)
    }
  }

  const productionByCell = new Map<string, string>()
  const productionByRegion = new Map<string, string>()
  for (const marker of game.productionMarkers) {
    const key = hexKey(marker.coord.q, marker.coord.r)
    if (productionByCell.has(key)) errors.push(`${key}: multiple production markers`)
    productionByCell.set(key, marker.ownerId)

    const regionKey = `${marker.ownerId}:${marker.targetRegionId}`
    if (productionByRegion.has(regionKey)) {
      errors.push(`Region ${marker.targetRegionId}: multiple production markers for ${marker.ownerId}`)
    }
    productionByRegion.set(regionKey, marker.id)

    if (!marker.targetRegionId?.trim()) {
      errors.push(`Production marker ${marker.id}: missing targetRegionId`)
    }
  }

  for (const player of game.players) {
    const state = gameStateFromSnapshot(game, map.id)
    const limit = maxProductionMarkersForPlayer(state, player.id)
    const count = game.productionMarkers.filter((m) => m.ownerId === player.id).length
    if (count > limit) {
      errors.push(
        `Player ${player.id}: ${count} production markers exceeds ${limit} controlled regions`,
      )
    }
  }

  for (const cell of game.cells) {
    const key = hexKey(cell.coord.q, cell.coord.r)
    if (cell.actionMarkerId && !game.actionMarkers.some((m) => m.id === cell.actionMarkerId)) {
      errors.push(`${key}: unknown actionMarkerId ${cell.actionMarkerId}`)
    }
    if (cell.productionMarkerId && !game.productionMarkers.some((m) => m.id === cell.productionMarkerId)) {
      errors.push(`${key}: unknown productionMarkerId ${cell.productionMarkerId}`)
    }
  }

  if (game.phase !== 'planning' && game.phase !== 'actions') {
    if (game.actionMarkers.length > 0 && game.phase === 'production') {
      // allowed to carry markers between phases in save — no error
    }
  }

  return errors
}

/** Build initial game snapshot from map (for new game / dev) */
export function gameSnapshotFromMap(map: MapDefinition): GameSnapshot {
  return gameSnapshotFromGameState(gameStateFromMap(map))
}

/** Sync server observation into snapshot, preserving local markers */
export function gameSnapshotFromObservation(
  mechanics: {
    phase: Phase
    turnNumber: number
    activePlayerId: string | null
    players: PlayerState[]
    cells: CellState[]
  },
  preserve?: GameSnapshot,
): GameSnapshot {
  const game = normalizeGameSnapshot({
    phase: mechanics.phase,
    turnNumber: mechanics.turnNumber,
    activePlayerId: mechanics.activePlayerId,
    players: mechanics.players,
    cells: mechanics.cells.map((c) => ({
      coord: { q: c.coord.q, r: c.coord.r },
      isPowerCenter: c.isPowerCenter,
      controlOwnerId: c.controlOwnerId,
      resourceTokens: c.resourceTokens ?? [],
      ships: c.ships ?? [],
      actionMarkerId: null,
      productionMarkerId: null,
    })),
    eventLog: preserve?.eventLog ?? [],
    pendingEvents: preserve?.pendingEvents ?? [],
    actionMarkers: preserve?.actionMarkers ?? [],
    productionMarkers: preserve?.productionMarkers ?? [],
    actionMarkerResolvedThisTurn: false,
    productionMarkerResolvedThisTurn: false,
  })

  if (!preserve) return game

  if (
    preserve.phase === game.phase &&
    preserve.activePlayerId === game.activePlayerId &&
    game.phase === 'actions'
  ) {
    game.actionMarkerResolvedThisTurn = preserve.actionMarkerResolvedThisTurn ?? false
  } else {
    syncActionMarkerTurnTracking(game, preserve.phase, preserve.activePlayerId)
  }

  if (
    preserve.phase === game.phase &&
    preserve.activePlayerId === game.activePlayerId &&
    game.phase === 'production'
  ) {
    game.productionMarkerResolvedThisTurn = preserve.productionMarkerResolvedThisTurn ?? false
  } else {
    syncProductionMarkerTurnTracking(game, preserve.phase, preserve.activePlayerId)
  }

  return game
}

export { parseHexKey }
