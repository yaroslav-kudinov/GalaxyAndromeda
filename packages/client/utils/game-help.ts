import type { Phase } from '@galaxy/rules'
import { MAX_FLEET_SIZE_PER_PLAYER, SHIP_LABELS } from '@galaxy/rules'

/** Иконка шага справки в боковой панели */
export type HelpStepIcon =
  | 'wait'
  | 'event'
  | 'click'
  | 'marker-action'
  | 'ship'
  | 'fight'
  | 'build'
  | 'queue'
  | 'limit'
  | 'pass'
  | 'tip'

export interface GameHelpStep {
  icon: HelpStepIcon
  /** Короткая подпись в UI */
  label: string
  /** Полный текст для title/aria */
  detail?: string
}

export interface GameHelpBlock {
  title: string
  steps: GameHelpStep[]
}

export interface PhaseGuidance {
  prompt: string
  countHint?: string
  accent: 'planning-action' | 'actions' | 'events' | 'waiting'
}

export const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Действия',
}

/** CSS-класс акцента для бейджа фазы в UI */
export function phaseAccentClass(phase: Phase | undefined): string {
  switch (phase) {
    case 'events':
      return 'phase--events'
    case 'planning':
      return 'phase--planning'
    case 'actions':
    case 'production':
      return 'phase--actions'
    default:
      return 'phase--planning'
  }
}

export interface PhaseGuidanceContext {
  actionMarkersPlaced?: number
  actionMarkersMax?: number
  actionMarkerUsedThisTurn?: boolean
  actionMarkerUnresolved?: boolean
  eventResolved?: boolean
}

function normalizePhase(phase: Phase | undefined): Phase | undefined {
  if (phase === 'production') return 'actions'
  return phase
}

/** Подсказка для hero-полоски с учётом фазы */
export function phaseGuidanceForTurn(
  phase: Phase | undefined,
  isMyTurn: boolean,
  ctx: PhaseGuidanceContext = {},
): PhaseGuidance | null {
  const normalized = normalizePhase(phase)
  if (!normalized) return null

  if (!isMyTurn) {
    return {
      prompt: 'Ожидайте хода активного игрока',
      accent: 'waiting',
    }
  }

  switch (normalized) {
    case 'events':
      return {
        prompt: 'Карта события применяется автоматически — дальше планирование',
        accent: 'events',
      }
    case 'planning': {
      const actionMax = ctx.actionMarkersMax ?? 0
      const actionPlaced = ctx.actionMarkersPlaced ?? 0
      const actionRemaining = Math.max(0, actionMax - actionPlaced)
      return {
        prompt: 'Клик по клетке с вашим кораблём — поставить или снять маркер действия',
        countHint: `Осталось маркеров действия: ${actionRemaining} из ${actionMax}`,
        accent: 'planning-action',
      }
    }
    case 'actions':
      if (ctx.actionMarkerUnresolved) {
        return {
          prompt: 'Используйте маркер: перемещение, постройка кораблей или снимите маркер с карты',
          accent: 'actions',
        }
      }
      return {
        prompt: ctx.actionMarkerUsedThisTurn
          ? 'Маркер действия уже исполнен в этом ходу — передайте ход'
          : 'Кликните по маркеру действия: перемещение, постройка или обстрел; на вражеской клетке может начаться бой',
        accent: 'actions',
      }
    default:
      return null
  }
}

/** Короткая подсказка для полоски состояния игры */
export function phaseShortPrompt(
  phase: Phase | undefined,
  isMyTurn: boolean,
): string {
  const guidance = phaseGuidanceForTurn(phase, isMyTurn)
  if (!guidance) return 'Загрузка…'
  return guidance.countHint ? `${guidance.prompt} · ${guidance.countHint}` : guidance.prompt
}

