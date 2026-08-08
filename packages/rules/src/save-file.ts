import { MAX_SHIPS_PER_CELL } from './constants.js'
import { PLAYER_COLORS } from './constants.js'
import { gameStateFromMap } from './game.js'
import { normalizeMapDefinition, validateMapDefinition } from './map-editor.js'
import { buildSpatialSummary } from './observation/ascii-map.js'
import {
  BASE_PRODUCTION_MARKERS_PER_PLAYER,
  isValidProductionRegionSize,
  productionMarkerUnlockRegionCountForPlayer,
  SECOND_PRODUCTION_MARKER_UNLOCK_REGION_COUNT,
  THIRD_PRODUCTION_MARKER_UNLOCK_REGION_COUNT,
} from './regions.js'
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

/**
 * Базовый маркер доступен всегда. Второй открывают 3, третий — 5 отдельных
 * контролируемых регионов от 4 клеток.
 */
export function maxProductionMarkersForPlayer(state: GameState, ownerId: string): number {
  const unlockRegionCount = productionMarkerUnlockRegionCountForPlayer(state, ownerId)
  return (
    BASE_PRODUCTION_MARKERS_PER_PLAYER
    + (unlockRegionCount >= SECOND_PRODUCTION_MARKER_UNLOCK_REGION_COUNT ? 1 : 0)
    + (unlockRegionCount >= THIRD_PRODUCTION_MARKER_UNLOCK_REGION_COUNT ? 1 : 0)
  )
}

export { validProductionRegionsForPlayer } from './regions.js'

export function countProductionMarkersForPlayer(game: GameSnapshot, ownerId: string): number {
  return game.productionMarkers.filter((m) => m.ownerId === ownerId).length
}

export interface PendingEvent {
  id: string
  type: string
  message: string
  resolved?: boolean
}

import type { CombatOptions, CombatPrepState, PendingCombatRoundState } from './combat.js'
import { migrateLegacyEventId, type EventCardId, type TurnEventState } from './events.js'
import type { GameOverState } from './victory.js'

export type { TurnEventState, GameOverState }

/**
 * Фаза боя между запросами. `rolling` и `finished` не сохраняются: бросок кубов
 * происходит синхронно внутри одного вызова, а завершённый бой — это
 * `pendingCombat === undefined`.
 */
export type PendingCombatPhase = 'prep' | 'awaiting-destruction' | 'awaiting-continue'

interface PendingCombatBase {
  cellKey: string
  attackerId: string
  defenderIds: string[]
  roundNumber: number
  trigger?: 'movement' | 'stack' | 'bombardment'
  combatOptions?: CombatOptions
  /**
   * За время текущего боя уже уничтожен хотя бы один корабль.
   * Пока false — отступление запрещено, стороны обязаны продолжать.
   */
  shipsDestroyedInCombat?: boolean
  /**
   * Контекст боя, начатого перемещением. Атакующие остаются на исходной клетке
   * до окончательного исхода боя, чтобы могли выбрать корректное отступление.
   */
  continuation?: {
    movementFrom: HexCoord
    movementPlans: Array<{ shipId: string; to: HexCoord; declareControl?: boolean }>
    incomingAttackerShipIds: string[]
  }
}

/** Ожидание готовности сторон перед первым раундом */
export interface PendingCombatPrep extends PendingCombatBase {
  phase: 'prep'
  prep: CombatPrepState
}

/** Победитель раунда выбирает корабли для уничтожения */
export interface PendingCombatAwaitingDestruction extends PendingCombatBase {
  phase: 'awaiting-destruction'
  roundState: PendingCombatRoundState
}

/** Стороны решают, продолжать бой или отступать */
export interface PendingCombatAwaitingContinue extends PendingCombatBase {
  phase: 'awaiting-continue'
  /** Решения продолжать бой; сначала атакующий, затем защитник. */
  continueDecisions: Partial<Record<'attacker' | 'defender', boolean>>
  roundState?: PendingCombatRoundState
}

/**
 * Дискриминированное объединение: поля, осмысленные только в одной фазе,
 * существуют только в её варианте. Комбинации вроде «prep и roundState
 * одновременно» больше не представимы в типах.
 */
export type PendingCombat =
  | PendingCombatPrep
  | PendingCombatAwaitingDestruction
  | PendingCombatAwaitingContinue

