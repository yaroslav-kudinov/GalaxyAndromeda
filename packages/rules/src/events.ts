/**
 * Events phase — one global event card per game turn affecting all players.
 * See docs/rulebook.md and docs/decisions/004-turn-events-victory-supply-combat.md
 */

import { trimGameEventLog } from './event-log.js'
import { buildSpatialSummary } from './observation/ascii-map.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import { getShipMoveRange } from './ships.js'
import type { ShipType } from './types.js'
import { hexKey } from './types.js'

/** One global event per turn for all players. */
export type EventCardId =
  | 'magnetic-storm'
  | 'empty-void'
  | 'stand-to-death'
  | 'production-accident'
  | 'ammo-detonation'
  | 'mandatory-overtime'
  | 'hyper-gap'
  | 'all-for-front'
  | 'shadow-economy'
  | 'hold-formation'
  | 'combat-chaos'
  | 'local-self-defense'

export interface TurnEventState {
  eventId: EventCardId
  turnNumber: number
  resolvedAt?: string
}

export interface GameEventCard {
  id: EventCardId
  name: string
  description: string
  effectSummary: string
}

export interface TurnModifiers {
  moveRangeDelta: number
  minMoveRange: number
  fixedDiceValue?: number
  hyperFireRange?: number
  cannotBuildShipTypes: ShipType[]
  cannotBuyExtraMarkers: boolean
  cannotRetreat: boolean
  tokenValueBonus: number
  destroyCostBonus: number
  ignoreDestructionPriority: boolean
  blockEnterResourceOrPowerCenter: boolean
  maxProductionTokensPerPlayer?: number
  /** Событие `mandatory-overtime`: не больше одного маркера производства на регион владельца. */
  oneProductionMarkerPerRegion: boolean
}

export const COMBAT_SHIP_TYPES: ShipType[] = ['destroyer', 'cruiser', 'battleship']

export const EVENT_CARDS: readonly GameEventCard[] = [
  { id: 'magnetic-storm', name: 'Магнитная буря', description: 'Все корабли: дальность хода −1 (минимум 1).', effectSummary: 'Дальность хода −1 (мин. 1)' },
  { id: 'empty-void', name: 'Среди звёзд лишь пустота', description: 'Без эффекта.', effectSummary: 'Без эффекта' },
  { id: 'stand-to-death', name: '«Стоять насмерть!»', description: 'Игроки не могут отступать из боя.', effectSummary: 'Отступление запрещено' },
  { id: 'production-accident', name: 'Авария на производстве', description: 'Нельзя покупать дополнительные маркеры производства в этом ходу.', effectSummary: 'Покупка маркеров производства запрещена' },
  { id: 'ammo-detonation', name: 'Детонация склада боеприпасов', description: 'Нельзя строить эсминец, крейсер, линкор в этом ходу.', effectSummary: 'Постройка destroyer/cruiser/battleship запрещена' },
  {
    id: 'mandatory-overtime',
    name: 'Нормирование производства',
    description:
      'Не больше одного маркера производства на регион. Если в регионе уже несколько — лишние снимаются в неиспользованный пул (остаётся маркер с меньшим id).',
    effectSummary: 'Не больше 1 маркера производства на регион',
  },
  { id: 'hyper-gap', name: 'Просвет в гиперпространстве', description: 'Все корабли +1 ход; у гиперпространственного орудия дальность стрельбы становится 2–4 (вместо 2–3).', effectSummary: 'Ход +1; дальность орудия 2–4' },
  { id: 'all-for-front', name: '«Всё для фронта»', description: 'Каждый игрок может потратить не более 3 фишек производства за ход.', effectSummary: 'Макс. 3 фишки производства на игрока' },
  { id: 'shadow-economy', name: 'Теневая экономика', description: 'Номинал каждой фишки ресурса +2 (только этот ход).', effectSummary: 'Номинал фишек +2' },
  { id: 'hold-formation', name: '«Держать строй»', description: 'destroyCost +2 для каждого уничтожаемого в бою корабля.', effectSummary: 'destroyCost +2' },
  { id: 'combat-chaos', name: 'Хаос битвы', description: 'Приоритет уничтожения игнорируется.', effectSummary: 'Приоритет уничтожения отключён' },
  { id: 'local-self-defense', name: 'Местная самооборона', description: 'Нельзя входить движением в клетки с фишками ресурсов или центром власти (остаться на такой клетке можно). Отступление из боя на соседнюю клетку с фишкой или центром власти разрешено.', effectSummary: 'Запрет входа движением на ресурсы / центр власти' },
] as const

export const ALL_EVENT_IDS: EventCardId[] = EVENT_CARDS.map((c) => c.id)

