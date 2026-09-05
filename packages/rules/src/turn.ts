import { maybeApplyProductionHexClaims } from './claim.js'
import { trimGameEventLog } from './event-log.js'
import { ensureTurnEventForPhase, resolveTurnEvent } from './events.js'
import { refreshActionMarkerCapacity } from './marker-pools.js'
import {
  syncActionMarkerTurnTracking,
  validateActionMarkerBeforeAdvance,
} from './markers.js'
import { maybeApplyAutomaticResourceRecharge } from './resource-recharge.js'
import { applyVictoryAndDefeatChecks } from './victory.js'
import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState, Phase, PlayerState } from './types.js'

export const PHASE_ORDER: Phase[] = ['events', 'planning', 'actions']

export const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Производство',
}

const PHASE_PASS_VERB: Record<Exclude<Phase, 'events'>, string> = {
  planning: 'планирование',
  actions: 'действия',
  production: 'действия',
}

export interface TurnOrderContext {
  state?: GameState
  phase?: Phase
}

export function nextPhase(current: Phase): Phase {
  const idx = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
}

function mixTurnOrderSeed(turnNumber: number, mapId: string): number {
  let h = ((turnNumber + 1) * 0x9e3779b9) >>> 0
  for (let i = 0; i < mapId.length; i++) {
    h = Math.imul(h ^ mapId.charCodeAt(i), 0x01000193) >>> 0
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const current = items[i]!
    items[i] = items[j]!
    items[j] = current
  }
}

/** Один случайный порядок на игровой ход: события, планирование, действия и производство совпадают. */
export function activePlayerOrder(
  players: PlayerState[],
  participatingPlayerIds?: string[] | null,
  context?: TurnOrderContext,
): string[] {
  const participating = participatingPlayerIds?.length
    ? new Set(participatingPlayerIds)
    : null
  const eligible = new Set(
    players
      .filter((p) => !p.eliminated && (!participating || participating.has(p.id)))
      .map((p) => p.id),
  )
  let base = players.map((p) => p.id)
  if (participating) base = base.filter((id) => participating.has(id))

  const phase = context?.phase ?? context?.state?.phase
  if (context?.state && phase) {
    const shuffled = [...base]
    shuffleInPlace(
      shuffled,
      mulberry32(mixTurnOrderSeed(context.state.turnNumber, context.state.mapId)),
    )
    return shuffled.filter((id) => eligible.has(id))
  }

  return base.filter((id) => eligible.has(id))
}

export function nextActivePlayerId(
  players: PlayerState[],
  currentId: string | null,
  participatingPlayerIds?: string[] | null,
  context?: TurnOrderContext,
): string | null {
  const order = activePlayerOrder(players, participatingPlayerIds, context)
  if (!order.length) return null
  if (!currentId) return order[0]
  const idx = order.indexOf(currentId)
  if (idx < 0) return order[0]
  return order[(idx + 1) % order.length]
}

export function isLastPlayerInPhase(
  state: GameState,
  participatingPlayerIds?: string[] | null,
): boolean {
  const order = activePlayerOrder(state.players, participatingPlayerIds, {
    state,
    phase: state.phase,
  })
  if (!order.length || !state.activePlayerId) return true
  return order.indexOf(state.activePlayerId) === order.length - 1
}

function playerDisplayName(state: GameState, playerId: string): string {
  return state.players.find((p) => p.id === playerId)?.name ?? playerId
}

function appendPhaseEvent(state: GameState, message: string): void {
  state.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: state.turnNumber,
    phase: state.phase,
    type: 'phase',
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(state)
}

function turnOrderContext(state: GameState): TurnOrderContext {
  return { state, phase: state.phase }
}

/** Есть ли у игрока действие помимо передачи хода в текущей фазе. */
function canPlayerActInPhase(game: GameSnapshot, state: GameState, playerId: string): boolean {
  if (state.phase === 'events') return true

  if (state.phase === 'planning') {
    const canPlaceAction = game.cells.some(
      (cell) =>
        !cell.actionMarkerId
        && (
          cell.ships.some((ship) => ship.ownerId === playerId)
          || (!!cell.isPowerCenter && cell.controlOwnerId === playerId)
        ),
    )
    return canPlaceAction || game.actionMarkers.some((marker) => marker.ownerId === playerId)
  }

  if (state.phase === 'actions') {
    return (
      game.actionMarkers.some((marker) => marker.ownerId === playerId)
      && !(game.activePlayerId === playerId && game.actionMarkerResolvedThisTurn)
    )
  }

  return false
}

