import type { HexCoord, Phase } from './types.js'
export type BotPolicy = 'passive' | 'simple'

/**
 * Два вида сценариев.
 *
 * `tutorial` — полигон: своя карта, свой расклад флотов, каждый шаг разрешает ровно одно
 * действие. Условия шагов опираются на координаты, поэтому воспроизводится только на
 * собственной карте.
 *
 * `coach` — подсказчик обычной партии: ничего не запрещает, карту не выбирает, идентификатор
 * игрока заранее не знает. Поэтому его условия пишутся без координат и без имён игроков —
 * см. `ScenarioPlayerRef` и условия о числах.
 */
export type ScenarioKind = 'tutorial' | 'coach'

/**
 * Кому адресовано условие. Обычное значение — идентификатор игрока, но сценарий подсказчика
 * пишется до партии и не знает, каким по счёту сядет игрок, поэтому вместо идентификатора
 * пишется `@me` — тот, кому показывается подсказка.
 */
export type ScenarioPlayerRef = string

/** Значение `ScenarioPlayerRef`, которое подставляется игроком-получателем подсказки. */
export const SCENARIO_SELF_PLAYER = '@me'

export interface ScenarioActionConstraint {
  actionId: string
  /** Частичное совпадение: перечисляются только важные для урока параметры. */
  params?: Record<string, unknown>
}

export type ScenarioCondition =
  | {
      type: 'action'
      actionId: string
      playerId?: ScenarioPlayerRef
      params?: Record<string, unknown>
    }
  | { type: 'phase'; phase: Phase }
  | {
      type: 'cell'
      coord: HexCoord
      controlOwnerId?: string | null
      ship?: { ownerId: ScenarioPlayerRef; type?: string }
      minShips?: number
    }
  | { type: 'combat'; status: 'active' | 'resolved' }
  | { type: 'manual' }
  | { type: 'and'; conditions: ScenarioCondition[] }
  | { type: 'or'; conditions: ScenarioCondition[] }
  | { type: 'not'; condition: ScenarioCondition }
  /** Номер игрового хода дошёл до указанного. Запасной путь, когда событие может не случиться. */
  | { type: 'turn'; atLeast?: number; atMost?: number }
  /** Сколько клеток под контролем игрока. */
  | {
      type: 'controlled-cells'
      playerId?: ScenarioPlayerRef
      atLeast?: number
      atMost?: number
    }
  /** Сколько центров власти под контролем игрока. */
  | { type: 'power-centers'; playerId?: ScenarioPlayerRef; atLeast?: number; atMost?: number }
  /** Сколько кораблей у игрока; с `shipType` — только указанного класса. */
  | {
      type: 'ships'
      playerId?: ScenarioPlayerRef
      shipType?: string
      atLeast?: number
      atMost?: number
    }
  /**
   * На сколько несвязанных областей распалась территория игрока. `atLeast: 2` — ровно тот
   * случай, который тестировщик принял за «котёл»: клетки есть, а в регион базы не входят.
   */
  | { type: 'regions'; playerId?: ScenarioPlayerRef; atLeast?: number; atMost?: number }

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
  /**
   * Когда подсказку вообще уместно показать. Пока условие не сбылось, шаг молчит и ничего не
   * занимает на экране. Нужен подсказчику обычной партии: объяснение регионов имеет смысл
   * ровно в тот ход, когда территория игрока распалась, а не на третьем экране подряд.
   *
   * Без этого поля шаг показывается сразу, как только до него дошла очередь.
   */
  showWhen?: ScenarioCondition
}

export interface ScenarioScript {
  id: string
  name: string
  /** Вид сценария; без поля — полигон, как было до появления подсказчика. */
  kind?: ScenarioKind
  /** Карта полигона. У подсказчика карты нет: он едет на той, которую выбрал игрок. */
  mapId?: string
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
  /**
   * Игрок выключил подсказки. Шаги не двигаются и не показываются, партия идёт обычным
   * порядком. Относится только к подсказчику: обучение выключают выходом с полигона.
   */
  dismissed?: boolean
}

export function isCoachScript(script: ScenarioScript): boolean {
  return script.kind === 'coach'
}

export function parseScenarioScript(raw: unknown): ScenarioScript {
  if (!raw || typeof raw !== 'object') throw new Error('Некорректный сценарий')
  const s = raw as ScenarioScript
  if (!s.id || !s.name || !Array.isArray(s.steps) || !s.steps.length) {
    throw new Error('Неполный сценарий')
  }
  // Полигон без карты неиграбелен: его шаги привязаны к координатам. Подсказчику карта не нужна.
  if (s.kind !== 'coach' && !s.mapId) throw new Error('Неполный сценарий')
  const bots = Array.isArray(s.bots) && s.bots.length
    ? s.bots.filter((bot) => bot?.playerId && bot?.name)
    : [{
        playerId: s.botPlayerId ?? 'player-2',
        name: s.botName ?? 'Тренировочный противник',
        policy: s.botPolicy ?? 'passive',
      }]
  // Подсказчик ничего не запрещает — это его определение, а не договорённость автора
  // сценария. Поэтому ограничения снимаются при разборе, а не проверяются по месту.
  const steps = s.kind === 'coach'
    ? s.steps.map(({ allowedActions: _unrestricted, ...step }) => step)
    : s.steps
  return {
    ...s,
    steps,
    kind: s.kind ?? 'tutorial',
    solo: s.solo ?? true,
    botPlayerId: s.botPlayerId ?? bots[0]!.playerId,
    botName: s.botName ?? bots[0]!.name,
    botPolicy: s.botPolicy ?? 'passive',
    bots,
  }
}
