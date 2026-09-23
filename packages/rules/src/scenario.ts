import type { HexCoord, Phase } from './types.js'
export type BotPolicy = 'passive' | 'simple'

export interface ScenarioActionConstraint {
  actionId: string
  /** Частичное совпадение: перечисляются только важные для урока параметры. */
  params?: Record<string, unknown>
}

export type ScenarioCondition =
  | { type: 'action'; actionId: string; playerId?: string; params?: Record<string, unknown> }
  | { type: 'phase'; phase: Phase }
  | {
      type: 'cell'
      coord: HexCoord
      controlOwnerId?: string | null
      ship?: { ownerId: string; type?: string }
      minShips?: number
    }
  | { type: 'combat'; status: 'active' | 'resolved' }
  | { type: 'manual' }
  | { type: 'and'; conditions: ScenarioCondition[] }
  | { type: 'or'; conditions: ScenarioCondition[] }

export type ScenarioHighlight =
  | { q: number; r: number }
  | 'phase-panel'
  | 'board'

export interface ScenarioBot {
  playerId: string
  name: string
  policy?: BotPolicy
}

export interface ScenarioStep {
  id: string
  title: string
  body: string
  /** Одно короткое действие, которое игрок должен сделать сейчас. */
  objective?: string
  /** Зачем это действие нужно в обычной партии. */
  why?: string
  /** Подсказка, если игрок не понимает, куда нажимать. */
  hint?: string
  botPolicy?: BotPolicy
  botSupportSide?: Record<string, 'attacker' | 'defender'>
  highlight?: ScenarioHighlight
  allowedActions?: Array<string | ScenarioActionConstraint>
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
  /** Несколько учебных флотов; старые botPlayerId/botName остаются совместимыми. */
  bots?: ScenarioBot[]
  initialSave?: Record<string, unknown>
  /**
   * Все кубики в боях сценария выпадают этим значением. Обучение показывает правило, а не
   * везение: шаг «обстрел уничтожил эсминец» должен сбываться всегда.
   */
  scriptedDiceValue?: number
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
  const bots = Array.isArray(s.bots) && s.bots.length
    ? s.bots.filter((bot) => bot?.playerId && bot?.name)
    : [{
        playerId: s.botPlayerId ?? 'player-2',
        name: s.botName ?? 'Тренировочный противник',
        policy: s.botPolicy ?? 'passive',
      }]
  return {
    ...s,
    solo: s.solo ?? true,
    botPlayerId: s.botPlayerId ?? bots[0]!.playerId,
    botName: s.botName ?? bots[0]!.name,
    botPolicy: s.botPolicy ?? 'passive',
    bots,
  }
}
