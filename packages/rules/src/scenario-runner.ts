import type { GameSnapshot } from './save-file.js'
import { HEX_DIRECTIONS } from './map.js'
import { hexKey } from './types.js'
import type { ActionPayload, LegalAction } from './types.js'
import {
  SCENARIO_SELF_PLAYER,
  isCoachScript,
  type ScenarioActionConstraint,
  type ScenarioCondition,
  type ScenarioPlayerRef,
  type ScenarioProgress,
  type ScenarioScript,
  type ScenarioStep,
} from './scenario.js'

export function getCurrentStep(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
): ScenarioStep | null {
  if (!progress || progress.completed || progress.dismissed) return null
  if (progress.scenarioId !== script.id) return null
  return script.steps[progress.stepIndex] ?? null
}

/**
 * Шаг, который действительно показывается игроку прямо сейчас.
 *
 * Отличается от `getCurrentStep` одним: шаг с `showWhen` молчит, пока условие не сбылось.
 * Очередь при этом не двигается — подсказка ждёт своего момента в партии.
 */
export function getVisibleStep(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
  snapshot: GameSnapshot,
  selfPlayerId?: string,
): ScenarioStep | null {
  const step = getCurrentStep(script, progress)
  if (!step?.showWhen) return step
  return matchesCondition(step.showWhen, snapshot, undefined, undefined, { selfPlayerId })
    ? step
    : null
}

/**
 * Решения, которые обучение не ограничивает: это обязательные долги самой партии — выбор
 * клеток захвата, фишек перезарядки, потерь в осаде, доктрины. Без них ход не передаётся,
 * поэтому запрет превратил бы учебный шаг в тупик.
 */
export const SCENARIO_ALWAYS_ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  'execute-claim-picks',
  'execute-recharge-picks',
  'execute-siege-losses',
  'choose-doctrine',
])

/**
 * Сценарий ограничивает действия игрока (полигон) или только подсказывает (подсказчик).
 * Серверу нужно, чтобы отличать фильтр законных действий от простого показа подсказки.
 */
export function scenarioRestrictsActions(script: ScenarioScript): boolean {
  return !isCoachScript(script)
}

export function canPerformScenarioAction(
  step: ScenarioStep | null,
  actionId: string,
  params?: Record<string, unknown>,
): boolean {
  if (!step || step.allowedActions === undefined) return true
  if (SCENARIO_ALWAYS_ALLOWED_ACTIONS.has(actionId)) return true
  return step.allowedActions.some((allowed) => {
    if (typeof allowed === 'string') return allowed === actionId
    return allowed.actionId === actionId && matchesScenarioParams(params, allowed.params)
  })
}

export function filterScenarioLegalActions(
  step: ScenarioStep | null,
  actions: LegalAction[],
): LegalAction[] {
  if (!step || step.allowedActions === undefined) return actions
  const ids = new Set(
    step.allowedActions.map((allowed) =>
      typeof allowed === 'string' ? allowed : allowed.actionId,
    ),
  )
  return actions.filter(
    (action) => action.type === 'info' || ids.has(action.id) || SCENARIO_ALWAYS_ALLOWED_ACTIONS.has(action.id),
  )
}

function matchesPartialValue(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected)
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    const unused = [...actual]
    return expected.every((item) => {
      const index = unused.findIndex((candidate) => matchesPartialValue(candidate, item))
      if (index < 0) return false
      unused.splice(index, 1)
      return true
    })
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const actualRecord = actual as Record<string, unknown>
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => matchesPartialValue(actualRecord[key], value))
}

export function matchesScenarioParams(
  actual?: Record<string, unknown>,
  expected?: Record<string, unknown>,
): boolean {
  if (!expected) return true
  return matchesPartialValue(actual, expected)
}

export function scenarioActionError(
  step: ScenarioStep | null,
  actionId: string,
  params?: Record<string, unknown>,
): string | null {
  if (canPerformScenarioAction(step, actionId, params)) return null
  return step?.hint
    ? `Сейчас другой учебный шаг. ${step.hint}`
    : 'Сейчас выполните действие из учебной подсказки.'
}

/**
 * Подставляет получателя подсказки вместо `@me`. Сценарий подсказчика пишется до партии и не
 * знает, каким по счёту сядет игрок, поэтому пишет `@me`, а не идентификатор.
 */
