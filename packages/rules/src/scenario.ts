import type { Phase } from './types.js'

export type BotPolicy = 'passive' | 'simple'

export type ScenarioCondition =
  | { type: 'action'; actionId: string }
  | { type: 'phase'; phase: Phase }
  | { type: 'manual' }
  | { type: 'and'; conditions: ScenarioCondition[] }

export type ScenarioHighlight =
  | { q: number; r: number }
  | 'phase-panel'
  | 'board'

export interface ScenarioStep {
  id: string
  title: string
  body: string
  botPolicy?: BotPolicy
  highlight?: ScenarioHighlight
  allowedActions?: string[]
  advanceWhen: ScenarioCondition
}

export interface ScenarioScript {
  id: string
  name: string
  mapId: string
  solo: boolean
  botPlayerId: string
  botName: string
  botPolicy: BotPolicy
  initialSave?: Record<string, unknown>
  steps: ScenarioStep[]
}

export interface ScenarioProgress {
  scenarioId: string
  stepIndex: number
  completed?: boolean
}

export function parseScenarioScript(raw: unknown): ScenarioScript {
  if (!raw || typeof raw !== 'object') throw new Error('Некорректный сценарий')
  const s = raw as ScenarioScript
  if (!s.id || !s.name || !s.mapId || !Array.isArray(s.steps) || !s.steps.length) {
    throw new Error('Неполный сценарий')
  }
  return {
    ...s,
    solo: s.solo ?? true,
    botPlayerId: s.botPlayerId ?? 'player-2',
    botName: s.botName ?? 'Тренировочный противник',
    botPolicy: s.botPolicy ?? 'passive',
  }
}
