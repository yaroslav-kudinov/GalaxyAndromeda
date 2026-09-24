import type { GameSnapshot } from './save-file.js'
import { hexKey } from './types.js'
import type { ActionPayload, LegalAction } from './types.js'
import type {
  ScenarioActionConstraint,
  ScenarioCondition,
  ScenarioProgress,
  ScenarioScript,
  ScenarioStep,
} from './scenario.js'

export function getCurrentStep(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
): ScenarioStep | null {
  if (!progress || progress.completed) return null
  if (progress.scenarioId !== script.id) return null
  return script.steps[progress.stepIndex] ?? null
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
    case 'action':
      return (
        lastAction?.actionId === condition.actionId
        && (!condition.playerId || condition.playerId === lastActorId)
        && matchesScenarioParams(lastAction.params, condition.params)
      )
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
        const count = cell.ships.filter((ship) =>
          ship.ownerId === condition.ship!.ownerId
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
}

export function shouldAdvanceScenario(
  step: ScenarioStep | null,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
  lastActorId?: string,
  extras?: ScenarioAdvanceExtras,
): boolean {
  if (!step) return false
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
): ScenarioProgress {
  const step = getCurrentStep(script, progress)
  if (!step || step.advanceWhen.type !== 'manual') return progress
  const nextIndex = progress.stepIndex + 1
  if (nextIndex >= script.steps.length) {
    return { ...progress, completed: true }
  }
  return { ...progress, stepIndex: nextIndex }
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
