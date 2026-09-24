import { applyTurnEndClaims, autoResolveAllClaimPicks, claimPicksRemaining } from './claim.js'
import { trimGameEventLog } from './event-log.js'
import {
  autoResolveDoctrines,
  doctrineChoiceOwed,
  openDoctrineWindowIfDue,
} from './doctrines.js'
import { refreshActionMarkerCapacity } from './marker-pools.js'
import {
  syncActionMarkerTurnTracking,
  validateActionMarkerBeforeAdvance,
} from './markers.js'
import {
  autoResolveAllRechargePicks,
  refreshRechargeBudgets,
  rechargePicksRemaining,
} from './resource-recharge.js'
import { applySiegeTick, autoResolveAllSiegeLosses, siegeLossesOwedBy } from './siege.js'
import { applyVictoryAndDefeatChecks, isTurnLimitReached } from './victory.js'
import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState, Phase, PlayerState } from './types.js'

/**
 * Цикл хода: планирование и действия. Фаза «События» снята вместе с колодой (ADR 020);
 * значение `'events'` осталось в типе `Phase` только ради старых сохранений.
 */
export const PHASE_ORDER: Phase[] = ['planning', 'actions']

export const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  // Отдельной фазы производства нет с решения 012: постройка идёт по маркеру
  // действия. Значение осталось только для старых сохранений и показывается
  // как «Действия», потому что ведёт себя точно так же.
  production: 'Действия',
}

export interface TurnOrderContext {
  state?: GameState
  phase?: Phase
}

export function nextPhase(current: Phase): Phase {
  const idx = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(idx + 1) % PHASE_ORDER.length]
}

/**
 * Сид порядка хода. От сида партии, если он есть: иначе порядок зависит только от карты и
 * номера хода и совпадает во всех партиях на этой карте — одно и то же место систематически
 * оказывалось в выгодной позиции (замер: 70 % побед одного места на эталонной дуэли).
 *
 * Без сида партии (обучение, снимки из тестов) остаётся прежнее поведение: обучающие сценарии
 * рассчитаны на конкретную очередь.
 */