function applyTurnState(game: GameSnapshot, state: GameState, prevPhase: Phase, prevActivePlayerId: string | null): void {
  game.phase = state.phase
  game.turnNumber = state.turnNumber
  game.activePlayerId = state.activePlayerId
  game.eventLog = state.eventLog
  syncActionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
  maybeApplyProductionHexClaims(game, prevPhase)
  if (prevPhase === 'actions' && game.phase === 'events') {
    maybeApplyAutomaticResourceRecharge(game)
  }
}

/**
 * Если в фазе действий/производства ещё есть маркеры — начинаем новый круг с первого
 * игрока по порядку, не закрывая фазу.
 * @returns true если круг продолжен
 */
function continuePhaseWhileMarkersRemain(
  game: GameSnapshot,
  state: GameState,
  prevPhase: Phase,
  prevActivePlayerId: string | null,
): boolean {
  const remaining = state.phase === 'actions' ? game.actionMarkers.length > 0 : false
  if (!remaining) return false

  const order = activePlayerOrder(
    state.players,
    game.participatingPlayerIds,
    turnOrderContext(state),
  )
  const firstId = order[0]
  if (!firstId) return false

  state.activePlayerId = firstId
  appendPhaseEvent(
    state,
    `Фаза «${PHASE_LABELS[state.phase]}», ход ${playerDisplayName(state, firstId)} (остались маркеры)`,
  )
  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  // Новый круг маркеров: снова разрешаем одно исполнение за круг (даже если
  // activePlayerId не сменился — один игрок с оставшимися маркерами).
  if (state.phase === 'actions') game.actionMarkerResolvedThisTurn = false
  return true
}

