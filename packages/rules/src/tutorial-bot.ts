import type { GameObservation, LegalAction } from './types.js'
import type { BotPolicy, ScenarioStep } from './scenario.js'

const SKIP_PREFERENCE = [
  'advance-phase',
  'remove-marker',
  'remove-action-marker',
  'stop-combat',
  'update-combat-prep',
  'continue-combat',
  'confirm-combat-destruction',
  'execute-marker-movement',
  'execute-marker-bombardment',
]

function isInfoAction(action: LegalAction): boolean {
  return action.type === 'info' || action.id.endsWith('-unresolved') || action.id.endsWith('-used')
}

export function pickTutorialBotAction(
  _observation: GameObservation,
  legalActions: LegalAction[],
  policy: BotPolicy,
  _scenarioStep?: ScenarioStep,
): { actionId: string; params?: Record<string, unknown> } | null {
  const playable = legalActions.filter((a) => a.id !== 'surrender' && !isInfoAction(a))
  if (!playable.length) return null

  if (policy === 'passive') {
    for (const preferred of SKIP_PREFERENCE) {
      const match = playable.find((a) => a.id === preferred)
      if (!match) continue
      if (match.id === 'update-combat-prep') {
        return { actionId: match.id, params: { ready: true } }
      }
      if (match.id === 'remove-marker') {
        return { actionId: match.id, params: {} }
      }
      return { actionId: match.id }
    }
    return { actionId: playable[0]!.id }
  }

  const movement = playable.find((a) => a.id === 'execute-marker-movement')
  if (movement) return { actionId: movement.id }
  const advance = playable.find((a) => a.id === 'advance-phase')
  if (advance) return { actionId: advance.id }
  return { actionId: playable[0]!.id }
}
