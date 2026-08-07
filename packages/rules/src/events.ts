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
  | 'saboteurs-activation'
  | 'production-accident'
  | 'ammo-detonation'
  | 'peoples-donation'
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
  cannotRetreat: boolean
  tokenValueBonus: number
  destroyCostBonus: number
  ignoreDestructionPriority: boolean
  blockEnterResourceOrPowerCenter: boolean
  maxProductionTokensPerPlayer?: number
  unlimitedProductionInOneRegion: boolean
}

export const COMBAT_SHIP_TYPES: ShipType[] = ['destroyer', 'cruiser', 'battleship']

export const EVENT_CARDS: readonly GameEventCard[] = [
  { id: 'magnetic-storm', name: 'Магнитная буря', description: 'Все корабли: дальность хода −1 (минимум 1).', effectSummary: 'Дальность хода −1 (мин. 1)' },
  { id: 'empty-void', name: 'Среди звёзд лишь пустота', description: 'Без эффекта.', effectSummary: 'Без эффекта' },
  { id: 'stand-to-death', name: '«Стоять насмерть!»', description: 'Игроки не могут отступать из боя.', effectSummary: 'Отступление запрещено' },
  { id: 'saboteurs-activation', name: 'Активация диверсантов', description: 'В каждом контролируемом регионе все фишки ресурсов переворачиваются рубашкой вверх.', effectSummary: 'Фишки в ваших регионах — рубашкой вверх' },
  { id: 'production-accident', name: 'Авария на производстве', description: 'Нельзя строить корабли снабжения в этом ходу.', effectSummary: 'Постройка supply запрещена' },
  { id: 'ammo-detonation', name: 'Детонация склада боеприпасов', description: 'Нельзя строить эсминец, крейсер, линкор в этом ходу.', effectSummary: 'Постройка destroyer/cruiser/battleship запрещена' },
  { id: 'peoples-donation', name: 'Народное пожертвование', description: 'Немедленно все фишки ресурсов переворачиваются лицом вверх.', effectSummary: 'Все фишки лицом вверх' },
  { id: 'mandatory-overtime', name: 'Обязательные сверхурочные', description: 'Любое число фишек производства в одном регионе (не больше числа клеток региона).', effectSummary: 'Сверхурочные в одном регионе' },
  { id: 'hyper-gap', name: 'Просвет в гиперпространстве', description: 'Все корабли +1 ход; у Г.О. fireRange = 4.', effectSummary: 'Ход +1; Г.О. fireRange 4' },
  { id: 'all-for-front', name: '«Всё для фронта»', description: 'Каждый игрок может потратить не более 3 фишек производства за ход.', effectSummary: 'Макс. 3 фишки производства на игрока' },
  { id: 'shadow-economy', name: 'Теневая экономика', description: 'Номинал каждой фишки ресурса +2 (только этот ход).', effectSummary: 'Номинал фишек +2' },
  { id: 'hold-formation', name: '«Держать строй»', description: 'destroyCost +2 для каждого уничтожаемого в бою корабля.', effectSummary: 'destroyCost +2' },
  { id: 'combat-chaos', name: 'Хаос битвы', description: 'Приоритет уничтожения игнорируется.', effectSummary: 'Приоритет уничтожения отключён' },
  { id: 'local-self-defense', name: 'Местная самооборона', description: 'Нельзя входить в клетки с фишками или энергоцентрами (остаться можно).', effectSummary: 'Запрет входа на ресурсы / энергоцентры' },
] as const

export const ALL_EVENT_IDS: EventCardId[] = EVENT_CARDS.map((c) => c.id)

/** Устаревшие id из сохранений → актуальная карта (или no-op). */
export function migrateLegacyEventId(eventId: string): EventCardId {
  if (eventId === 'fair-fight') return 'empty-void'
  if ((ALL_EVENT_IDS as readonly string[]).includes(eventId)) return eventId as EventCardId
  return 'empty-void'
}

export function getEventCard(id: EventCardId): GameEventCard {
  const card = EVENT_CARDS.find((c) => c.id === id)
  if (!card) throw new Error(`Unknown event: ${id}`)
  return card
}

export function drawTurnEvent(turnNumber: number): EventCardId {
  return ALL_EVENT_IDS[(turnNumber - 1) % ALL_EVENT_IDS.length]!
}

export function drawRandomEvent(rng: () => number = Math.random): EventCardId {
  return ALL_EVENT_IDS[Math.floor(rng() * ALL_EVENT_IDS.length)]!
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
    cannotRetreat: false,
    tokenValueBonus: 0,
    destroyCostBonus: 0,
    ignoreDestructionPriority: false,
    blockEnterResourceOrPowerCenter: false,
    unlimitedProductionInOneRegion: false,
  }
  const eventId = activeModifierEventId(game)
  if (!eventId) return empty
  switch (eventId) {
    case 'magnetic-storm': return { ...empty, moveRangeDelta: -1, minMoveRange: 1 }
    case 'stand-to-death': return { ...empty, cannotRetreat: true }
    case 'production-accident': return { ...empty, cannotBuildShipTypes: ['supply'] }
    case 'ammo-detonation': return { ...empty, cannotBuildShipTypes: [...COMBAT_SHIP_TYPES] }
    case 'mandatory-overtime': return { ...empty, unlimitedProductionInOneRegion: true }
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
}

export function applyEventImmediateEffects(game: GameSnapshot, eventId: EventCardId): void {
  switch (eventId) {
    case 'saboteurs-activation': {
      const state = gameStateFromSnapshot(game, 'event')
      const summary = buildSpatialSummary(state)
      const controlled = new Set<string>()
      for (const region of summary.regions) {
        if (!region.ownerId) continue
        for (const hex of region.hexes) controlled.add(hex)
      }
      for (const cell of game.cells) {
        const key = hexKey(cell.coord.q, cell.coord.r)
        if (!controlled.has(key)) continue
        for (const token of cell.resourceTokens) token.faceUp = false
      }
      break
    }
    case 'peoples-donation':
      for (const cell of game.cells) {
        for (const token of cell.resourceTokens) token.faceUp = true
      }
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
  const eventId = drawRandomEvent(rng)
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

export function validateOvertimeProductionSpend(
  game: GameSnapshot,
  playerId: string,
  regionId: string,
  regionSize: number,
  productionTokenCount: number,
): string[] {
  if (!getTurnModifiers(game).unlimitedProductionInOneRegion) return []
  const used = game.overtimeRegionByPlayer?.[playerId]
  if (used && used !== regionId) {
    return ['«Обязательные сверхурочные»: сверхурочные уже в другом регионе']
  }
  if (productionTokenCount > regionSize) {
    return [`«Обязательные сверхурочные»: не более ${regionSize} фишек (размер региона)`]
  }
  return []
}

export function recordProductionTokensSpent(
  game: GameSnapshot,
  playerId: string,
  productionTokenCount: number,
  regionId?: string,
): void {
  if (productionTokenCount <= 0) return
  if (!game.productionTokensSpentThisTurn) game.productionTokensSpentThisTurn = {}
  game.productionTokensSpentThisTurn[playerId] =
    (game.productionTokensSpentThisTurn[playerId] ?? 0) + productionTokenCount
  if (regionId && getTurnModifiers(game).unlimitedProductionInOneRegion) {
    if (!game.overtimeRegionByPlayer) game.overtimeRegionByPlayer = {}
    game.overtimeRegionByPlayer[playerId] = regionId
  }
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