export function gameHelpForPhase(
  phase: Phase | undefined,
  isMyTurn: boolean,
): GameHelpBlock {
  const normalized = normalizePhase(phase)
  if (!normalized) {
    return {
      title: 'Подсказка',
      steps: [{ icon: 'wait', label: 'Загрузка…', detail: 'Загрузка состояния игры' }],
    }
  }

  if (!isMyTurn) {
    return {
      title: 'Ожидание',
      steps: [
        {
          icon: 'wait',
          label: 'Ход другого игрока',
          detail: 'Сейчас ход другого игрока. Следите за маркерами на карте и сменой фазы.',
        },
        {
          icon: 'tip',
          label: 'Маркеры на карте',
          detail: 'Жёлтая обводка — маркер действия.',
        },
      ],
    }
  }

  if (normalized === 'events') {
    return {
      title: 'События',
      steps: [
        {
          icon: 'event',
          label: 'Одна карта на всех',
          detail: 'Каждый ход начинается с одной глобальной карточки события.',
        },
        {
          icon: 'event',
          label: 'Применяется сразу',
          detail: 'Немедленные эффекты срабатывают сами; модификаторы действуют до конца хода. Появляется объявление карты — закрыть «Понятно», эффект уже применён.',
        },
        {
          icon: 'pass',
          label: 'Сразу к планированию',
          detail: 'После автоматического применения начинается фаза планирования.',
        },
      ],
    }
  }

  if (normalized === 'planning') {
    return {
      title: 'Планирование',
      steps: [
        {
          icon: 'queue',
          label: 'Очередь: случайная на ход',
          detail: 'Порядок игроков разыгрывается в начале хода и один на планирование и действия.',
        },
        {
          icon: 'marker-action',
          label: 'Клик по флоту — маркер действия',
          detail: 'Клик по клетке с вашим кораблём — поставить или снять маркер действия (жёлтая обводка).',
        },
        {
          icon: 'limit',
          label: 'Действие: три плюс центры власти · 1 на клетку',
          detail:
            'Маркеров действия: три плюс число ваших центров власти (при одном центре — четыре), пересчёт в начале хода; по одному на клетку с вашим кораблём.',
        },
        {
          icon: 'build',
          label: 'Постройка — в фазе «Действия»',
          detail:
            'Клик по маркеру действия: перемещение или постройка кораблей на клетке маркера за фишки региона.',
        },
      ],
    }
  }

  return {
    title: 'Действия',
    steps: [
      {
        icon: 'queue',
        label: 'Очередь как в планировании',
        detail: 'В «Действиях» ходят в том же порядке, что зафиксирован на этот игровой ход.',
      },
      {
        icon: 'build',
        label: 'Постройка по маркеру действия',
        detail: 'Клик по маркеру — окно постройки: корабли появляются на клетке маркера, оплата фишками региона.',
      },
      {
        icon: 'marker-action',
        label: 'Пока есть маркеры — фаза идёт',
        detail: 'Фаза не заканчивается, пока на карте есть маркеры действий.',
      },
      {
        icon: 'click',
        label: '1 маркер за ход (или снять)',
        detail:
          'За свой ход можно исполнить один маркер или снять другой без действия — только до исполнения, с подтверждением.',
      },
      {
        icon: 'ship',
        label: 'Клик → корабли → маршрут',
        detail: 'Клик по вашему маркеру открывает выбор кораблей; затем кликайте клетки назначения.',
      },
      {
        icon: 'fight',
        label: 'Красные клетки — бой',
        detail: 'Оспариваемые клетки: превью с щитами, кубиками и порядком уничтожения.',
      },
      {
        icon: 'tip',
        label: 'Объявление контроля — после действий',
        detail: 'Нейтральные клетки с вашими кораблями (включая эсминцы) переходят под ваш контроль в конце хода после фазы «Действия».',
      },
    ],
  }
}

/** Короткий ярлык типа легального действия для чипа в боковой панели */
export function legalActionChipLabel(action: { type: string; description: string }): string {
  const map: Record<string, string> = {
    'advance-phase': 'Далее',
    'place-action-marker': 'Маркер действия',
    'remove-action-marker': 'Снять действие',
    'execute-movement': 'Перемещение',
    'execute-bombardment': 'Обстрел',
    'execute-production': 'Постройка',
    surrender: 'Сдача',
    'recharge-production': 'Перезарядка',
    'resolve-event': 'Событие',
    'skip-turn': 'Пропуск',
  }
  if (map[action.type]) return map[action.type]
  const short = action.description.split(/[.(—–-]/)[0]?.trim()
  return short && short.length <= 28 ? short : action.type
}

export function legalActionChipIcon(type: string): HelpStepIcon {
  if (type.includes('build') || type.includes('recharge') || type === 'execute-production') return 'build'
  if (type.includes('action') || type.includes('movement') || type.includes('bombard')) return 'marker-action'
  if (type.includes('event')) return 'event'
  if (type.includes('advance') || type.includes('skip')) return 'pass'
  if (type.includes('combat') || type.includes('fight')) return 'fight'
  return 'tip'
}
