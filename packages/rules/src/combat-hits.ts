import { SHIP_PRODUCTION_COST } from './ships.js'
import type { ShipType } from './types.js'

/**
 * Математика боя на попаданиях (ADR 018).
 *
 * Каждый корабль бросает свои d6 и попадает по порогу своего класса. Точность задаёт только
 * стреляющий: прочность цели говорит, сколько попаданий нужно, чтобы её уничтожить, но не
 * делает её труднее для попадания. Стрельба с чужой клетки (поддержка, обстрел) идёт по тем же
 * правилам, только каждая клетка расстояния прибавляет 1 к нужному значению. Выстрел, которому
 * нужно 7 и больше, невозможен, поэтому отдельной таблицы дальностей нет: дальность выводится
 * из точности.
 */

/** Кубиков у корабля. Боевые кубики и кубики поддержки больше не различаются. */
export const SHIP_DICE: Record<ShipType, number> = {
  destroyer: 1,
  cruiser: 2,
  battleship: 3,
  carrier: 0,
  hyper: 3,
}

/** Порог попадания на d6 при стрельбе в своей клетке. */
export const SHIP_HIT_THRESHOLD: Partial<Record<ShipType, number>> = {
  destroyer: 6,
  cruiser: 5,
  battleship: 4,
  hyper: 3,
}

/** Сколько попаданий нужно, чтобы уничтожить корабль. */
export const SHIP_HULL: Record<ShipType, number> = {
  destroyer: 1,
  cruiser: 2,
  battleship: 3,
  carrier: 2,
  hyper: 2,
}

/**
 * Гиперорудие в бою на своей клетке уязвимо: прочность 1. Это цель для рейда — вблизи оно ещё и
 * не стреляет вовсе, из-за минимальной дальности. Под обстрелом с расстояния держит два
 * попадания, как в таблице.
 */
export const HYPER_HULL_IN_BATTLE = 1

/** Минимальная дальность стрельбы. Только у гиперорудия: по соседям оно не бьёт. */
export const SHIP_MIN_FIRE_RANGE: Partial<Record<ShipType, number>> = {
  hyper: 2,
}

/** Наибольшее значение, которое может выпасть на d6. Нужно больше — выстрел невозможен. */
export const MAX_DIE_VALUE = 6

/** Авианосец: +2 кубика союзнику на своей клетке, +1 — союзнику на соседней. Не складывается. */
export const CARRIER_BONUS_SAME_CELL = 2
export const CARRIER_BONUS_ADJACENT = 1

export interface FireRange {
  min: number
  max: number
}

export function shipDice(type: ShipType): number {
  return SHIP_DICE[type] ?? 0
}

export function shipBaseHitThreshold(type: ShipType): number | null {
  return SHIP_HIT_THRESHOLD[type] ?? null
}

/**
 * Нужное на кубике значение для выстрела с расстояния `distance`.
 * `null` — выстрел невозможен: у корабля нет кубиков, цель ближе минимальной дальности или
 * нужно больше шести.
 */
export function shipHitThreshold(
  type: ShipType,
  distance = 0,
  modifier = 0,
): number | null {
  const base = shipBaseHitThreshold(type)
  if (base == null || shipDice(type) <= 0) return null
  if (distance < (SHIP_MIN_FIRE_RANGE[type] ?? 0)) return null
  const needed = base + distance + modifier
  if (needed > MAX_DIE_VALUE) return null
  // Единица на кубике — всегда промах, даже если модификаторы опустили порог ниже двух.
  return Math.max(2, needed)
}

/** Дальность стрельбы: от минимальной до той, где ещё хватает шестёрки. `null` — не стреляет. */
export function shipFireRange(type: ShipType, modifier = 0): FireRange | null {
  const base = shipBaseHitThreshold(type)
  if (base == null || shipDice(type) <= 0) return null
  const min = SHIP_MIN_FIRE_RANGE[type] ?? 0
  const max = MAX_DIE_VALUE - base - modifier
  if (max < min) return null
  return { min, max }
}

/** Может ли корабль стрелять с чужой клетки — поддерживать и обстреливать. */
export function canShipFireFromDistance(type: ShipType, modifier = 0): boolean {
  const range = shipFireRange(type, modifier)
  return !!range && range.max >= Math.max(1, range.min)
}

export function hitProbability(threshold: number | null): number {
  if (threshold == null) return 0
  const faces = MAX_DIE_VALUE - Math.max(2, threshold) + 1
  return Math.max(0, Math.min(1, faces / MAX_DIE_VALUE))
}