function resolvePlayerRef(
  ref: ScenarioPlayerRef | undefined,
  extras?: ScenarioAdvanceExtras,
): string | undefined {
  if (ref === SCENARIO_SELF_PLAYER) return extras?.selfPlayerId
  return ref
}

function withinRange(value: number, bounds: { atLeast?: number; atMost?: number }): boolean {
  if (bounds.atLeast != null && value < bounds.atLeast) return false
  if (bounds.atMost != null && value > bounds.atMost) return false
  return true
}

function countControlledCells(snapshot: GameSnapshot, ownerId: string): number {
  return snapshot.cells.filter((cell) => cell.controlOwnerId === ownerId).length
}

function countPowerCenters(snapshot: GameSnapshot, ownerId: string): number {
  return snapshot.cells.filter((cell) => cell.isPowerCenter && cell.controlOwnerId === ownerId)
    .length
}

function countShips(snapshot: GameSnapshot, ownerId: string, shipType?: string): number {
  let total = 0
  for (const cell of snapshot.cells) {
    for (const ship of cell.ships) {
      if (ship.ownerId !== ownerId) continue
      if (shipType != null && ship.type !== shipType) continue
      total += 1
    }
  }
  return total
}

/**
 * На сколько несвязанных областей распалась территория игрока.
 *
 * Считается прямо по снимку обходом в ширину, а не через `buildSpatialSummary`: условию нужно
 * одно число, а сводка строит заодно цепочки снабжения и расстояния.
 */
function countRegions(snapshot: GameSnapshot, ownerId: string): number {
  const owned = new Set<string>()
  for (const cell of snapshot.cells) {
    if (cell.controlOwnerId === ownerId) owned.add(hexKey(cell.coord.q, cell.coord.r))
  }
  const seen = new Set<string>()
  let regions = 0
  for (const start of owned) {
    if (seen.has(start)) continue
    regions += 1
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const current = queue.pop()!
      const [q, r] = current.split(',').map(Number)
      for (const dir of HEX_DIRECTIONS) {
        const key = hexKey(q + dir.q, r + dir.r)
        if (!owned.has(key) || seen.has(key)) continue
        seen.add(key)
        queue.push(key)
      }
    }
  }
  return regions
}

function matchesCondition(
  condition: ScenarioCondition,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
  lastActorId?: string,
  extras?: ScenarioAdvanceExtras,
): boolean {
  switch (condition.type) {
    case 'manual':
      return false
    case 'phase':
      return snapshot.phase === condition.phase
    case 'action': {
      const playerId = resolvePlayerRef(condition.playerId, extras)
      return (
        lastAction?.actionId === condition.actionId
        && (!playerId || playerId === lastActorId)
        && matchesScenarioParams(lastAction.params, condition.params)
      )
    }
    case 'not':
      return !matchesCondition(condition.condition, snapshot, lastAction, lastActorId, extras)
    case 'turn':
      return withinRange(snapshot.turnNumber, condition)
    case 'controlled-cells': {
      const playerId = resolvePlayerRef(condition.playerId, extras)
      if (!playerId) return false
      return withinRange(countControlledCells(snapshot, playerId), condition)
    }
    case 'power-centers': {
      const playerId = resolvePlayerRef(condition.playerId, extras)
      if (!playerId) return false
      return withinRange(countPowerCenters(snapshot, playerId), condition)
    }
    case 'ships': {
      const playerId = resolvePlayerRef(condition.playerId, extras)
      if (!playerId) return false
      return withinRange(countShips(snapshot, playerId, condition.shipType), condition)
    }
    case 'regions': {
      const playerId = resolvePlayerRef(condition.playerId, extras)
      if (!playerId) return false
      return withinRange(countRegions(snapshot, playerId), condition)
    }
    case 'cell': {
      const cell = snapshot.cells.find((candidate) =>
        hexKey(candidate.coord.q, candidate.coord.r) === hexKey(condition.coord.q, condition.coord.r),
      )
      if (!cell) return false
      if (
        Object.prototype.hasOwnProperty.call(condition, 'controlOwnerId')
        && cell.controlOwnerId !== condition.controlOwnerId
      ) return false
      if (condition.ship) {
        const ownerId = resolvePlayerRef(condition.ship.ownerId, extras)
        if (!ownerId) return false
        const count = cell.ships.filter((ship) =>
          ship.ownerId === ownerId
          && (!condition.ship!.type || ship.type === condition.ship!.type),
        ).length
        if (count < (condition.minShips ?? 1)) return false
      }
      return true
    }
    case 'combat':
      if (condition.status === 'active') return Boolean(snapshot.pendingCombat)
      // resolved: бой закончился и есть итог для показа игроку (не просто «нет pending»).
      return !snapshot.pendingCombat && extras?.hasCombatResult === true
    case 'and':
      return condition.conditions.every((c) =>
        matchesCondition(c, snapshot, lastAction, lastActorId, extras),
      )
    case 'or':
      return condition.conditions.some((c) =>
        matchesCondition(c, snapshot, lastAction, lastActorId, extras),
      )
    default:
      return false
  }
}

