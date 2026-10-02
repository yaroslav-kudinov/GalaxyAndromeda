/**
 * Как показать прогноз боя человеку.
 *
 * Игрок решает на один раунд, поэтому главное число — ожидаемый урон за раунд: «выбьете
 * 1,2 корабля, потеряете 0,7». Исход боя до конца описывает всю цепочку раундов, в которую
 * игрок ещё не обязан идти, — он уходит в подробности.
 *
 * Слово «взаимно» заменено на «размен»: по отзыву живого игрока «взаимно» не читается как
 * «оба флота уничтожены».
 */
import type {
  BattleOutcomeOdds,
  CombatDiceReport,
  CombatRole,
  RoundDamageForecast,
} from '@galaxy/rules'
import { SHIP_LABELS } from '@galaxy/rules'
import { pluralRu } from './ru-plural'

/** Число с запятой вместо точки: «1,2». Целое показываем без дробной части. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(1).replace('.', ',')
}

/**
 * Корабли с числом: «1 корабль», «2 корабля», «0,7 корабля».
 * После дробного числа по-русски идёт родительный падеж единственного числа — «корабля».
 */
export function formatShips(value: number): string {
  const rounded = Math.round(value * 10) / 10
  const text = formatNumber(rounded)
  if (!Number.isInteger(rounded)) return `${text} корабля`
  return `${text} ${pluralRu(rounded, 'корабль', 'корабля', 'кораблей')}`
}

export interface RoundDamageStat {
  label: string
  value: string
  tone: 'deal' | 'take'
  /** Вероятность, что за раунд погибнет хотя бы один корабль, — для подписи. */
  anyLoss: number
}

/**
 * Два числа, которые игрок видит крупно: сколько выбьет и сколько потеряет за один раунд.
 * `viewer` — на чьей стороне смотрящий; `null` — он наблюдатель, тогда стороны названы прямо.
 */
export function roundDamageStats(
  round: RoundDamageForecast,
  viewer: CombatRole | null,
): RoundDamageStat[] {
  if (viewer === 'defender') {
    return [
      { label: 'Выбьете за раунд', value: formatShips(round.attackerLosses), tone: 'deal', anyLoss: round.attackerAnyLoss },
      { label: 'Потеряете за раунд', value: formatShips(round.defenderLosses), tone: 'take', anyLoss: round.defenderAnyLoss },
    ]
  }
  if (viewer === 'attacker') {
    return [
      { label: 'Выбьете за раунд', value: formatShips(round.defenderLosses), tone: 'deal', anyLoss: round.defenderAnyLoss },
      { label: 'Потеряете за раунд', value: formatShips(round.attackerLosses), tone: 'take', anyLoss: round.attackerAnyLoss },
    ]
  }
  return [
    { label: 'Атакующий выбьет за раунд', value: formatShips(round.defenderLosses), tone: 'deal', anyLoss: round.defenderAnyLoss },
    { label: 'Защитник выбьет за раунд', value: formatShips(round.attackerLosses), tone: 'take', anyLoss: round.attackerAnyLoss },
  ]
}

/** Одна строка «в среднем за раунд» — для свёрнутой панели и подписей. */
export function roundDamageLine(round: RoundDamageForecast, viewer: CombatRole | null): string {
  const [deal, take] = roundDamageStats(round, viewer)
  return `${deal!.label.toLowerCase()} ${deal!.value}, ${take!.label.toLowerCase()} ${take!.value}`
}

export interface OutcomeRow {
  label: string
  /** Чем обернётся исход, человеческими словами. */
  hint: string
  value: number
  tone: 'win' | 'draw' | 'defeat'
}

/**
 * Исход боя до конца, повёрнутый к смотрящему. `BattleOutcomeOdds` считается со стороны
 * атакующего, поэтому защитнику победа и поражение меняются местами.
 */
export function outcomeRows(odds: BattleOutcomeOdds, viewer: CombatRole | null): OutcomeRow[] {
  const draw: OutcomeRow = {
    label: 'Размен',
    hint: 'оба флота уничтожены',
    value: odds.draw,
    tone: 'draw',
  }
  if (viewer === null) {
    return [
      { label: 'Победа атакующего', hint: 'защитник выбит, клетка переходит', value: odds.win, tone: 'win' },
      draw,
      { label: 'Победа защитника', hint: 'атакующий выбит, клетка остаётся', value: odds.defeat, tone: 'defeat' },
    ]
  }
  const win = viewer === 'attacker' ? odds.win : odds.defeat
  const defeat = viewer === 'attacker' ? odds.defeat : odds.win
  return [
    { label: 'Победа', hint: 'вражеский флот выбит, ваш уцелел', value: win, tone: 'win' },
    draw,
    { label: 'Поражение', hint: 'ваш флот выбит', value: defeat, tone: 'defeat' },
  ]
}

/** Заголовок подробностей: точный расчёт или оценка прогонами. */
export function outcomeHeading(exact: boolean): string {
  return exact ? 'Если драться до конца' : 'Если драться до конца (оценка)'
}

export function outcomeNote(exact: boolean): string {
  return exact
    ? 'Точный расчёт по характеристикам кораблей: бой до конца, без отступлений. Число не меняется между пересчётами.'
    : 'Флот слишком большой для точного перебора — это оценка по прогонам, она может немного колебаться.'
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Откуда у стороны кубики: по строке на корабль и строка итога. Это снимает вопросы про
 * поддержку с соседних клеток и прибавку авианосца — и сразу показывает, если в бой почему-то
 * попал не весь флот.
 */
export function diceBreakdownLines(report: CombatDiceReport): string[] {
  const dice = (count: number) => `${count} ${pluralRu(count, 'кубик', 'кубика', 'кубиков')}`
  const lines = report.sources.map((source) => {
    const name = SHIP_LABELS[source.type] ?? source.type
    const where = source.distance > 0 && source.fromCoord
      ? ` с (${source.fromCoord.q}, ${source.fromCoord.r})`
      : ''
    const kind = source.distance > 0 ? ' поддержки' : ''
    const bonus = source.bonusDice > 0 ? `, из них ${dice(source.bonusDice)} от авианосца` : ''
    return `${name}${where} — ${dice(source.dice)}${kind}${bonus}, нужно ${source.threshold}+`
  })
  for (const ship of report.silent) {
    const name = SHIP_LABELS[ship.type] ?? ship.type
    if (ship.reason === 'destroyed') lines.push(`${name} — выбит, больше не стреляет`)
    else if (ship.reason === 'no-weapon') lines.push(`${name} — не стреляет: нет орудий`)
    else lines.push(`${name} — не стреляет: цель слишком близко`)
  }
  lines.push(`Итого ${dice(report.total)}`)
  return lines
}
