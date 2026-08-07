import type { Phase } from '@galaxy/rules'
import { MAX_ACTION_MARKERS_PER_PLAYER, MAX_FLEET_SIZE_PER_PLAYER, SHIP_LABELS } from '@galaxy/rules'

export type MarkerKind = 'action' | 'production'
export type PlanningSubStep = 'action-markers' | 'production-markers'

/** Иконка шага справки в боковой панели */
export type HelpStepIcon =
  | 'wait'
  | 'event'
  | 'click'
  | 'marker-action'
  | 'marker-prod'
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
  accent: 'planning-action' | 'planning-production' | 'actions' | 'production' | 'events' | 'waiting'
}

export const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Производство',
}

/** CSS-класс акцента для бейджа фазы в UI */
export function phaseAccentClass(phase: Phase | undefined): string {
  switch (phase) {
    case 'events':
      return 'phase--events'
    case 'planning':
      return 'phase--planning'
    case 'actions':
      return 'phase--actions'
    case 'production':
      return 'phase--production'
    default:
      return 'phase--planning'
  }
}

export interface PhaseGuidanceContext {
  planningSubStep?: PlanningSubStep
  actionMarkersPlaced?: number
  actionMarkersMax?: number
  productionMarkersPlaced?: number
  productionMarkersMax?: number
  actionMarkerUsedThisTurn?: boolean
  actionMarkerUnresolved?: boolean
  productionMarkerUsedThisTurn?: boolean
  eventResolved?: boolean
}

/** Подсказка для hero-полоски с учётом фазы и подшага планирования */
export function phaseGuidanceForTurn(
  phase: Phase | undefined,
  isMyTurn: boolean,
  ctx: PhaseGuidanceContext = {},
): PhaseGuidance | null {
  if (!phase) return null

  if (!isMyTurn) {
    return {
      prompt: 'Ожидайте хода активного игрока',
      accent: 'waiting',
    }
  }

  switch (phase) {
    case 'events':
      return {
        prompt: ctx.eventResolved
          ? 'Событие применено — переходите к планированию'
          : 'Откройте карточку события и нажмите «Применить»',
        accent: 'events',
      }
    case 'planning': {
      const actionMax = ctx.actionMarkersMax ?? MAX_ACTION_MARKERS_PER_PLAYER
      const actionPlaced = ctx.actionMarkersPlaced ?? 0
      const actionRemaining = Math.max(0, actionMax - actionPlaced)
      const prodMax = ctx.productionMarkersMax ?? 0
      const prodPlaced = ctx.productionMarkersPlaced ?? 0
      const prodRemaining = Math.max(0, prodMax - prodPlaced)

      if (ctx.planningSubStep === 'production-markers') {
        return {
          prompt: 'Клик по своей клетке в регионе — поставить или снять маркер производства',
          countHint: `Осталось маркеров производства: ${prodRemaining} из ${prodMax}`,
          accent: 'planning-production',
        }
      }
      return {
        prompt: 'Клик по клетке с вашим кораблём — поставить или снять маркер действия',
        countHint: `Осталось маркеров действия: ${actionRemaining} из ${actionMax}`,
        accent: 'planning-action',
      }
    }
    case 'actions':
      if (ctx.actionMarkerUnresolved) {
        return {
          prompt: 'Используйте маркер действия или снимите его с карты',
          accent: 'actions',
        }
      }
      return {
        prompt: ctx.actionMarkerUsedThisTurn
          ? 'Маркер действия уже исполнен в этом ходу — передайте ход'
          : 'Кликните по маркеру действия; после перемещения на вражескую клетку может начаться бой',
        accent: 'actions',
      }
    case 'production': {
      const prodMax = ctx.productionMarkersMax ?? 0
      const prodPlaced = ctx.productionMarkersPlaced ?? 0
      return {
        prompt: ctx.productionMarkerUsedThisTurn
          ? 'Маркер производства уже исполнен в этом ходу — передайте ход'
          : 'Кликните по маркеру производства для постройки',
        countHint: ctx.productionMarkerUsedThisTurn
          ? undefined
          : `Маркеров производства на карте: ${prodPlaced} из ${prodMax}`,
        accent: 'production',
      }
    }
    default:
      return null
  }
}

/** Короткая подсказка для полоски состояния игры */
export function phaseShortPrompt(
  phase: Phase | undefined,
  isMyTurn: boolean,
  markerKind: MarkerKind,
): string {
  const guidance = phaseGuidanceForTurn(phase, isMyTurn, {
    planningSubStep: markerKind === 'production' ? 'production-markers' : 'action-markers',
  })
  if (!guidance) return 'Загрузка…'
  return guidance.countHint ? `${guidance.prompt} · ${guidance.countHint}` : guidance.prompt
}