export interface ScenarioAdvanceExtras {
  /** Есть сохранённый итог раунда/обстрела для UI (например room.lastCombatResult). */
  hasCombatResult?: boolean
  /**
   * Кому показывается подсказка: им подставляется `@me` в условиях. В обучении совпадает с
   * единственным живым игроком, в обычной партии — с тем, кто смотрит на экран.
   */
  selfPlayerId?: string
}

export function shouldAdvanceScenario(
  step: ScenarioStep | null,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
  lastActorId?: string,
  extras?: ScenarioAdvanceExtras,
): boolean {
  if (!step) return false
  // Непоказанная подсказка не может быть пройдена: иначе ход, сделанный до её появления,
  // съел бы её молча и игрок никогда не увидел бы объяснения.
  if (step.showWhen && !matchesCondition(step.showWhen, snapshot, undefined, undefined, extras)) {
    return false
  }
  return matchesCondition(step.advanceWhen, snapshot, lastAction, lastActorId, extras)
}

export function advanceScenarioProgress(
  script: ScenarioScript,
  progress: ScenarioProgress,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
  lastActorId?: string,
  extras?: ScenarioAdvanceExtras,
): ScenarioProgress {
  const step = getCurrentStep(script, progress)
  if (!step || !shouldAdvanceScenario(step, snapshot, lastAction, lastActorId, extras)) return progress
  const nextIndex = progress.stepIndex + 1
  if (nextIndex >= script.steps.length) {
    return { ...progress, completed: true }
  }
  return { ...progress, stepIndex: nextIndex }
}

export function initScenarioProgress(scenarioId: string): ScenarioProgress {
  return { scenarioId, stepIndex: 0, completed: false }
}

export function manualAdvanceProgress(
  script: ScenarioScript,
  progress: ScenarioProgress,
  snapshot?: GameSnapshot,
  selfPlayerId?: string,
): ScenarioProgress {
  const step = snapshot
    ? getVisibleStep(script, progress, snapshot, selfPlayerId)
    : getCurrentStep(script, progress)
  if (!step || step.advanceWhen.type !== 'manual') return progress
  const nextIndex = progress.stepIndex + 1
  if (nextIndex >= script.steps.length) {
    return { ...progress, completed: true }
  }
  return { ...progress, stepIndex: nextIndex }
}

/** Игрок выключил подсказки на время партии. */
export function dismissScenarioProgress(progress: ScenarioProgress): ScenarioProgress {
  return { ...progress, dismissed: true }
}

/** Игрок снова включил подсказки: очередь шагов сохранилась. */
export function restoreScenarioProgress(progress: ScenarioProgress): ScenarioProgress {
  return { ...progress, dismissed: false }
}

export function botPolicyForStep(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
): import('./scenario.js').BotPolicy {
  const step = getCurrentStep(script, progress)
  return step?.botPolicy ?? script.botPolicy
}

export function botPolicyForPlayer(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
  playerId: string,
): import('./scenario.js').BotPolicy {
  const step = getCurrentStep(script, progress)
  return (
    step?.botPolicy
    ?? script.bots?.find((bot) => bot.playerId === playerId)?.policy
    ?? script.botPolicy
  )
}

export function normalizeScenarioActionConstraint(
  allowed: string | ScenarioActionConstraint,
): ScenarioActionConstraint {
  return typeof allowed === 'string' ? { actionId: allowed } : allowed
}
