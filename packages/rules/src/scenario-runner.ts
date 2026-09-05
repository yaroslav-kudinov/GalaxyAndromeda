import type { GameSnapshot } from './save-file.js'
import type { ActionPayload } from './types.js'
import type { ScenarioCondition, ScenarioProgress, ScenarioScript, ScenarioStep } from './scenario.js'

export function getCurrentStep(
  script: ScenarioScript,
  progress: ScenarioProgress | undefined,
): ScenarioStep | null {
  if (!progress || progress.completed) return null
  if (progress.scenarioId !== script.id) return null
  return script.steps[progress.stepIndex] ?? null
}

export function canPerformScenarioAction(
  step: ScenarioStep | null,
  actionId: string,
): boolean {
  if (!step?.allowedActions?.length) return true
  return step.allowedActions.includes(actionId)
}

function matchesCondition(
  condition: ScenarioCondition,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
): boolean {
  switch (condition.type) {
    case 'manual':
      return false
    case 'phase':
      return snapshot.phase === condition.phase
    case 'action':
      return lastAction?.actionId === condition.actionId
    case 'and':
      return condition.conditions.every((c) => matchesCondition(c, snapshot, lastAction))
    default:
      return false
  }
}

export function shouldAdvanceScenario(
  step: ScenarioStep | null,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
): boolean {
  if (!step) return false
  return matchesCondition(step.advanceWhen, snapshot, lastAction)
}

export function advanceScenarioProgress(
  script: ScenarioScript,
  progress: ScenarioProgress,
  snapshot: GameSnapshot,
  lastAction?: ActionPayload,
): ScenarioProgress {
  const step = getCurrentStep(script, progress)
  if (!step || !shouldAdvanceScenario(step, snapshot, lastAction)) return progress
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