export function gameHelpForPhase(
  phase: Phase | undefined,
  isMyTurn: boolean,
  markerKind: MarkerKind,
): GameHelpBlock {
  if (!phase) {
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
          detail: 'Жёлтая обводка — действие, розовый пунктир — производство.',
        },
      ],
    }
  }

  if (phase === 'events') {
    return {
      title: 'События',
      steps: [
        {
          icon: 'event',
          label: 'Одна карта на всех',
          detail: 'Каждый ход начинается с одной глобальной карточки события.',
        },
        {
          icon: 'click',
          label: '«Применить»',
          detail: 'Немедленные эффекты сработают сразу; модификаторы действуют до конца хода.',
        },
        {
          icon: 'pass',
          label: 'Далее → планирование',
          detail: 'После применения переходите к фазе планирования.',
        },
      ],
    }
  }

  if (phase === 'planning') {
    const isProductionStep = markerKind === 'production'
    return {
      title: 'Планирование',
      steps: [
        {
          icon: 'queue',
          label: 'Сначала действие, потом производство',
          detail: 'Когда все спланировали, фаза переходит к «Действиям» (снова с игрока 1).',
        },
        isProductionStep
          ? {
              icon: 'marker-prod',
              label: 'Клик — маркер производства',
              detail: 'Клик по своей клетке — поставить или снять маркер производства (розовый пунктир).',
            }
          : {
              icon: 'marker-action',
              label: 'Клик по флоту — маркер действия',
              detail: 'Клик по клетке с вашим кораблём — поставить или снять маркер действия (жёлтая обводка).',
            },
        {
          icon: 'limit',
          label: `Действие: до ${MAX_ACTION_MARKERS_PER_PLAYER} · 1 на клетку`,
          detail: `До ${MAX_ACTION_MARKERS_PER_PLAYER} маркеров действия на игрока, по одному на клетку с вашим кораблём.`,
        },
        {
          icon: 'marker-prod',
          label: 'Производство: 1 + регионы 3 / 5',
          detail:
            'Первый маркер базовый; второй открывают 3, третий — 5 связных регионов от 4 клеток. Ставить — в valid region от 3 клеток.',
        },
        {
          icon: 'tip',
          label: 'Оба маркера на одной клетке',
          detail: 'На одной клетке могут стоять маркеры действия и производства одновременно.',
        },
        {
          icon: 'pass',
          label: isProductionStep ? '← К маркерам действия' : 'Готово → производство',
          detail: isProductionStep
            ? 'Кнопка «← К маркерам действия» вернёт к расстановке маркеров действия.'
            : 'Можно досрочно перейти к маркерам производства кнопкой «Готово с маркерами действия».',
        },
      ],
    }
  }

  if (phase === 'actions') {
    return {
      title: 'Действия',
      steps: [
        {
          icon: 'queue',
          label: 'Очередь: меньше регионов — раньше',
          detail: 'В фазах «Действия» и «Производство» раньше ходит игрок с меньшим числом регионов.',
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
          label: 'Снабженец на нейтрали',
          detail: 'Может занять клетку (снимается с карты) или просто переместиться без захвата.',
        },
      ],
    }
  }

  const fleetLimit = [
    `${SHIP_LABELS.destroyer} ${MAX_FLEET_SIZE_PER_PLAYER.destroyer}`,
    `${SHIP_LABELS.supply} ${MAX_FLEET_SIZE_PER_PLAYER.supply}`,
    `${SHIP_LABELS.cruiser} ${MAX_FLEET_SIZE_PER_PLAYER.cruiser}`,
    `${SHIP_LABELS.battleship} ${MAX_FLEET_SIZE_PER_PLAYER.battleship}`,
    `${SHIP_LABELS.shield} ${MAX_FLEET_SIZE_PER_PLAYER.shield}`,
    `${SHIP_LABELS.hyper} ${MAX_FLEET_SIZE_PER_PLAYER.hyper}`,
  ].join(' · ')

  return {
    title: 'Производство',
    steps: [
      {
        icon: 'queue',
        label: 'Очередь: меньше регионов — раньше',
        detail: 'Строите по маркерам по очереди; раньше ходит игрок с меньшим числом регионов.',
      },
      {
        icon: 'marker-prod',
        label: 'Пока есть маркеры — фаза идёт',
        detail: 'Фаза не заканчивается, пока на карте есть маркеры производства.',
      },
      {
        icon: 'build',
        label: 'Клик → классы → клетки региона',
        detail: 'Клик по маркеру → количество кораблей → размещение по клеткам региона. Оплата с лицевых фишек.',
      },
      {
        icon: 'tip',
        label: 'Перезарядка или постройка',
        detail: 'Если есть лицевые и перевёрнутые фишки производства: либо перезарядка, либо постройка — не оба.',
      },
      {
        icon: 'limit',
        label: 'Лимит флота на игрока',
        detail: fleetLimit,
      },
    ],
  }
}

export function markerKindLabel(kind: MarkerKind): string {
  return kind === 'action' ? 'Действие' : 'Производство'
}

export function markerKindForPhase(phase: Phase | undefined): MarkerKind {
  if (phase === 'production') return 'production'
  return 'action'
}

/** Короткий ярлык типа легального действия для чипа в боковой панели */
export function legalActionChipLabel(action: { type: string; description: string }): string {
  const map: Record<string, string> = {
    'advance-phase': 'Далее',
    'place-action-marker': 'Маркер действия',
    'place-production-marker': 'Маркер производства',
    'remove-action-marker': 'Снять действие',
    'remove-production-marker': 'Снять производство',
    'execute-movement': 'Перемещение',
    'execute-bombardment': 'Обстрел',
    'execute-production': 'Постройка',
    'recharge-production': 'Перезарядка',
    'resolve-event': 'Событие',
    'skip-turn': 'Пропуск',
  }
  if (map[action.type]) return map[action.type]
  const short = action.description.split(/[.(—–-]/)[0]?.trim()
  return short && short.length <= 28 ? short : action.type
}

export function legalActionChipIcon(type: string): HelpStepIcon {
  if (type.includes('production') || type.includes('build') || type.includes('recharge')) return 'build'
  if (type.includes('action') || type.includes('movement') || type.includes('bombard')) return 'marker-action'
  if (type.includes('event')) return 'event'
  if (type.includes('advance') || type.includes('skip')) return 'pass'
  if (type.includes('combat') || type.includes('fight')) return 'fight'
  return 'tip'
}