/**
 * Прочность корабля в бою на его клетке: гиперорудие держит одно попадание. Под обстрелом
 * действует обычная прочность — `SHIP_HULL`.
 */
export function shipHullInBattle(type: ShipType): number {
  if (type === 'hyper') return HYPER_HULL_IN_BATTLE
  return SHIP_HULL[type] ?? 1
}

/** Бонус авианосца по расстоянию от авианосца до стреляющего. */
export function carrierBonusAtDistance(distance: number): number {
  if (distance === 0) return CARRIER_BONUS_SAME_CELL
  if (distance === 1) return CARRIER_BONUS_ADJACENT
  return 0
}

/** Ценность корабля для выбора целей: цена постройки. */
export function shipValue(type: ShipType): number {
  const cost = SHIP_PRODUCTION_COST[type]
  return cost ? cost.credits + cost.production : 0
}

/** Один кубик, готовый к броску: чей он и какой порог нужен. */
export interface CombatDieSlot {
  shooterShipId: string
  threshold: number
}

/** Цель, по которой можно стрелять: живой вражеский корабль на клетке боя. */
export interface CombatTargetState {
  shipId: string
  type: ShipType
  hull: number
  damage: number
  /** Ожидаемые попадания этого корабля за раунд — насколько он опасен. */
  threat: number
}

/**
 * Порядок целей по умолчанию: сначала то, что дороже и опаснее на единицу оставшейся
 * прочности. Добить подбитый корабль почти всегда выгоднее, чем начинать новый.
 */
export function defaultTargetOrder(targets: readonly CombatTargetState[]): CombatTargetState[] {
  const score = (t: CombatTargetState) =>
    (shipValue(t.type) + 6 * t.threat) / Math.max(1, t.hull - t.damage)
  return [...targets].sort(
    (a, b) => score(b) - score(a) || a.shipId.localeCompare(b.shipId),
  )
}

/**
 * Распределить кубики по целям.
 *
 * Явные назначения идут первыми, остальные кубики раздаются автоматически: самые точные — на
 * первую цель, пока ожидаемых попаданий не хватит на её оставшуюся прочность, затем на
 * следующую. Если все цели покрыты, лишние кубики идут по кругу — перебор лучше простоя.
 *
 * Возвращает id цели для каждого кубика, в том же порядке, что `dice`.
 */
export function allocateDice(
  dice: readonly CombatDieSlot[],
  targets: readonly CombatTargetState[],
  options: {
    targetPriority?: readonly string[]
    explicit?: Readonly<Record<string, readonly string[]>>
  } = {},
): (string | null)[] {
  const out: (string | null)[] = dice.map(() => null)
  if (targets.length === 0) return out
  const alive = new Set(targets.map((t) => t.shipId))

  const expected = new Map<string, number>()
  const addExpected = (targetId: string, threshold: number) =>
    expected.set(targetId, (expected.get(targetId) ?? 0) + hitProbability(threshold))

  // Явные назначения стреляющего: кубики по порядку, лишние и устаревшие цели отбрасываются.
  if (options.explicit) {
    const cursor = new Map<string, number>()
    dice.forEach((die, index) => {
      const wanted = options.explicit?.[die.shooterShipId]
      if (!wanted) return
      const at = cursor.get(die.shooterShipId) ?? 0
      cursor.set(die.shooterShipId, at + 1)
      const targetId = wanted[at]
      if (targetId && alive.has(targetId)) {
        out[index] = targetId
        addExpected(targetId, die.threshold)
      }
    })
  }

  const byId = new Map(targets.map((t) => [t.shipId, t]))
  const prioritized = (options.targetPriority ?? [])
    .map((id) => byId.get(id))
    .filter((t): t is CombatTargetState => !!t)
  const seen = new Set(prioritized.map((t) => t.shipId))
  const order = [
    ...prioritized,
    ...defaultTargetOrder(targets.filter((t) => !seen.has(t.shipId))),
  ]

  const free = dice
    .map((die, index) => ({ die, index }))
    .filter(({ index }) => out[index] == null)
    .sort((a, b) => a.die.threshold - b.die.threshold || a.index - b.index)

  let next = 0
  for (const target of order) {
    const need = target.hull - target.damage
    while (next < free.length && (expected.get(target.shipId) ?? 0) < need) {
      const slot = free[next++]!
      out[slot.index] = target.shipId
      addExpected(target.shipId, slot.die.threshold)
    }
  }
  let cycle = 0
  while (next < free.length) {
    const slot = free[next++]!
    out[slot.index] = order[cycle % order.length]!.shipId
    cycle += 1
  }
  return out
}
