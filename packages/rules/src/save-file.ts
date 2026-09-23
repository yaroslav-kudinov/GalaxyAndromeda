import { MAX_SHIPS_PER_CELL, PLAYER_COLORS, SHIP_TYPES } from './constants.js'
import { gameStateFromMap } from './game.js'
import { normalizeMapDefinition, validateMapDefinition } from './map-editor.js'
import { buildSpatialSummary } from './observation/ascii-map.js'
import { isValidProductionRegionSize } from './regions.js'
import {
  actionMarkerLimitForPlayer,
  ensureMarkerLimits,
  productionMarkerLimitForPlayer,
} from './marker-pools.js'
import { syncActionMarkerTurnTracking, syncProductionMarkerTurnTracking } from './markers.js'
import type {
  CellState,
  GameEvent,
  GameState,
  HexCoord,
  MapDefinition,
  Phase,
  PlayerState,
  ShipType,
} from './types.js'
import { hexKey, parseHexKey } from './types.js'


export const GALAXY_SAVE_FORMAT = 'galaxy-save' as const
/**
 * Версия 2 — пересборка ядра: бюджет перезарядки вместо интервала, порог победы из карты,
 * постоянные маркеры действия, осада, доктрины, бой на попаданиях. Партии версии 1 по новым
 * правилам неиграбельны, поэтому миграции нет — они отклоняются с явным сообщением.
 */
export const GALAXY_SAVE_VERSION = 2 as const

const WINDOWS_ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g
const MAX_GALAXY_SAVE_DOWNLOAD_BASE_LEN = 120

function sanitizeGalaxySaveDownloadBase(raw: string): string {
  return raw
    .replace(/\.(galaxy\.)?json$/i, '')
    .replace(WINDOWS_ILLEGAL_FILENAME_CHARS, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_GALAXY_SAVE_DOWNLOAD_BASE_LEN)
    .replace(/[. ]+$/g, '')
    .trim()
}

/**
 * Имя файла для скачивания сохранения: отображаемое название карты, не id.
 * Русские буквы оставляем как есть; недопустимые в Windows символы заменяем на `_`.
 * Если название пустое — fallback на id. Расширение всегда `.galaxy.json`.
 */
export function galaxySaveDownloadFileName(
  displayName: string | undefined | null,
  fallbackId: string,
): string {
  const fromName = sanitizeGalaxySaveDownloadBase(displayName ?? '')
  if (fromName) return `${fromName}.galaxy.json`
  const fromId = sanitizeGalaxySaveDownloadBase(fallbackId)
  return `${fromId || 'galaxy-save'}.galaxy.json`
}

/**
 * Лимит маркеров производства — купленный пул (ADR 008), не разблокировка регионами.
 */