function cloneCombatPrep(prep: CombatPrepState): CombatPrepState {
  return {
    ...prep,
    readyBy: { ...prep.readyBy },
    combatOptions: {
      ...prep.combatOptions,
      attacker: prep.combatOptions.attacker ? { ...prep.combatOptions.attacker } : undefined,
      defender: prep.combatOptions.defender ? { ...prep.combatOptions.defender } : undefined,
      supportSides: prep.combatOptions.supportSides
        ? { ...prep.combatOptions.supportSides }
        : undefined,
    },
    movementFrom: prep.movementFrom ? { ...prep.movementFrom } : undefined,
    movementPlans: prep.movementPlans?.map((m) => ({ ...m, to: { ...m.to } })),
    bombardmentFrom: prep.bombardmentFrom ? { ...prep.bombardmentFrom } : undefined,
    bombardmentPlans: prep.bombardmentPlans?.map((p) => ({ ...p, target: { ...p.target } })),
    queuedBombardmentPlans: prep.queuedBombardmentPlans?.map((p) => ({
      ...p,
      target: { ...p.target },
    })),
    incomingAttackerShipIds: prep.incomingAttackerShipIds
      ? [...prep.incomingAttackerShipIds]
      : undefined,
  }
}

function cloneRoundState(rs: PendingCombatRoundState): PendingCombatRoundState {
  return {
    ...rs,
    rounds: rs.rounds.map((r) => ({ ...r, shipRolls: r.shipRolls.map((sr) => ({ ...sr })) })),
    combatOptions: { ...rs.combatOptions },
    incomingAttackerShipIds: [...rs.incomingAttackerShipIds],
    attackerSkipTypes: [...rs.attackerSkipTypes],
    defenderSkipTypes: [...rs.defenderSkipTypes],
    movementFrom: rs.movementFrom ? { ...rs.movementFrom } : undefined,
    movementPlans: rs.movementPlans?.map((m) => ({ ...m, to: { ...m.to } })),
    bombardmentFrom: rs.bombardmentFrom ? { ...rs.bombardmentFrom } : undefined,
    bombardmentPlans: rs.bombardmentPlans?.map((p) => ({ ...p, target: { ...p.target } })),
    queuedBombardmentPlans: rs.queuedBombardmentPlans?.map((p) => ({
      ...p,
      target: { ...p.target },
    })),
  }
}

export function clonePendingCombat(pending: PendingCombat | undefined): PendingCombat | undefined {
  if (!pending) return undefined
  const base = {
    cellKey: pending.cellKey,
    attackerId: pending.attackerId,
    defenderIds: [...pending.defenderIds],
    roundNumber: pending.roundNumber,
    trigger: pending.trigger,
    combatOptions: pending.combatOptions ? { ...pending.combatOptions } : undefined,
    shipsDestroyedInCombat: pending.shipsDestroyedInCombat,
    continuation: pending.continuation
      ? {
          movementFrom: { ...pending.continuation.movementFrom },
          movementPlans: pending.continuation.movementPlans.map((m) => ({ ...m, to: { ...m.to } })),
          incomingAttackerShipIds: [...pending.continuation.incomingAttackerShipIds],
        }
      : undefined,
  }

  switch (pending.phase) {
    case 'prep':
      return { ...base, phase: 'prep', prep: cloneCombatPrep(pending.prep) }
    case 'awaiting-destruction':
      return {
        ...base,
        phase: 'awaiting-destruction',
        roundState: cloneRoundState(pending.roundState),
      }
    case 'awaiting-continue':
      return {
        ...base,
        phase: 'awaiting-continue',
        continueDecisions: { ...pending.continueDecisions },
        roundState: pending.roundState ? cloneRoundState(pending.roundState) : undefined,
      }
  }
}

/**
 * Сохранения до введения `phase` кодировали фазу тремя независимыми флагами.
 * Выводим дискриминатор из них, чтобы старые файлы и комнаты открывались.
 */