/**
 * Сколько копий карты в полной колоде.
 * Жёсткие эффекты — 1 копия; средние — 2; мягкие/полезные — 2–3.
 */
export const EVENT_DECK_COPIES: Readonly<Record<EventCardId, number>> = {
  'empty-void': 3,
  'mandatory-overtime': 2,
  'hyper-gap': 2,
  'shadow-economy': 2,
  'magnetic-storm': 2,
  'production-accident': 2,
  'all-for-front': 2,
  'combat-chaos': 1,
  'stand-to-death': 1,
  'ammo-detonation': 1,
  'hold-formation': 1,
  'local-self-defense': 1,
}

export const EVENT_DECK_SIZE = ALL_EVENT_IDS.reduce(
  (sum, id) => sum + (EVENT_DECK_COPIES[id] ?? 1),
  0,
)

/** Устаревшие id из сохранений → актуальная карта (или no-op). */
export function migrateLegacyEventId(eventId: string): EventCardId {
  if (eventId === 'fair-fight') return 'empty-void'
  if (eventId === 'saboteurs-activation' || eventId === 'peoples-donation') return 'empty-void'
  if ((ALL_EVENT_IDS as readonly string[]).includes(eventId)) return eventId as EventCardId
  return 'empty-void'
}

export function getEventCard(id: EventCardId): GameEventCard {
  const card = EVENT_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`Unknown event: ${id}`)
  return card
}

/** Неперетасованный шаблон колоды с учётом кратности карт. */
export function buildEventDeckTemplate(): EventCardId[] {
  const deck: EventCardId[] = []
  for (const id of ALL_EVENT_IDS) {
    const copies = EVENT_DECK_COPIES[id] ?? 1
    for (let i = 0; i < copies; i++) deck.push(id)
  }
  return deck
}

