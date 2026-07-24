import type { GameObservation, LegalAction } from '@galaxy/rules'

export interface LlmPlayerConfig {
  apiKey?: string
  model?: string
}

export function buildAgentPrompt(observation: GameObservation, legalActions: LegalAction[]): string {
  return [
    'You are a player in Galaxy Andromeda tabletop game.',
    'Read geometry (ASCII map) first for spatial strategy, then mechanics for valid moves.',
    '',
    '## Map (ASCII)',
    observation.geometry.asciiMap,
    '',
    '## Spatial summary',
    JSON.stringify(observation.geometry.spatialSummary, null, 2),
    '',
    '## Mechanics',
    JSON.stringify(observation.mechanics, null, 2),
    '',
    '## Legal actions',
    JSON.stringify(legalActions, null, 2),
    '',
    'Respond with JSON: { "actionId": "...", "params": {} }',
  ].join('\n')
}

export function parseAgentAction(
  response: string,
  legalActions: LegalAction[],
): { actionId: string; params?: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(response) as { actionId?: string; params?: Record<string, unknown> }
    if (!parsed.actionId) return null
    if (!legalActions.some((a) => a.id === parsed.actionId)) return null
    return { actionId: parsed.actionId, params: parsed.params }
  } catch {
    return null
  }
}

export function fallbackAction(legalActions: LegalAction[]): { actionId: string } {
  const first = legalActions[0]
  if (!first) throw new Error('No legal actions available')
  return { actionId: first.id }
}