function mixTurnOrderSeed(turnNumber: number, mapId: string, matchSeed?: number): number {
  let h = ((turnNumber + 1) * 0x9e3779b9) >>> 0
  if (matchSeed != null) {
    h = Math.imul(h ^ (matchSeed >>> 0), 0x01000193) >>> 0
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0
    return h >>> 0
  }
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
      mulberry32(
        mixTurnOrderSeed(context.state.turnNumber, context.state.mapId, context.state.matchSeed),
      ),
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
    // Долги по доктрине, осаде, захвату и перезарядке — такие же действия фазы
    // планирования, как расстановка маркеров.
    if (doctrineChoiceOwed(game, playerId)) return true
    if (siegeLossesOwedBy(game, playerId).length > 0) return true
    if (claimPicksRemaining(game, playerId) > 0) return true
    if (rechargePicksRemaining(game, playerId) > 0) return true
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
  // Выход из планирования: несделанный выбор не должен подвешивать партию.
  // Порядок тот же, что у игрока: осада, доктрины, захват, перезарядка.
  if (prevPhase === 'planning' && game.phase !== 'planning') {
    autoResolveAllSiegeLosses(game)
    settleAfterDoctrines(game, state.mapId, autoResolveDoctrines(game))
    autoResolveAllClaimPicks(game, state.mapId)
    autoResolveAllRechargePicks(game)
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
  if (game.phase === 'planning' && prevPhase !== 'planning') beginTurnPlanning(game, mapId)
  applyVictoryAndDefeatChecks(game, mapId)
  return []
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
    // Стрелка требовала расшифровки: она значила и «ход уходит игроку»,
    // и «начинается следующая фаза». Теперь адресат назван прямо.
    return `Передать ход: ${name}`
  }

  switch (phase) {
    case 'planning':
      return 'Все спланировали — к действиям'
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

  // Старое сохранение, застрявшее в снятой фазе «События»: просто начинаем планирование.
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

  if (phase === 'actions' || phase === 'production') {
    state.turnNumber += 1
    state.phase = 'planning'
    const planningOrder = activePlayerOrder(state.players, participatingPlayerIds, {
      state,
      phase: 'planning',
    })
    state.activePlayerId = planningOrder[0]!
    appendPhaseEvent(
      state,
      `Ход ${state.turnNumber}, фаза «${PHASE_LABELS.planning}», ход ${playerDisplayName(state, state.activePlayerId)}`,
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

/**
 * Захват и бюджет перезарядки на этот ход. Оба зависят от доктрины: «Экспансия» прибавляет
 * клетку захвата, «Производство» — фишки. Захват первым: он меняет число центров власти, а
 * с ним и бюджет, поэтому бюджет тому, кто выбирает клетки, выдаётся после выбора.
 */
export function settleTurnClaimsAndBudgets(game: GameSnapshot, mapId: string): void {
  applyTurnEndClaims(game, mapId)
  refreshRechargeBudgets(game, (playerId) => claimPicksRemaining(game, playerId) > 0)
}

/** Доктрины вскрыты — лимит захвата и бюджет теперь известны. */
export function settleAfterDoctrines(game: GameSnapshot, mapId: string, revealed: readonly string[]): void {
  if (revealed.length) settleTurnClaimsAndBudgets(game, mapId)
}

/**
 * Начало хода, в самом начале планирования. Порядок важен:
 *
 * 1. маркеры действия — на новый ход;
 * 2. тик осады — гибель последнего корабля гарнизона меняет число центров власти;
 * 3. окно доктрин — доктрина действует с начала хода, в котором выбрана;
 * 4. захват клеток за прошлый ход, затем бюджет перезарядки. Оба зависят от доктрины,
 *    поэтому в первый ход окна ждут, пока доктрины вскроют (`settleAfterDoctrines`).
 *
 * Игрок решает в том же порядке — см. `planningStepFor`.
 */
export function beginTurnPlanning(game: GameSnapshot, mapId: string): void {
  refreshActionMarkerCapacity(game)
  applySiegeTick(game)
  // Ход сверх лимита не играется — партию сейчас решит лимит, новое окно доктрин ни к чему.
  const lastTurnPlayed = isTurnLimitReached(game)
  if (!lastTurnPlayed) openDoctrineWindowIfDue(game)
  game.claimPicksRemainingByPlayer = {}
  game.rechargePicksRemainingByPlayer = {}
  if (!game.doctrineChoice) settleTurnClaimsAndBudgets(game, mapId)
  // Выбирать клетки уже некому, а захват последнего хода должен войти в итог.
  if (lastTurnPlayed) autoResolveAllClaimPicks(game, mapId)
}

/**
 * Старое сохранение в снятой фазе «События»: перевести его в планирование того же хода.
 * Вызывается при каждом чтении состояния, поэтому обязана быть идемпотентной.
 */
export function leaveLegacyEventsPhase(game: GameSnapshot, mapId: string): string[] {
  if (game.phase !== 'events') return []
  const state = gameStateFromSnapshot(game, mapId)
  const prevPhase = game.phase
  const prevActivePlayerId = game.activePlayerId
  const errors = advanceGamePhase(state, game.participatingPlayerIds)
  if (errors.length) return errors
  applyTurnState(game, state, prevPhase, prevActivePlayerId)
  beginTurnPlanning(game, mapId)
  return []
}

export function advanceGameSnapshot(game: GameSnapshot, mapId: string): string[] {
  const advanceErrors = [...validateActionMarkerBeforeAdvance(game)]
  if (advanceErrors.length) return advanceErrors
  const legacyErrors = leaveLegacyEventsPhase(game, mapId)
  if (legacyErrors.length) return legacyErrors
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
  if (game.phase === 'planning' && prevPhase !== 'planning') beginTurnPlanning(game, mapId)
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
    return `Новый круг, ход: ${playerDisplayName(state, nextId)}`
  }
  return phaseAdvanceActionLabel(state, participating, game)
}

/** Место игрока в очереди текущего круга — для показа очерёдности в интерфейсе. */
export interface TurnQueueEntry {
  playerId: string
  name: string
  color: string
  /** Место в очереди, счёт с единицы */
  position: number
  /** Сейчас ходит этот игрок */
  isActive: boolean
  /** Свой ход в текущем круге игрок уже сделал */
  hasMoved: boolean
}

/**
 * Очередь хода на текущий круг: тот же порядок, по которому ходят игроки.
 * Выбывшие и неучаствующие в очередь не попадают.
 */
export function turnQueueForSnapshot(game: GameSnapshot, mapId: string): TurnQueueEntry[] {
  const state = gameStateFromSnapshot(game, mapId)
  const order = activePlayerOrder(state.players, game.participatingPlayerIds, turnOrderContext(state))
  const activeIndex = state.activePlayerId ? order.indexOf(state.activePlayerId) : -1
  return order.map((playerId, index) => {
    const player = state.players.find((p) => p.id === playerId)
    return {
      playerId,
      name: player?.name ?? playerId,
      color: player?.color ?? '#94a3b8',
      position: index + 1,
      isActive: index === activeIndex,
      hasMoved: activeIndex > 0 && index < activeIndex,
    }
  })
}
