import type { GameObservation, LegalAction } from './types.js'
import type { BotPolicy, ScenarioStep } from './scenario.js'

const SKIP_PREFERENCE = [
  // Долги по захвату и перезарядке бот закрывает первыми: иначе планирование не закроется.
  'execute-claim-picks',
  'execute-recharge-picks',
  'update-combat-prep',
  'confirm-combat-destruction',
  'continue-combat',
  'stop-combat',
  'advance-phase',
  'remove-marker',
  'remove-action-marker',
  'execute-marker-movement',
  'execute-marker-bombardment',
]

function isInfoAction(action: LegalAction): boolean {
  return action.type === 'info' || action.id.endsWith('-unresolved') || action.id.endsWith('-used')
}

export function pickTutorialBotAction(
  observation: GameObservation,
  legalActions: LegalAction[],
  policy: BotPolicy,
  scenarioStep?: ScenarioStep,
  botId?: string,
): { actionId: string; params?: Record<string, unknown> } | null {
  const playable = legalActions.filter((a) => a.id !== 'surrender' && !isInfoAction(a))
  if (!playable.length) return null

  if (policy === 'passive') {
    for (const preferred of SKIP_PREFERENCE) {
      const match = playable.find((a) => a.id === preferred)
      if (!match) continue
      if (match.id === 'update-combat-prep') {
        const pending = (observation.mechanics as unknown as {
          pendingCombat?: { prep?: { phase?: string; readyBy?: Record<string, boolean> } } | null
        }).pendingCombat
        if (!botId || pending?.prep?.phase !== 'prep' || pending.prep.readyBy?.[botId]) continue
        const supportSide = scenarioStep?.botSupportSide?.[botId]
        return {
          actionId: match.id,
          params: {
            ready: true,
            ...(supportSide ? { supportSide } : {}),
          },
        }
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
