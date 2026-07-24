import { trimGameEventLog } from './event-log.js'
import { syncActionMarkerTurnTracking, syncProductionMarkerTurnTracking } from './markers.js'
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

export function nextPhase(current: Phase): Phase {
  const idx = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
}

export function activePlayerOrder(players: PlayerState[]): string[] {
  return players.filter((p) => !p.eliminated).map((p) => p.id)
}

export function nextActivePlayerId(players: PlayerState[], currentId: string | null): string | null {
  const order = activePlayerOrder(players)
  if (!order.length) return null
  if (!currentId) return order[0]
  const idx = order.indexOf(currentId)
  if (idx < 0) return order[0]
  return order[(idx + 1) % order.length]
}

export function isLastPlayerInPhase(state: GameState): boolean {
  const order = activePlayerOrder(state.players)
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

/** Label for the primary «advance / pass turn» action in UI */
export function phaseAdvanceActionLabel(state: GameState): string {
  const phase = state.phase

  if (phase === 'events') {
    return 'К планированию'
  }

  if (!isLastPlayerInPhase(state)) {
    const nextId = nextActivePlayerId(state.players, state.activePlayerId)!
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

export function advanceGamePhase(state: GameState): string[] {
  if (!state.activePlayerId) return ['Нет активного игрока']

  const order = activePlayerOrder(state.players)
  if (!order.length) return ['Нет активных игроков']

  const phase = state.phase
  const firstPlayerId = order[0]

  if (phase === 'events') {
    state.phase = 'planning'
    state.activePlayerId = firstPlayerId
    appendPhaseEvent(
      state,
      `Фаза «${PHASE_LABELS.planning}», ход ${playerDisplayName(state, firstPlayerId)}`,
    )
    return []
  }

  if (!isLastPlayerInPhase(state)) {
    const nextId = nextActivePlayerId(state.players, state.activePlayerId)!
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
    state.activePlayerId = firstPlayerId
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

  state.activePlayerId = firstPlayerId
  appendPhaseEvent(
    state,
    `Фаза «${PHASE_LABELS[state.phase]}», ход ${playerDisplayName(state, firstPlayerId)}`,
  )
  return []
}

export function advanceGameSnapshot(game: GameSnapshot, mapId: string): string[] {
  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  const state = gameStateFromSnapshot(game, mapId)

  if (
    state.phase === 'actions'
    && isLastPlayerInPhase(state)
    && game.actionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players)
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
    return []
  }

  if (
    state.phase === 'production'
    && isLastPlayerInPhase(state)
    && game.productionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players)
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
    return []
  }

  const errors = advanceGamePhase(state)
  if (errors.length) return errors

  game.phase = state.phase
  game.turnNumber = state.turnNumber
  game.activePlayerId = state.activePlayerId
  game.eventLog = state.eventLog
  syncActionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
  syncProductionMarkerTurnTracking(game, prevPhase, prevActivePlayerId)
  return []
}

export function phaseAdvanceActionLabelForSnapshot(game: GameSnapshot, mapId: string): string {
  const state = gameStateFromSnapshot(game, mapId)
  if (
    state.phase === 'actions'
    && isLastPlayerInPhase(state)
    && game.actionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players)
    const nextId = order[0]
    if (!nextId) return 'Далее'
    return `Завершить круг → ${playerDisplayName(state, nextId)}`
  }
  if (
    state.phase === 'production'
    && isLastPlayerInPhase(state)
    && game.productionMarkers.length > 0
  ) {
    const order = activePlayerOrder(state.players)
    const nextId = order[0]
    if (!nextId) return 'Далее'
    return `Завершить круг → ${playerDisplayName(state, nextId)}`
  }
  return phaseAdvanceActionLabel(state)
}
