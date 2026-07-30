import type { Phase } from '@galaxy/rules'
import { MAX_ACTION_MARKERS_PER_PLAYER, MAX_FLEET_SIZE_PER_PLAYER, SHIP_LABELS } from '@galaxy/rules'

export type MarkerKind = 'action' | 'production'
export type PlanningSubStep = 'action-markers' | 'production-markers'

export interface GameHelpBlock {
  title: string
  lines: string[]
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
      const prodRemaining = Math.max(0, prodMax - prodPlaced)
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
    return { title: 'Подсказка', lines: ['Загрузка состояния игры…'] }
  }

  if (!isMyTurn) {
    return {
      title: 'Ожидание',
      lines: [
        'Сейчас ход другого игрока.',
        'Следите за маркерами на карте и всплывающими сообщениями о смене фазы.',
      ],
    }
  }

  if (phase === 'events') {
    return {
      title: 'События',
      lines: [
        'Каждый ход начинается с одной глобальной карточки события для всех игроков.',
        'Нажмите «Применить» — немедленные эффекты (фишки) сработают сразу; модификаторы действуют до конца хода.',
        'После применения переходите к планированию.',
      ],
    }
  }

  if (phase === 'planning') {
    const isProductionStep = markerKind === 'production'
    return {
      title: 'Планирование',
      lines: [
        'Сначала расставьте маркеры действия, затем — маркеры производства.',
        'Когда все спланировали, фаза переходит к «Действиям» (снова с игрока 1).',
        isProductionStep
          ? 'Клик по **своей** клетке — поставить или снять маркер производства (розовый пунктир).'
          : 'Клик по клетке с **вашим кораблём** — поставить или снять маркер действия (жёлтая обводка).',
        `Действие: до ${MAX_ACTION_MARKERS_PER_PLAYER} маркеров на игрока, 1 на клетку с **вашим кораблём** — куда пойдёте в фазе «Действия».`,
        'Производство: первый маркер базовый; второй открывают **3**, третий — **5** связных контролируемых регионов **от 4 клеток**. На каждый маркер выберите отдельный valid region **от 3 клеток**. Минимальный размер для постройки класса корабля может быть больше (см. ships.yaml).',
        'На одной клетке могут стоять оба маркера одновременно.',
        'Можно досрочно перейти к маркерам производства кнопкой «Готово с маркерами действия».',
        isProductionStep
          ? 'Кнопка «← К маркерам действия» вернёт к расстановке маркеров действия.'
          : 'После перехода к производству можно вернуться к маркерам действия той же кнопкой.',
      ],
    }
  }

  if (phase === 'actions') {
    return {
      title: 'Действия',
      lines: [
        'Исполняются маркеры действий по очереди; в фазах «Действия» и «Производство» раньше ходит игрок с **меньшим числом регионов**.',
        '**Фаза «Действия» не заканчивается**, пока на карте есть маркеры действий (исполненные или снятые).',
        '**За свой ход** можно исполнить один маркер или **снять** другой без действия — только **до** исполнения, с подтверждением.',
        'Клик по клетке с **вашим** маркером открывает выбор кораблей; затем кликайте клетки назначения на карте (подсказка сверху).',
        '**Красные** клетки — оспариваемые (бой): откроется превью с щитами, кубиками и порядком уничтожения.',
        'После перемещения на вражескую клетку начинается бой (priority skip → кубики → щиты 4+2 → уничтожение).',
        'Снять маркер без действия — кнопка в карточке клетки (с подтверждением).',
        'На нейтральной клетке снабженец может **занять** её (снимается с карты) или **просто переместиться** без захвата.',
        'Полное разрешение боя на сервере — в разработке; UI показывает прототип.',
      ],
    }
  }

  return {
    title: 'Производство',
    lines: [
      'Строите корабли по маркерам производства — по очереди; раньше ходит игрок с **меньшим числом регионов**.',
      '**Фаза «Производство» не заканчивается**, пока на карте есть маркеры (исполненные или снятые).',
      '**За свой ход** можно построить по одному маркеру или **снять** другой без постройки — только **до** постройки, с подтверждением.',
      'Клик по **вашем** маркеру → количество кораблей каждого класса → размещение по клеткам **региона** на карте. Оплата списывается автоматически с лицевых фишек.',
      'Если в регионе есть и лицевые, и перевёрнутые фишки **производства**: либо **перезарядка** (переворот производства), либо постройка — не оба.',
      'Класс корабля требует **минимального** размера региона маркера (больше — можно); после оплаты фишки переворачиваются.',
      `**Лимит флота** на игрока (все клетки карты): ${SHIP_LABELS.destroyer} ${MAX_FLEET_SIZE_PER_PLAYER.destroyer}, ${SHIP_LABELS.supply} ${MAX_FLEET_SIZE_PER_PLAYER.supply}, ${SHIP_LABELS.cruiser} ${MAX_FLEET_SIZE_PER_PLAYER.cruiser}, ${SHIP_LABELS.battleship} ${MAX_FLEET_SIZE_PER_PLAYER.battleship}, ${SHIP_LABELS.shield} ${MAX_FLEET_SIZE_PER_PLAYER.shield}, ${SHIP_LABELS.hyper} ${MAX_FLEET_SIZE_PER_PLAYER.hyper}.`,
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