export function migrateLegacyPendingCombat(raw: unknown): PendingCombat | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const legacy = raw as Record<string, unknown>
  if (typeof legacy.phase === 'string') return raw as PendingCombat

  const base = {
    cellKey: String(legacy.cellKey ?? ''),
    attackerId: String(legacy.attackerId ?? ''),
    defenderIds: Array.isArray(legacy.defenderIds) ? (legacy.defenderIds as string[]) : [],
    roundNumber: typeof legacy.roundNumber === 'number' ? legacy.roundNumber : 1,
    trigger: legacy.trigger as PendingCombat['trigger'],
    combatOptions: legacy.combatOptions as PendingCombat['combatOptions'],
    shipsDestroyedInCombat: legacy.shipsDestroyedInCombat === true,
    continuation: legacy.continuation as PendingCombat['continuation'],
  }

  if (legacy.prep) {
    return { ...base, phase: 'prep', prep: legacy.prep as CombatPrepState }
  }
  if (legacy.awaitingDestruction && legacy.roundState) {
    return {
      ...base,
      phase: 'awaiting-destruction',
      roundState: legacy.roundState as PendingCombatRoundState,
    }
  }
  if (legacy.awaitingContinue) {
    return {
      ...base,
      phase: 'awaiting-continue',
      continueDecisions:
        (legacy.continueDecisions as PendingCombatAwaitingContinue['continueDecisions']) ?? {},
      roundState: legacy.roundState as PendingCombatRoundState | undefined,
    }
  }
  // Бой без распознаваемой фазы восстановить нельзя — безопаснее снять его,
  // чем оставить игроков в заблокированном состоянии.
  return undefined
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
  /** Кто реально в игре (остальные слоты карты пропускаются в очереди хода) */
  participatingPlayerIds?: string[]
  /** Глобальное событие текущего хода (одно на всех игроков) */
  turnEvent?: TurnEventState
  /**
   * Оставшиеся карты событий (верх колоды — индекс 0).
   * Пустая / отсутствующая колода при следующей вытяжке перетасовывается заново.
   */
  eventDeck?: EventCardId[]
  /** Игра завершена */
  gameOver?: GameOverState
  /** Незавершённый многoroundовый бой */
  pendingCombat?: PendingCombat
  /** Регион сверхурочных на игрока (событие «Обязательные сверхурочные») */
  overtimeRegionByPlayer?: Record<string, string>
  /** Потраченные фишки производства за ход (событие «Всё для фронта») */
  productionTokensSpentThisTurn?: Record<string, number>
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

/** Дополняет список игроков до slotCount (player-1 … player-N) */
export function ensurePlayerSlots(game: GameSnapshot, slotCount: number): void {
  while (game.players.length < slotCount) {
    const n = game.players.length + 1
    game.players.push({
      id: `player-${n}`,
      name: `Игрок ${n}`,
      color: PLAYER_COLORS[n] ?? '#888',
      isAi: false,
      eliminated: false,
    })
  }
}

export function syncParticipatingPlayerIds(game: GameSnapshot, joinedPlayerIds: string[]): void {
  game.participatingPlayerIds = [...joinedPlayerIds]
  ensureActivePlayerParticipating(game)
}

export function ensureActivePlayerParticipating(game: GameSnapshot): void {
  const ids = game.participatingPlayerIds
  if (!ids?.length) return
  if (game.activePlayerId && ids.includes(game.activePlayerId)) return
  game.activePlayerId = ids[0] ?? null
}

/** Первые maxPlayers участников из сохранения для online-лобби */
export function participatingPlayerIdsForLobby(
  game: GameSnapshot,
  maxPlayers: number,
): string[] {
  const all = game.players.map((p) => p.id)
  const fromSave = game.participatingPlayerIds?.filter((id) => all.includes(id))
  const base = fromSave?.length ? fromSave : all
  return base.slice(0, Math.max(1, Math.min(maxPlayers, all.length)))
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
  const map = normalizeMapDefinition(save.map)
  const normalized: GalaxySaveFile = {
    format: GALAXY_SAVE_FORMAT,
    version: GALAXY_SAVE_VERSION,
    savedAt: save.savedAt || new Date().toISOString(),
    map,
    game: save.game ? normalizeGameSnapshot(save.game, map) : undefined,
  }
  return normalized
}

function normalizeGameSnapshot(game: GameSnapshot, map?: MapDefinition): GameSnapshot {
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

  const normalized: GameSnapshot = {
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
    participatingPlayerIds: game.participatingPlayerIds
      ? [...game.participatingPlayerIds]
      : undefined,
    turnEvent: game.turnEvent
      ? {
          ...game.turnEvent,
          eventId: migrateLegacyEventId(String(game.turnEvent.eventId)),
        }
      : undefined,
    eventDeck: Array.isArray(game.eventDeck)
      ? game.eventDeck.map((id) => migrateLegacyEventId(String(id)))
      : undefined,
    gameOver: game.gameOver ? { ...game.gameOver } : undefined,
    pendingCombat: clonePendingCombat(migrateLegacyPendingCombat(game.pendingCombat)),
    overtimeRegionByPlayer: game.overtimeRegionByPlayer
      ? { ...game.overtimeRegionByPlayer }
      : undefined,
    productionTokensSpentThisTurn: game.productionTokensSpentThisTurn
      ? { ...game.productionTokensSpentThisTurn }
      : undefined,
  }

  if (map) refreshProductionMarkerRegionIds(normalized, map)
  return normalized
}