/** Передаёт ход только игрокам, у которых в фазе есть не-pass действие. */
function skipPlayersWithoutPhaseActions(
  game: GameSnapshot,
  mapId: string,
  options?: { allowMarkerWrap?: boolean },
): string[] {
  const allowMarkerWrap = options?.allowMarkerWrap !== false
  const state = gameStateFromSnapshot(game, mapId)
  if (state.phase === 'events' || !state.activePlayerId) return []
  if (canPlayerActInPhase(game, state, state.activePlayerId)) return []

  const order = activePlayerOrder(state.players, game.participatingPlayerIds, turnOrderContext(state))
  const currentIndex = order.indexOf(state.activePlayerId)
  for (let index = Math.max(0, currentIndex) + 1; index < order.length; index += 1) {
    const candidate = order[index]!
    if (!canPlayerActInPhase(game, state, candidate)) continue
    const prevPhase = game.phase
    const prevActivePlayerId = game.activePlayerId
    state.activePlayerId = candidate
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS[state.phase]}», ход ${playerDisplayName(state, candidate)} (пропуск без действий)`,
    )
    applyTurnState(game, state, prevPhase, prevActivePlayerId)
    return []
  }

  // Впереди никто не ходит — если маркеры остались, новый круг; иначе закрываем фазу.
  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  if (allowMarkerWrap && continuePhaseWhileMarkersRemain(game, state, prevPhase, prevActivePlayerId)) {
    // Один wrap: после сброса tracking снова ищем, кто может ходить (без повторного wrap).
    return skipPlayersWithoutPhaseActions(game, mapId, { allowMarkerWrap: false })
  }

  state.activePlayerId = order.at(-1) ?? state.activePlayerId
  const errors = advanceGamePhase(state, game.participatingPlayerIds)
  if (errors.length) return errors
  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  return completeEventsPhaseIfActive(game, mapId)
}

/** Label for the primary «advance / pass turn» action in UI */
export function phaseAdvanceActionLabel(
  state: GameState,
  participatingPlayerIds?: string[] | null,
  _game?: GameSnapshot,
): string {
  const phase = state.phase
  const ctx = turnOrderContext(state)

  if (phase === 'events') {
    return 'К планированию'
  }

  if (!isLastPlayerInPhase(state, participatingPlayerIds)) {
    const nextId = nextActivePlayerId(
      state.players,
      state.activePlayerId,
      participatingPlayerIds,
      ctx,
    )!
    const name = playerDisplayName(state, nextId)
    return `Завершить ${PHASE_PASS_VERB[phase]} → ${name}`
  }

  switch (phase) {
    case 'planning':
      return 'Все спланировали → к действиям'
    case 'actions':
      return 'Завершить ход'
    case 'production':
      return 'Завершить ход'
    default:
      return 'Далее'
  }
}

export function advanceGamePhase(
  state: GameState,
  participatingPlayerIds?: string[] | null,
): string[] {
  if (!state.activePlayerId) return ['Нет активного игрока']

  const ctx = turnOrderContext(state)
  const order = activePlayerOrder(state.players, participatingPlayerIds, ctx)
  if (!order.length) return ['Нет активных игроков']

  const phase = state.phase

  if (phase === 'events') {
    state.phase = 'planning'
    const planningOrder = activePlayerOrder(state.players, participatingPlayerIds, {
      state,
      phase: 'planning',
    })
    state.activePlayerId = planningOrder[0]!
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS.planning}», ход ${playerDisplayName(state, state.activePlayerId)}`,
    )
    return []
  }

  if (!isLastPlayerInPhase(state, participatingPlayerIds)) {
    const nextId = nextActivePlayerId(
      state.players,
      state.activePlayerId,
      participatingPlayerIds,
      ctx,
    )!
    state.activePlayerId = nextId
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS[phase]}», ход ${playerDisplayName(state, nextId)}`,
    )
    return []
  }

  if (phase === 'actions') {
    state.turnNumber += 1
    state.phase = 'events'
    const eventsOrder = activePlayerOrder(state.players, participatingPlayerIds, {
      state,
      phase: 'events',
    })
    state.activePlayerId = eventsOrder[0]!
    appendPhaseEvent(
      state,
      `Ход ${state.turnNumber}, фаза «${PHASE_LABELS.events}»`,
    )
    return []
  }

  if (phase === 'production') {
    state.turnNumber += 1
    state.phase = 'events'
    const eventsOrder = activePlayerOrder(state.players, participatingPlayerIds, {
      state,
      phase: 'events',
    })
    state.activePlayerId = eventsOrder[0]!
    appendPhaseEvent(
      state,
      `Ход ${state.turnNumber}, фаза «${PHASE_LABELS.events}»`,
    )
    return []
  }

  if (phase === 'planning') {
    state.phase = 'actions'
  } else {
    return [`Неизвестная фаза: ${phase}`]
  }

  const nextPhaseOrder = activePlayerOrder(state.players, participatingPlayerIds, {
    state,
    phase: state.phase,
  })
  state.activePlayerId = nextPhaseOrder[0]!
  appendPhaseEvent(
    state,
    `Фаза «${PHASE_LABELS[state.phase]}», ход ${playerDisplayName(state, state.activePlayerId)}`,
  )
  return []
}

function applyTurnEventIfInEventsPhase(game: GameSnapshot): string[] {
  if (game.phase !== 'events') return []
  ensureTurnEventForPhase(game)
  return resolveTurnEvent(game)
}

/** Вытянуть и применить карту события, затем уйти из фазы «События» без действия игрока. */
export function completeEventsPhaseIfActive(game: GameSnapshot, mapId: string): string[] {
  if (game.phase !== 'events') return []
  const errors = applyTurnEventIfInEventsPhase(game)
  if (errors.length) return errors
  refreshActionMarkerCapacity(game)
  return advanceGameSnapshot(game, mapId)
}

export function advanceGameSnapshot(game: GameSnapshot, mapId: string): string[] {
  const advanceErrors = [...validateActionMarkerBeforeAdvance(game)]
  if (advanceErrors.length) return advanceErrors

  const eventErrors = applyTurnEventIfInEventsPhase(game)
  if (eventErrors.length) return eventErrors

  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  const participating = game.participatingPlayerIds
  const state = gameStateFromSnapshot(game, mapId)

  if (state.phase === 'actions' && isLastPlayerInPhase(state, participating)) {
    if (continuePhaseWhileMarkersRemain(game, state, prevPhase, prevActivePlayerId)) {
      return skipPlayersWithoutPhaseActions(game, mapId)
    }
  }

  const errors = advanceGamePhase(state, participating)
  if (errors.length) return errors

  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  if (game.phase === 'planning' && prevPhase === 'events') {
    refreshActionMarkerCapacity(game)
  }
  applyVictoryAndDefeatChecks(game, mapId)
  const afterEvents = completeEventsPhaseIfActive(game, mapId)
  if (afterEvents.length) return afterEvents
  return game.phase === prevPhase ? skipPlayersWithoutPhaseActions(game, mapId) : []
}

export function phaseAdvanceActionLabelForSnapshot(game: GameSnapshot, mapId: string): string {
  const participating = game.participatingPlayerIds
  const state = gameStateFromSnapshot(game, mapId)
  const ctx = turnOrderContext(state)
  if (
    state.phase === 'actions'
    && isLastPlayerInPhase(state, participating)
    && game.actionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players, participating, ctx)
    const nextId = order[0]
    if (!nextId) return 'Далее'
    return `Завершить круг → ${playerDisplayName(state, nextId)}`
  }
  return phaseAdvanceActionLabel(state, participating, game)
}