export function shuffleEventDeck(deck: readonly EventCardId[], rng: () => number = Math.random): EventCardId[] {
  const out = [...deck]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

export function createShuffledEventDeck(rng: () => number = Math.random): EventCardId[] {
  return shuffleEventDeck(buildEventDeckTemplate(), rng)
}

/**
 * Снять верхнюю карту колоды. Пустая / отсутствующая колода → новая перетасовка полного комплекта.
 */
export function drawNextEventFromDeck(game: GameSnapshot, rng: () => number = Math.random): EventCardId {
  if (!game.eventDeck || game.eventDeck.length === 0) {
    game.eventDeck = createShuffledEventDeck(rng)
  }
  const next = game.eventDeck.shift()
  if (!next) {
    game.eventDeck = createShuffledEventDeck(rng)
    return migrateLegacyEventId(game.eventDeck.shift()!)
  }
  return migrateLegacyEventId(next)
}

/** @deprecated Используйте колоду (`drawNextEventFromDeck`). Оставлено для старых тестов/скриптов. */
export function drawTurnEvent(turnNumber: number): EventCardId {
  return ALL_EVENT_IDS[(turnNumber - 1) % ALL_EVENT_IDS.length]!
}

/** Случайная карта с весами колоды (без состояния игры). */
export function drawRandomEvent(rng: () => number = Math.random): EventCardId {
  const deck = buildEventDeckTemplate()
  return deck[Math.floor(rng() * deck.length)]!
}

function drawnEventId(game: GameSnapshot): EventCardId | null {
  if (!game.turnEvent || game.turnEvent.turnNumber !== game.turnNumber) return null
  return migrateLegacyEventId(game.turnEvent.eventId)
}

function activeModifierEventId(game: GameSnapshot): EventCardId | null {
  if (!game.turnEvent || game.turnEvent.turnNumber !== game.turnNumber) return null
  if (!game.turnEvent.resolvedAt) return null
  return migrateLegacyEventId(game.turnEvent.eventId)
}

export function getTurnModifiers(game: GameSnapshot): TurnModifiers {
  const empty: TurnModifiers = {
    moveRangeDelta: 0,
    minMoveRange: 1,
    cannotBuildShipTypes: [],
    cannotBuyExtraMarkers: false,
    cannotRetreat: false,
    tokenValueBonus: 0,
    destroyCostBonus: 0,
    ignoreDestructionPriority: false,
    blockEnterResourceOrPowerCenter: false,
    oneProductionMarkerPerRegion: false,
  }
  const eventId = activeModifierEventId(game)
  if (!eventId) return empty
  switch (eventId) {
    case 'magnetic-storm': return { ...empty, moveRangeDelta: -1, minMoveRange: 1 }
    case 'stand-to-death': return { ...empty, cannotRetreat: true }
    case 'production-accident': return { ...empty, cannotBuyExtraMarkers: true }
    case 'ammo-detonation': return { ...empty, cannotBuildShipTypes: [...COMBAT_SHIP_TYPES] }
    case 'mandatory-overtime': return { ...empty, oneProductionMarkerPerRegion: true }
    case 'hyper-gap': return { ...empty, moveRangeDelta: 1, hyperFireRange: 4 }
    case 'all-for-front': return { ...empty, maxProductionTokensPerPlayer: 3 }
    case 'shadow-economy': return { ...empty, tokenValueBonus: 2 }
    case 'hold-formation': return { ...empty, destroyCostBonus: 2 }
    case 'combat-chaos': return { ...empty, ignoreDestructionPriority: true }
    case 'local-self-defense': return { ...empty, blockEnterResourceOrPowerCenter: true }
    default: return empty
  }
}

export function isTurnEventResolved(game: GameSnapshot): boolean {
  if (game.phase !== 'events') return true
  if (!game.turnEvent || game.turnEvent.turnNumber !== game.turnNumber) return false
  return !!game.turnEvent.resolvedAt
}

export function resetTurnEventTracking(game: GameSnapshot): void {
  game.productionTokensSpentThisTurn = {}
  game.overtimeRegionByPlayer = {}
  game.productionMarkerBoughtByPlayerThisTurn = {}
}

function productionMarkerRegionKey(
  summary: ReturnType<typeof buildSpatialSummary>,
  marker: GameSnapshot['productionMarkers'][number],
): string {
  const hex = hexKey(marker.coord.q, marker.coord.r)
  const region = summary.regions.find(
    (r) => r.ownerId === marker.ownerId && r.hexes.includes(hex),
  )
  const regionId = region?.id || marker.targetRegionId || hex
  return `${marker.ownerId}:${regionId}`
}

/**
 * Событие «Нормирование производства»: в каждом регионе владельца остаётся один PM.
 * Лишние снимаются с карты в неиспользованный пул (без траты действия фазы).
 * Остаётся маркер с меньшим id.
 */
export function enforceOneProductionMarkerPerRegion(game: GameSnapshot): string[] {
  const summary = buildSpatialSummary(gameStateFromSnapshot(game, 'event'))
  const grouped = new Map<string, GameSnapshot['productionMarkers']>()
  const sorted = [...game.productionMarkers].sort((a, b) => a.id.localeCompare(b.id))
  for (const marker of sorted) {
    const key = productionMarkerRegionKey(summary, marker)
    const list = grouped.get(key) ?? []
    list.push(marker)
    grouped.set(key, list)
  }

  const removeIds = new Set<string>()
  for (const list of grouped.values()) {
    for (const extra of list.slice(1)) removeIds.add(extra.id)
  }
  if (removeIds.size === 0) return []

  game.productionMarkers = game.productionMarkers.filter((m) => !removeIds.has(m.id))
  for (const cell of game.cells) {
    if (cell.productionMarkerId && removeIds.has(cell.productionMarkerId)) {
      cell.productionMarkerId = null
    }
  }

  const message =
    `«Нормирование производства»: снято лишних маркеров производства: ${removeIds.size} ` +
    '(оставлен один на регион, с меньшим id)'
  appendEventLog(game, message)
  return [message]
}

export function applyEventImmediateEffects(game: GameSnapshot, eventId: EventCardId): void {
  switch (eventId) {
    case 'mandatory-overtime':
      enforceOneProductionMarkerPerRegion(game)
      break
    default:
      break
  }
}

function appendEventLog(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'turn-event',
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

export function ensureTurnEventForPhase(game: GameSnapshot, rng: () => number = Math.random): void {
  if (game.phase !== 'events') return
  if (game.turnEvent?.turnNumber === game.turnNumber) return
  resetTurnEventTracking(game)
  const eventId = drawNextEventFromDeck(game, rng)
  const card = getEventCard(eventId)
  game.turnEvent = { eventId, turnNumber: game.turnNumber }
  appendEventLog(game, `Событие хода: «${card.name}» — ${card.effectSummary}`)
}

export function resolveTurnEvent(game: GameSnapshot): string[] {
  if (game.phase !== 'events') return ['Событие разрешается только в фазе «События»']
  ensureTurnEventForPhase(game)
  if (!game.turnEvent || game.turnEvent.turnNumber !== game.turnNumber) {
    return ['Нет активного события для этого хода']
  }
  if (game.turnEvent.resolvedAt) return []
  const eventId = migrateLegacyEventId(String(game.turnEvent.eventId))
  game.turnEvent.eventId = eventId
  applyEventImmediateEffects(game, eventId)
  game.turnEvent.resolvedAt = new Date().toISOString()
  const card = getEventCard(eventId)
  appendEventLog(game, `Применено: «${card.name}»`)
  return []
}

export function getEffectiveMoveRange(game: GameSnapshot, type: ShipType): number {
  const mods = getTurnModifiers(game)
  return Math.max(mods.minMoveRange, getShipMoveRange(type) + mods.moveRangeDelta)
}

export function getEffectiveTokenValue(game: GameSnapshot, value: number): number {
  return value + getTurnModifiers(game).tokenValueBonus
}

export function isShipTypeBuildBlocked(game: GameSnapshot, type: ShipType): boolean {
  return getTurnModifiers(game).cannotBuildShipTypes.includes(type)
}

export function isExtraMarkerBuyBlocked(game: GameSnapshot): boolean {
  return getTurnModifiers(game).cannotBuyExtraMarkers
}

export function isMovementIntoCellBlocked(
  game: GameSnapshot,
  dest: RuntimeCellState,
  fromKey: string,
  toKey: string,
): boolean {
  if (fromKey === toKey) return false
  if (!getTurnModifiers(game).blockEnterResourceOrPowerCenter) return false
  return dest.isPowerCenter || dest.resourceTokens.length > 0
}

export function canRetreatFromBattle(game: GameSnapshot): boolean {
  return !getTurnModifiers(game).cannotRetreat
}

export function productionTokensSpentByPlayer(game: GameSnapshot, playerId: string): number {
  return game.productionTokensSpentThisTurn?.[playerId] ?? 0
}

export function validateProductionTokenSpendLimit(
  game: GameSnapshot,
  playerId: string,
  additionalProductionTokens: number,
): string[] {
  const max = getTurnModifiers(game).maxProductionTokensPerPlayer
  if (max == null) return []
  const spent = productionTokensSpentByPlayer(game, playerId)
  if (spent + additionalProductionTokens > max) {
    return [`«Всё для фронта»: не более ${max} фишек производства за ход`]
  }
  return []
}

/** @deprecated Сверхурочные по фишкам убраны; лимит 1 PM на регион — событие `mandatory-overtime`. */
export function validateOvertimeProductionSpend(
  _game: GameSnapshot,
  _playerId: string,
  _regionId: string,
  _regionSize: number,
  _productionTokenCount: number,
): string[] {
  return []
}

export function recordProductionTokensSpent(
  game: GameSnapshot,
  playerId: string,
  productionTokenCount: number,
  _regionId?: string,
): void {
  if (productionTokenCount <= 0) return
  if (!game.productionTokensSpentThisTurn) game.productionTokensSpentThisTurn = {}
  game.productionTokensSpentThisTurn[playerId] =
    (game.productionTokensSpentThisTurn[playerId] ?? 0) + productionTokenCount
}

export interface ActiveEventObservation {
  id: EventCardId
  name: string
  description: string
  effectSummary: string
  resolved: boolean
}

export interface TurnEventHistoryEntry {
  turn: number
  eventId: EventCardId
  name: string
  effectSummary: string
  applied: boolean
  drawnAt?: number
  appliedAt?: number
}

/** История событий хода из журнала игры (type: turn-event). */
export function getTurnEventHistory(game: GameSnapshot): TurnEventHistoryEntry[] {
  const byTurn = new Map<number, TurnEventHistoryEntry>()

  for (const evt of game.eventLog) {
    if (evt.type !== 'turn-event') continue

    const drawMatch = evt.message.match(/^Событие хода: «([^»]+)» — (.+)$/)
    if (drawMatch) {
      const card = EVENT_CARDS.find((c) => c.name === drawMatch[1])
      if (!card) continue
      const existing = byTurn.get(evt.turn)
      byTurn.set(evt.turn, {
        turn: evt.turn,
        eventId: card.id,
        name: card.name,
        effectSummary: card.effectSummary,
        applied: existing?.applied ?? false,
        drawnAt: evt.timestamp,
        appliedAt: existing?.appliedAt,
      })
      continue
    }

    const applyMatch = evt.message.match(/^Применено: «([^»]+)»$/)
    if (applyMatch) {
      const card = EVENT_CARDS.find((c) => c.name === applyMatch[1])
      if (!card) continue
      const existing = byTurn.get(evt.turn)
      byTurn.set(evt.turn, {
        turn: evt.turn,
        eventId: card.id,
        name: card.name,
        effectSummary: card.effectSummary,
        applied: true,
        drawnAt: existing?.drawnAt,
        appliedAt: evt.timestamp,
      })
    }
  }

  return [...byTurn.values()].sort((a, b) => b.turn - a.turn)
}

export function getActiveEventObservation(game: GameSnapshot): ActiveEventObservation | null {
  const eventId = drawnEventId(game)
  if (!eventId || !game.turnEvent) return null
  const card = getEventCard(eventId)
  return {
    id: card.id,
    name: card.name,
    description: card.description,
    effectSummary: card.effectSummary,
    resolved: !!game.turnEvent.resolvedAt,
  }
}