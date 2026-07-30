import { trimGameEventLog } from './event-log.js'
import {
  ensureTurnEventForPhase,
  isTurnEventResolved,
} from './events.js'
import {
  syncActionMarkerTurnTracking,
  syncProductionMarkerTurnTracking,
  validateActionMarkerBeforeAdvance,
  validateProductionMarkerBeforeAdvance,
} from './markers.js'
import { controlledRegionCountForPlayer, validProductionRegionsForPlayer } from './regions.js'
import { applyVictoryAndDefeatChecks } from './victory.js'
import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState, Phase, PlayerState } from './types.js'

export const PHASE_ORDER: Phase[] = ['events', 'planning', 'actions', 'production']

export const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Производство',
}

const PHASE_PASS_VERB: Record<Exclude<Phase, 'events'>, string> = {
  planning: 'планирование',
  actions: 'действия',
  production: 'производство',
}

export interface TurnOrderContext {
  state?: GameState
  phase?: Phase
}

export function nextPhase(current: Phase): Phase {
  const idx = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
}

function usesRegionTurnOrder(phase?: Phase): boolean {
  return phase === 'actions' || phase === 'production'
}

/** Rulebook: fewer controlled regions act first in Actions/Production. */
export function activePlayerOrder(
  players: PlayerState[],
  participatingPlayerIds?: string[] | null,
  context?: TurnOrderContext,
): string[] {
  let pool = players.filter((p) => !p.eliminated)
  if (participatingPlayerIds?.length) {
    pool = pool.filter((p) => participatingPlayerIds.includes(p.id))
  }
  const slotOrder = pool.map((p) => p.id)

  if (context?.state && usesRegionTurnOrder(context.phase)) {
    return [...slotOrder].sort((a, b) => {
      const diff =
        controlledRegionCountForPlayer(context.state!, a)
        - controlledRegionCountForPlayer(context.state!, b)
      if (diff !== 0) return diff
      return slotOrder.indexOf(a) - slotOrder.indexOf(b)
    })
  }

  return slotOrder
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
      (cell) => cell.ships.some((ship) => ship.ownerId === playerId) && !cell.actionMarkerId,
    )
    if (canPlaceAction || game.actionMarkers.some((marker) => marker.ownerId === playerId)) {
      return true
    }

    const occupiedRegions = new Set(
      game.productionMarkers
        .filter((marker) => marker.ownerId === playerId)
        .map((marker) => marker.targetRegionId),
    )
    return validProductionRegionsForPlayer(state, playerId).some(
      (region) => !occupiedRegions.has(region.id),
    )
  }

  if (state.phase === 'actions') {
    return game.actionMarkers.some(
      (marker) => marker.ownerId === playerId,
    ) && !(game.activePlayerId === playerId && game.actionMarkerResolvedThisTurn)
  }

  return game.productionMarkers.some(
    (marker) => marker.ownerId === playerId,
  ) && !(game.activePlayerId === playerId && game.productionMarkerResolvedThisTurn)
}

function applyTurnState(game: GameSnapshot, state: GameState, prevPhase: Phase, prevActivePlayerId: string | null): void {
  game.phase = state.phase
  game.turnNumber = state.turnNumber
  game.activePlayerId = state.activePlayerId
  game.eventLog = state.eventLog
  syncActionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
  syncProductionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
}

/** Передаёт ход только игрокам, у которых в фазе есть не-pass действие. */
function skipPlayersWithoutPhaseActions(game: GameSnapshot, mapId: string): string[] {
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

  // В этой фазе больше некому ходить: завершаем только её, не пропуская следующую автоматически.
  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  state.activePlayerId = order.at(-1) ?? state.activePlayerId
  const errors = advanceGamePhase(state, game.participatingPlayerIds)
  if (errors.length) return errors
  if (prevPhase === 'production') ensureTurnEventForPhase(game)
  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  return []
}

/** Label for the primary «advance / pass turn» action in UI */
export function phaseAdvanceActionLabel(
  state: GameState,
  participatingPlayerIds?: string[] | null,
  game?: GameSnapshot,
): string {
  const phase = state.phase
  const ctx = turnOrderContext(state)

  if (phase === 'events') {
    if (game && !isTurnEventResolved(game)) {
      return 'Применить событие'
    }
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
      return 'К производству'
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
  } else if (phase === 'actions') {
    state.phase = 'production'
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

export function advanceGameSnapshot(game: GameSnapshot, mapId: string): string[] {
  const advanceErrors = [
    ...validateActionMarkerBeforeAdvance(game),
    ...validateProductionMarkerBeforeAdvance(game),
  ]
  if (advanceErrors.length) return advanceErrors

  if (game.phase === 'events') {
    ensureTurnEventForPhase(game)
    if (!isTurnEventResolved(game)) {
      return ['Сначала примените событие хода']
    }
  }

  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  const participating = game.participatingPlayerIds
  const state = gameStateFromSnapshot(game, mapId)
  const ctx = turnOrderContext(state)

  if (
    state.phase === 'actions'
    && isLastPlayerInPhase(state, participating)
    && game.actionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players, participating, ctx)
    const firstId = order[0]
    if (!firstId) return ['Нет активных игроков']
    state.activePlayerId = firstId
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS.actions}», ход ${playerDisplayName(state, firstId)} (остались маркеры)`,
    )
    game.phase = state.phase
    game.activePlayerId = state.activePlayerId
    game.eventLog = state.eventLog
    syncActionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
    syncProductionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
    return skipPlayersWithoutPhaseActions(game, mapId)
  }

  if (
    state.phase === 'production'
    && isLastPlayerInPhase(state, participating)
    && game.productionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players, participating, ctx)
    const firstId = order[0]
    if (!firstId) return ['Нет активных игроков']
    state.activePlayerId = firstId
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS.production}», ход ${playerDisplayName(state, firstId)} (остались маркеры)`,
    )
    game.phase = state.phase
    game.activePlayerId = state.activePlayerId
    game.eventLog = state.eventLog
    syncActionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
    syncProductionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
    return skipPlayersWithoutPhaseActions(game, mapId)
  }

  const errors = advanceGamePhase(state, participating)
  if (errors.length) return errors

  if (state.phase === 'events') {
    ensureTurnEventForPhase(game)
  }

  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  applyVictoryAndDefeatChecks(game, mapId)
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
  if (
    state.phase === 'production'
    && isLastPlayerInPhase(state, participating)
    && game.productionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players, participating, ctx)
    const nextId = order[0]
    if (!nextId) return 'Далее'
    return `Завершить круг → ${playerDisplayName(state, nextId)}`
  }
  return phaseAdvanceActionLabel(state, participating, game)
}