export function maxProductionMarkersForPlayer(game: GameSnapshot, ownerId: string): number {
  return productionMarkerLimitForPlayer(game, ownerId)
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

import type { CombatOptions, CombatPrepState, CombatRoundResult } from './combat.js'
import { migrateLegacyEventId, type EventCardId, type TurnEventState } from './events.js'
import type { GameOverState } from './victory.js'

export type { TurnEventState, GameOverState }

/**
 * Фаза боя между запросами. Бросок кубов происходит синхронно внутри одного вызова,
 * а завершённый бой — это `pendingCombat === undefined`.
 */
export type PendingCombatPhase = 'prep' | 'awaiting-continue'

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
   * Урон, полученный кораблями в этом бою. Живёт ровно столько, сколько бой: кончился бой —
   * исчез pendingCombat, а с ним и урон. Межходовой убыли нет.
   */
  damageByShipId?: Record<string, number>
  /** Последний сыгранный раунд — чтобы наблюдатели видели броски. */
  lastRound?: CombatRoundResult
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

/** Стороны решают, продолжать бой или отступать */
export interface PendingCombatAwaitingContinue extends PendingCombatBase {
  phase: 'awaiting-continue'
  /** Решения продолжать бой; сначала атакующий, затем защитник. */
  continueDecisions: Partial<Record<'attacker' | 'defender', boolean>>
}

/**
 * Дискриминированное объединение: поля, осмысленные только в одной фазе,
 * существуют только в её варианте.
 */
export type PendingCombat =
  | PendingCombatPrep
  | PendingCombatAwaitingContinue

function cloneCombatOptions(options: CombatOptions): CombatOptions {
  const side = (s: CombatOptions['attacker']) =>
    s
      ? {
          ...s,
          targetPriority: s.targetPriority ? [...s.targetPriority] : undefined,
          diceTargets: s.diceTargets
            ? Object.fromEntries(Object.entries(s.diceTargets).map(([k, v]) => [k, [...v]]))
            : undefined,
        }
      : undefined
  return {
    ...options,
    attacker: side(options.attacker),
    defender: side(options.defender),
    supportSides: options.supportSides ? { ...options.supportSides } : undefined,
  }
}

function cloneCombatPrep(prep: CombatPrepState): CombatPrepState {
  return {
    ...prep,
    readyBy: { ...prep.readyBy },
    combatOptions: cloneCombatOptions(prep.combatOptions),
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

function cloneCombatRound(round: CombatRoundResult): CombatRoundResult {
  return {
    ...round,
    shipRolls: round.shipRolls.map((log) => ({ ...log, dice: log.dice.map((d) => ({ ...d })) })),
    damageByShipId: { ...round.damageByShipId },
    destroyedShipIds: [...round.destroyedShipIds],
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
    combatOptions: pending.combatOptions ? cloneCombatOptions(pending.combatOptions) : undefined,
    shipsDestroyedInCombat: pending.shipsDestroyedInCombat,
    damageByShipId: pending.damageByShipId ? { ...pending.damageByShipId } : undefined,
    lastRound: pending.lastRound ? cloneCombatRound(pending.lastRound) : undefined,
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
    case 'awaiting-continue':
      return {
        ...base,
        phase: 'awaiting-continue',
        continueDecisions: { ...pending.continueDecisions },
      }
  }
}

/**
 * Бой без распознаваемой фазы восстановить нельзя — безопаснее снять его, чем оставить игроков
 * в заблокированном состоянии. Сюда же попадает снятая фаза выбора жертв победителем.
 */
export function migrateLegacyPendingCombat(raw: unknown): PendingCombat | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const phase = (raw as Record<string, unknown>).phase
  if (phase === 'prep' || phase === 'awaiting-continue') return raw as PendingCombat
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
  /** Кто уже купил доп. маркер производства в этом игровом ходе */
  productionMarkerBoughtByPlayerThisTurn?: Record<string, boolean>
  /** Кто реально в игре (остальные слоты карты пропускаются в очереди хода) */
  participatingPlayerIds?: string[]
  /**
   * Порог победы по центрам власти, скопированный из карты при старте партии.
   *
   * Хранится в снимке, а не читается из карты каждый раз: карту можно отредактировать
   * между партиями, и начатая партия обязана доиграться со своим порогом. Заодно до
   * проверки победы доезжает только `mapId`, а не сама карта.
   */
  victoryPowerCenters?: number
  /** Жёсткий лимит ходов; по его достижении победитель определяется цепочкой тай-брейков. */
  turnLimit?: number
  /** Сид партии: разрешает ничьи и прочие броски, одинаковые при повторной загрузке сейва. */
  matchSeed?: number
  /**
   * Сколько фишек игроку ещё предстоит поднять в этом ходу.
   *
   * Поле появляется, только когда перевёрнутых фишек больше бюджета: если выбирать не из
   * чего, фишки поднимаются молча и долг не заводится.
   */
  rechargePicksRemainingByPlayer?: Record<string, number>
  /**
   * Сколько клеток игроку ещё предстоит занять по итогам прошлого хода.
   *
   * Заводится, только когда подходящих клеток больше лимита захвата: если выбирать не из
   * чего, клетки занимаются сразу в конце хода.
   */
  claimPicksRemainingByPlayer?: Record<string, number>
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
  /** @deprecated Устаревшее поле сейва (событие «Всё для фронта» снято) */
  productionTokensSpentThisTurn?: Record<string, number>
  /** Лимит маркеров действия: 2 + центры власти, заморожен в начале хода (ADR 011) */
  actionMarkerLimitByPlayer?: Record<string, number>
  /** Купленный лимит маркеров производства (устарело; миграция очищает PM) */
  productionMarkerLimitByPlayer?: Record<string, number>
  /** Прогресс обучающего сценария */
  scenarioProgress?: import('./scenario.js').ScenarioProgress
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

function isKnownShipType(type: string): type is ShipType {
  return (SHIP_TYPES as readonly string[]).includes(type)
}

function stripUnknownShips<T extends { type: string }>(ships: T[] | undefined): T[] {
  return (ships ?? []).filter((ship) => isKnownShipType(ship.type))
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
  const snapshot: GameSnapshot = {
    phase: state.phase,
    turnNumber: state.turnNumber,
    activePlayerId: state.activePlayerId,
    players: state.players.map((p) => ({ ...p })),
    cells: state.cells.map((c) => ({
      ...c,
      resourceTokens: c.resourceTokens.map((t) => ({ ...t })),
      ships: stripUnknownShips(c.ships).map((s) => ({ ...s })),
      actionMarkerId: null,
      productionMarkerId: null,
    })),
    eventLog: state.eventLog.map((e) => ({ ...e })),
    pendingEvents: [],
    actionMarkers: [],
    productionMarkers: [],
    actionMarkerResolvedThisTurn: false,
    productionMarkerResolvedThisTurn: false,
    victoryPowerCenters: state.victoryPowerCenters,
    turnLimit: state.turnLimit,
  }
  ensureMarkerLimits(snapshot)
  return snapshot
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
    victoryPowerCenters: snapshot.victoryPowerCenters,
    turnLimit: snapshot.turnLimit,
    matchSeed: snapshot.matchSeed,
  }
}

export function parseGalaxySave(raw: unknown): GalaxySaveFile {
  if (isGalaxySaveFile(raw)) {
    return normalizeGalaxySave(raw)
  }
  if (isRecord(raw) && raw.format === GALAXY_SAVE_FORMAT) {
    throw new Error(
      `Сохранение версии ${String(raw.version)} не поддерживается: правила игры изменились, `
        + `нужна версия ${GALAXY_SAVE_VERSION}. Старую партию продолжить нельзя, начните новую. `
        + `Карты (.galaxy.json) по-прежнему открываются.`,
    )
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

function normalizeGameSnapshot(game: GameSnapshot, _map?: MapDefinition): GameSnapshot {
  const cells: RuntimeCellState[] = game.cells.map((c) => ({
    coord: { q: c.coord.q, r: c.coord.r },
    isPowerCenter: !!c.isPowerCenter,
    controlOwnerId: c.controlOwnerId ?? null,
    resourceTokens: c.resourceTokens ?? [],
    ships: stripUnknownShips(c.ships),
    actionMarkerId: c.actionMarkerId ?? null,
    productionMarkerId: c.productionMarkerId ?? null,
  }))

  const actionMarkers = (game.actionMarkers ?? []).map((m) => ({ ...m, coord: { ...m.coord } }))
  const productionMarkers: ProductionMarker[] = []

  for (const cell of cells) {
    cell.productionMarkerId = null
  }

  syncMarkerRefs(cells, actionMarkers, productionMarkers)

  const phase = game.phase === 'production' ? 'actions' : game.phase

  const normalized: GameSnapshot = {
    phase,
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
    victoryPowerCenters: game.victoryPowerCenters,
    turnLimit: game.turnLimit,
    matchSeed: game.matchSeed,
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
    productionMarkerBoughtByPlayerThisTurn: game.productionMarkerBoughtByPlayerThisTurn
      ? { ...game.productionMarkerBoughtByPlayerThisTurn }
      : undefined,
    actionMarkerLimitByPlayer: game.actionMarkerLimitByPlayer
      ? { ...game.actionMarkerLimitByPlayer }
      : undefined,
    productionMarkerLimitByPlayer: game.productionMarkerLimitByPlayer
      ? { ...game.productionMarkerLimitByPlayer }
      : undefined,
    rechargePicksRemainingByPlayer: game.rechargePicksRemainingByPlayer
      ? { ...game.rechargePicksRemainingByPlayer }
      : undefined,
    claimPicksRemainingByPlayer: game.claimPicksRemainingByPlayer
      ? { ...game.claimPicksRemainingByPlayer }
      : undefined,
  }

  ensureMarkerLimits(normalized)
  return normalized
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
    const limit = actionMarkerLimitForPlayer(game, marker.ownerId)
    if (count > limit) {
      errors.push(`Player ${marker.ownerId}: more than ${limit} action markers`)
    }
    if (marker.placedInPhase !== 'planning' && marker.placedInPhase !== 'actions') {
      errors.push(`Action marker ${marker.id}: invalid placedInPhase`)
    }
  }

  const productionByCell = new Map<string, string>()
  for (const marker of game.productionMarkers) {
    const key = hexKey(marker.coord.q, marker.coord.r)
    if (productionByCell.has(key)) errors.push(`${key}: multiple production markers`)
    productionByCell.set(key, marker.ownerId)

    if (!marker.targetRegionId?.trim()) {
      errors.push(`Production marker ${marker.id}: missing targetRegionId`)
    }
  }

  for (const player of game.players) {
    const limit = maxProductionMarkersForPlayer(game, player.id)
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
    victoryPowerCenters: fromObservationField(
      mech,
      'victoryPowerCenters',
      preserve?.victoryPowerCenters,
    ),
    turnLimit: fromObservationField(mech, 'turnLimit', preserve?.turnLimit),
    matchSeed: fromObservationField(mech, 'matchSeed', preserve?.matchSeed),
    turnEvent: fromObservationField(mech, 'turnEvent', preserve?.turnEvent),
    eventDeck: fromObservationField(mech, 'eventDeck', preserve?.eventDeck),
    productionTokensSpentThisTurn: fromObservationField(
      mech,
      'productionTokensSpentThisTurn',
      preserve?.productionTokensSpentThisTurn,
    ),
    productionMarkerBoughtByPlayerThisTurn: fromObservationField(
      mech,
      'productionMarkerBoughtByPlayerThisTurn',
      preserve?.productionMarkerBoughtByPlayerThisTurn,
    ),
    overtimeRegionByPlayer: fromObservationField(
      mech,
      'overtimeRegionByPlayer',
      preserve?.overtimeRegionByPlayer,
    ),
    pendingCombat: fromObservationField(mech, 'pendingCombat', preserve?.pendingCombat),
    gameOver: fromObservationField(mech, 'gameOver', preserve?.gameOver),
    actionMarkerLimitByPlayer: fromObservationField(
      mech,
      'actionMarkerLimitByPlayer',
      preserve?.actionMarkerLimitByPlayer,
    ),
    productionMarkerLimitByPlayer: fromObservationField(
      mech,
      'productionMarkerLimitByPlayer',
      preserve?.productionMarkerLimitByPlayer,
    ),
    rechargePicksRemainingByPlayer: fromObservationField(
      mech,
      'rechargePicksRemainingByPlayer',
      preserve?.rechargePicksRemainingByPlayer,
    ),
    claimPicksRemainingByPlayer: fromObservationField(
      mech,
      'claimPicksRemainingByPlayer',
      preserve?.claimPicksRemainingByPlayer,
    ),
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