function refreshProductionMarkerRegionIds(game: GameSnapshot, map: MapDefinition): void {
  if (game.productionMarkers.length === 0) return
  const state = gameStateFromSnapshot(game, map.id)
  for (const marker of game.productionMarkers) {
    const regionId = resolveRegionIdForCell(state, marker.coord, marker.ownerId)
    if (regionId) marker.targetRegionId = regionId
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
  if (!region || !isValidProductionRegionSize(region.size)) return null
  return region.id
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
        `Player ${player.id}: ${count} production markers exceeds unlocked limit ${limit}`,
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
    // Владелец контроля намеренно не связан с владельцем кораблей: контроль
    // переходит только при полном вытеснении защитника. После отступления на
    // клетке стоят корабли атакующего, а контроль остаётся за защитником —
    // это легальное состояние, и раньше оно ломало загрузку сохранения.
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

/**
 * Если сервер включил поле в mechanics (даже null) — берём его; иначе сохраняем локальное.
 * null трактуется как «очищено» (undefined в snapshot).
 */
export function fromObservationField<T>(
  mechanics: Record<string, unknown>,
  key: string,
  preserve: T | undefined,
): T | undefined {
  if (!(key in mechanics)) return preserve
  const value = mechanics[key] as T | null
  return value === null ? undefined : value
}

/** Sync server observation into snapshot; with full server markers replaces local state */
export function gameSnapshotFromObservation(
  mechanics: {
    phase: Phase
    turnNumber: number
    activePlayerId: string | null
    players: PlayerState[]
    cells: CellState[]
    actionMarkers?: ActionMarker[]
    productionMarkers?: ProductionMarker[]
    actionMarkerResolvedThisTurn?: boolean
    productionMarkerResolvedThisTurn?: boolean
  },
  preserve?: GameSnapshot,
  map?: MapDefinition,
): GameSnapshot {
  const hasServerMarkers = Array.isArray(mechanics.actionMarkers)
  const mech = mechanics as Record<string, unknown>

  const game = normalizeGameSnapshot({
    phase: mechanics.phase,
    turnNumber: mechanics.turnNumber,
    activePlayerId: mechanics.activePlayerId,
    players: mechanics.players,
    cells: mechanics.cells.map((c) => {
      const runtime = c as RuntimeCellState
      return {
        coord: { q: c.coord.q, r: c.coord.r },
        isPowerCenter: c.isPowerCenter,
        controlOwnerId: c.controlOwnerId,
        resourceTokens: c.resourceTokens ?? [],
        ships: c.ships ?? [],
        actionMarkerId: hasServerMarkers ? (runtime.actionMarkerId ?? null) : null,
        productionMarkerId: hasServerMarkers ? (runtime.productionMarkerId ?? null) : null,
      }
    }),
    eventLog: fromObservationField(mech, 'eventLog', preserve?.eventLog) ?? [],
    pendingEvents: preserve?.pendingEvents ?? [],
    actionMarkers: hasServerMarkers ? (mechanics.actionMarkers ?? []) : (preserve?.actionMarkers ?? []),
    productionMarkers: hasServerMarkers
      ? (mechanics.productionMarkers ?? [])
      : (preserve?.productionMarkers ?? []),
    actionMarkerResolvedThisTurn: hasServerMarkers
      ? (mechanics.actionMarkerResolvedThisTurn ?? false)
      : false,
    productionMarkerResolvedThisTurn: hasServerMarkers
      ? (mechanics.productionMarkerResolvedThisTurn ?? false)
      : false,
    participatingPlayerIds: hasServerMarkers
      ? (fromObservationField(mech, 'participatingPlayerIds', preserve?.participatingPlayerIds)
        ?? preserve?.participatingPlayerIds)
      : preserve?.participatingPlayerIds,
    turnEvent: fromObservationField(mech, 'turnEvent', preserve?.turnEvent),
    eventDeck: fromObservationField(mech, 'eventDeck', preserve?.eventDeck),
    productionTokensSpentThisTurn: fromObservationField(
      mech,
      'productionTokensSpentThisTurn',
      preserve?.productionTokensSpentThisTurn,
    ),
    overtimeRegionByPlayer: fromObservationField(
      mech,
      'overtimeRegionByPlayer',
      preserve?.overtimeRegionByPlayer,
    ),
    pendingCombat: fromObservationField(mech, 'pendingCombat', preserve?.pendingCombat),
    gameOver: fromObservationField(mech, 'gameOver', preserve?.gameOver),
  }, map)

  if (hasServerMarkers || !preserve) return game

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
