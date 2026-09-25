/**
 * Оценка боя для ботов: быстрая, без бросков, по закону Ланчестера.
 *
 * Сила стороны — ожидаемые попадания за раунд, умноженные на оставшуюся прочность. Для
 * прицельного огня это и есть инвариант квадратичного закона: побеждает сторона с большей
 * силой, а победитель теряет долю прочности `1 − √(1 − 1/r)`, где `r` — отношение сил.
 * Монте-Карло движка (`estimateBattleOutcome`) точнее, но слишком дорог, чтобы звать его для
 * каждого варианта хода на каждом шаге бота.
 */

import type { CombatPreview, CombatSidePreview } from './combat.js'
import { hitProbability, SHIP_DICE, SHIP_HIT_THRESHOLD, SHIP_HULL } from './combat-hits.js'
import { SHIP_PRODUCTION_COST } from './ships.js'
import type { ShipType } from './types.js'

/**
 * Боевая сила группы: ожидаемые попадания за раунд, умноженные на суммарную прочность.
 * Грубая оценка по Ланчестеру — сколько группа успеет нанести, прежде чем её выбьют.
 * Бонус авианосца и поддержку не учитывает: бот осторожнее, чем мог бы быть.
 */
export function combatStrength(types: readonly ShipType[]): number {
  let hits = 0
  let hull = 0
  for (const type of types) {
    hits += (SHIP_DICE[type] ?? 0) * hitProbability(SHIP_HIT_THRESHOLD[type] ?? null)
    hull += SHIP_HULL[type] ?? 1
  }
  return hits * hull
}

/** Цена кораблей по стоимости постройки — мера потерь в бою. */
export function fleetValue(types: readonly ShipType[]): number {
  let total = 0
  for (const type of types) {
    const cost = SHIP_PRODUCTION_COST[type]
    total += cost.credits + cost.production
  }
  return total
}

export interface BattleEstimate {
  /** Отношение сил атакующего к защитнику. */
  ratio: number
  /** Вероятность, что атакующий выбьет защитников. */
  winChance: number
  /** Ожидаемые потери атакующего по цене кораблей. */
  attackerLoss: number
  /** Ожидаемые потери защитника по цене кораблей. */
  defenderLoss: number
}

/** Доля прочности, которую теряет победитель при отношении сил `ratio > 1`. */
function winnerLossShare(ratio: number): number {
  if (ratio <= 1) return 1
  return 1 - Math.sqrt(1 - 1 / ratio)
}

/**
 * Шанс победы по отношению сил. Показатель подобран на глаз по Монте-Карло движка:
 * при равных силах — половина, при полуторном перевесе — около семи из десяти, при двойном —
 * около восьми с половиной.
 */
export function winChanceFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1
  if (ratio <= 0) return 0
  const k = 2.4
  const powered = ratio ** k
  return powered / (1 + powered)
}

function sideStrength(side: CombatSidePreview): number {
  let hull = 0
  for (const ship of side.ships) hull += Math.max(0, ship.hull - ship.damage)
  let hits = side.expectedHits
  // Перебросы гарнизона: каждый промах получает второй шанс, пока хватает перебросов.
  if (side.rerollPool && side.diceTotal > 0) {
    const perDie = hits / side.diceTotal
    const misses = side.diceTotal - hits
    hits += Math.min(side.rerollPool, misses) * perDie
  }
  return hits * hull
}

function sideValue(side: CombatSidePreview): number {
  return fleetValue(side.ships.map((ship) => ship.type))
}

/**
 * Оценка боя по превью движка: превью уже учитывает поддержку, авианосцы, доктрины и
 * урон, накопленный в текущем бою.
 */
export function estimatePreview(preview: CombatPreview): BattleEstimate {
  const attacker = sideStrength(preview.attacker)
  const defender = sideStrength(preview.defender)
  return estimateFromStrengths(attacker, defender, sideValue(preview.attacker), sideValue(preview.defender))
}

/** То же по готовым силам — для прикидки без превью. */
export function estimateFromStrengths(
  attacker: number,
  defender: number,
  attackerValue: number,
  defenderValue: number,
): BattleEstimate {
  if (defender <= 0 && attacker <= 0) {
    return { ratio: 1, winChance: 0, attackerLoss: 0, defenderLoss: 0 }
  }
  if (defender <= 0) return { ratio: Infinity, winChance: 0.97, attackerLoss: 0, defenderLoss: defenderValue }
  const ratio = attacker / defender
  const winChance = winChanceFromRatio(ratio)
  // Проигравший обычно отступает после первых потерь, поэтому теряет не всё.
  const attackerShare = ratio >= 1 ? winnerLossShare(ratio) : Math.min(1, 0.45 + 0.35 / Math.max(ratio, 0.35))
  const defenderShare = ratio <= 1 ? winnerLossShare(1 / Math.max(ratio, 1e-6)) : Math.min(1, 0.55 + 0.35 * Math.min(ratio, 3) / 3)
  return {
    ratio,
    winChance,
    attackerLoss: attackerValue * Math.min(1, attackerShare),
    defenderLoss: defenderValue * Math.min(1, defenderShare),
  }
}
