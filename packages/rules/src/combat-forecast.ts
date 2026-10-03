/**
 * Прогноз боя: сколько кораблей вылетит за раунд и чем бой кончится.
 *
 * Бой на попаданиях (ADR 018) считается точно, без случайных прогонов. Кубиков конечное число,
 * нужное значение на кубике известно, прочность целая — значит число попаданий за раунд это
 * сумма независимых испытаний, то есть распределение, которое выписывается в лоб. Состояние
 * боя — накопленный урон каждого корабля; раунд превращает распределение по состояниям в новое
 * распределение. Ответ один и тот же при каждом пересчёте: больше ничего не «бегает».
 *
 * Прогоны остались запасным путём: когда кораблей столько, что перебор состояний не влезает в
 * отведённую работу, считаем Монте-Карло и честно помечаем ответ как оценку (`exact: false`).
 */

import {
  allocateDice,
  hitProbability,
  type CombatDieSlot,
} from './combat-hits.js'
import {
  combatSideFirepower,
  combatSideShooters,
  combatSideTargets,
  estimateBattleOutcome,
  type BattleOutcomeOdds,
  type CombatPreview,
  type CombatRole,
  type CombatSidePreview,
} from './combat.js'

/** Ожидаемый итог одного раунда — то число, по которому игрок решает, драться ли. */
export interface RoundDamageForecast {
  /** Ожидаемых попаданий атакующего за раунд. */
  attackerHits: number
  /** Ожидаемых попаданий защитника за раунд. */
  defenderHits: number
  /** Сколько кораблей защитника в среднем погибнет за раунд (дробное число). */
  defenderLosses: number
  /** Сколько кораблей атакующего в среднем погибнет за раунд. */
  attackerLosses: number
  /** Вероятность, что за раунд погибнет хотя бы один корабль защитника. */
  defenderAnyLoss: number
  /** Вероятность, что за раунд погибнет хотя бы один корабль атакующего. */
  attackerAnyLoss: number
}

export interface BattleForecast {
  /** Первый раунд — он всегда считается точно. */
  round: RoundDamageForecast
  /** Бой до конца, без отступлений, с точки зрения атакующего. */
  outcome: BattleOutcomeOdds
  /** `true` — вероятности исхода точные; `false` — Монте-Карло, подписывать «оценка». */
  exact: boolean
  /** Прогонов, если считали прогонами. */
  samples?: number
}

export interface ForecastOptions {
  /** Потолок раундов. Остаток вероятности, не дошедший до исхода, уходит в «размен». */
  maxRounds?: number
  /**
   * Сколько переходов между состояниями разрешено перебрать. Превышение — переход на прогоны.
   * Подобрано так, чтобы живые бои (до четырёх кораблей на сторону с поддержкой) считались
   * точно, а перебор на десятке кораблей не вешал интерфейс.
   */
  workBudget?: number
  /**
   * Потолок числа состояний боя (произведение «прочность + 1» по всем кораблям). Больше —
   * сразу на прогоны, не тратя время на перебор, который всё равно упрётся в бюджет.
   */
  stateLimit?: number
  /** Прогонов в запасном пути. */
  samples?: number
  /** Генератор для запасного пути — в тестах подменяется. */
  rng?: () => number
}

const DEFAULT_MAX_ROUNDS = 40
const DEFAULT_WORK_BUDGET = 400_000
const DEFAULT_SAMPLES = 400
/** Четыре крейсера на сторону — около семи тысяч состояний; это и есть разумный предел. */
const DEFAULT_STATE_LIMIT = 10_000
/** Состояния легче этого порога отбрасываем: на показанные проценты они не влияют. */
const STATE_PRUNE_THRESHOLD = 1e-9

/** Участник боя для расчёта: прочность, полученный урон и свой разряд в ключе стороны. */
interface ForecastShip {
  shipId: string
  hull: number
  damage: number
  /** Вес разряда этого корабля в ключе урона своей стороны. */
  radix: number
}

/** Кубики стороны, разложенные по целям: для каждой цели — вероятности попадания каждого кубика. */
interface SideFire {
  /** id цели → вероятности попадания кубиков, направленных на неё. */
  byTarget: Map<string, number[]>
  /** Ожидаемых попаданий всего. */
  expectedHits: number
}

/**
 * Куда полетят кубики стороны в этом раунде и с какой вероятностью каждый попадёт.
 *
 * Повторяет путь настоящего раунда: кубики собираются в том же порядке (сначала корабли на
 * клетке боя, потом поддержка), раздаются тем же `allocateDice`. Перебросы осаждённого
 * (ADR 019) входят в вероятность: за проход перебрасываются все промахи, поэтому кубик
 * гарнизона попадает с вероятностью `1 − (1 − p)^(проходов + 1)`.
 */
function sideFire(
  preview: CombatPreview,
  role: CombatRole,
  damageByShipId: Readonly<Record<string, number>>,
): SideFire {
  const byTarget = new Map<string, number[]>()
  let expectedHits = 0
  if (preview.trigger === 'bombardment' && role === 'defender') return { byTarget, expectedHits }

  const side: CombatSidePreview = role === 'attacker' ? preview.attacker : preview.defender
  const targets = combatSideTargets(
    role === 'attacker' ? preview.defender : preview.attacker,
    damageByShipId,
  )
  if (!targets.length) return { byTarget, expectedHits }

  const slots: CombatDieSlot[] = []
  const shooters = combatSideShooters(side, damageByShipId)
  const shooterOfSlot: typeof shooters = []
  for (const shooter of shooters) {
    for (let i = 0; i < shooter.dice; i++) {
      slots.push({ shooterShipId: shooter.shipId, threshold: shooter.threshold })
      shooterOfSlot.push(shooter)
    }
  }
  const allocation = allocateDice(slots, targets)

  const pool = preview.siegeRerolls
  slots.forEach((slot, index) => {
    const targetId = allocation[index]
    if (!targetId) return
    const shooter = shooterOfSlot[index]!
    let p = hitProbability(slot.threshold)
    if (pool && pool.pool > 0) {
      const garrisonDie = pool.shipIds
        ? pool.shipIds.includes(shooter.shipId)
        : shooter.ownerId === pool.playerId && shooter.distance === 0
      if (garrisonDie) p = 1 - (1 - p) ** (pool.pool + 1)
    }
    const list = byTarget.get(targetId)
    if (list) list.push(p)
    else byTarget.set(targetId, [p])
    expectedHits += p
  })

  return { byTarget, expectedHits }
}

/** Распределение числа попаданий по списку вероятностей: сумма независимых испытаний. */
function hitCountDistribution(probabilities: readonly number[]): number[] {
  let dist = [1]
  for (const p of probabilities) {
    const next = new Array<number>(dist.length + 1).fill(0)
    for (let hits = 0; hits < dist.length; hits++) {
      const mass = dist[hits]!
      if (mass === 0) continue
      next[hits]! += mass * (1 - p)
      next[hits + 1]! += mass * p
    }
    dist = next
  }
  return dist
}

/** Ожидаемый итог одного раунда из текущего урона. Считается точно всегда. */
export function forecastRoundDamage(
  preview: CombatPreview,
  damageByShipId: Readonly<Record<string, number>> = {},
): RoundDamageForecast {
  const side = (role: CombatRole) => {
    const fire = sideFire(preview, role, damageByShipId)
    const enemy = role === 'attacker' ? preview.defender : preview.attacker
    let losses = 0
    let survivesAll = 1
    for (const target of enemy.ships) {
      const probabilities = fire.byTarget.get(target.shipId)
      if (!probabilities?.length) continue
      const damage = damageByShipId[target.shipId] ?? target.damage
      const need = target.hull - damage
      if (need <= 0) continue
      const dist = hitCountDistribution(probabilities)
      let killed = 0
      for (let hits = need; hits < dist.length; hits++) killed += dist[hits]!
      losses += killed
      survivesAll *= 1 - killed
    }
    return { hits: fire.expectedHits, losses, anyLoss: 1 - survivesAll }
  }
  const attacker = side('attacker')
  const defender = side('defender')
  return {
    attackerHits: attacker.hits,
    defenderHits: defender.hits,
    defenderLosses: attacker.losses,
    attackerLosses: defender.losses,
    defenderAnyLoss: attacker.anyLoss,
    attackerAnyLoss: defender.anyLoss,
  }
}

/** Один вариант урона, нанесённого стороной за раунд: сдвиг ключа своей стороны и его вес. */
interface DamageOutcome {
  /** Сдвиг ключа стороны, которая получила попадания. */
  shift: number
  probability: number
}

/**
 * Во что превратится урон стороны после выстрелов противника: варианты с вероятностями.
 * Цели независимы друг от друга, поэтому варианты перемножаются по целям.
 */
function damageOutcomes(
  fire: SideFire,
  ships: readonly ForecastShip[],
  digits: readonly number[],
): DamageOutcome[] {
  let outcomes: DamageOutcome[] = [{ shift: 0, probability: 1 }]
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i]!
    const probabilities = fire.byTarget.get(ship.shipId)
    if (!probabilities?.length) continue
    const need = ship.hull - digits[i]!
    if (need <= 0) continue
    const dist = hitCountDistribution(probabilities)
    // Попадания сверх прочности пропадают: разряд корабля упирается в его прочность.
    const collapsed: number[] = new Array<number>(need + 1).fill(0)
    for (let hits = 0; hits < dist.length; hits++) {
      collapsed[Math.min(hits, need)]! += dist[hits]!
    }
    const base = ship.radix
    const next: DamageOutcome[] = []
    for (const outcome of outcomes) {
      for (let hits = 0; hits <= need; hits++) {
        const mass = collapsed[hits]!
        if (mass === 0) continue
        next.push({ shift: outcome.shift + hits * base, probability: outcome.probability * mass })
      }
    }
    outcomes = next
  }
  return outcomes
}

/** Разряды урона стороны, разобранные из её ключа. */
function digitsOf(key: number, ships: readonly ForecastShip[]): number[] {
  return ships.map((ship) => Math.floor(key / ship.radix) % (ship.hull + 1))
}

/** Корабли стороны, разложенные по разрядам ключа. */
interface SideState {
  ships: ForecastShip[]
  /** Сколько всего состояний у стороны. */
  space: number
  /** Ключ, в котором каждый корабль выбит. */
  dead: number
}

/**
 * Точные вероятности исхода боя до конца. `null` — перебор слишком велик, нужен запасной путь.
 *
 * Состояние боя — два числа: ключ урона атакующего и ключ урона защитника, каждый в
 * смешанной системе счисления с разрядом на корабль. Сторона стреляет по чужому ключу, поэтому
 * варианты двух сторон независимы и перемножаются, а «все выбиты» — это сравнение ключа с
 * числом, где каждый разряд равен прочности.
 */
function exactBattleOutcome(
  preview: CombatPreview,
  options: ForecastOptions,
): BattleOutcomeOdds | null {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  const budget = options.workBudget ?? DEFAULT_WORK_BUDGET
  const spaceLimit = options.stateLimit ?? DEFAULT_STATE_LIMIT

  const build = (side: CombatSidePreview): SideState => {
    const ships: ForecastShip[] = []
    let space = 1
    let dead = 0
    for (const ship of side.ships) {
      ships.push({
        shipId: ship.shipId,
        hull: ship.hull,
        damage: Math.min(ship.damage, ship.hull),
        radix: space,
      })
      dead += ship.hull * space
      space *= ship.hull + 1
    }
    return { ships, space, dead }
  }

  const attacker = build(preview.attacker)
  const defender = build(preview.defender)
  if (!attacker.ships.length && !defender.ships.length) return null
  // Перебор впустую не начинаем: на большом флоте он всё равно упрётся в бюджет.
  if (attacker.space * defender.space > spaceLimit) return null

  const keyOf = (a: number, d: number) => a + d * attacker.space
  const initial = keyOf(
    attacker.ships.reduce((sum, ship) => sum + ship.damage * ship.radix, 0),
    defender.ships.reduce((sum, ship) => sum + ship.damage * ship.radix, 0),
  )

  const odds: BattleOutcomeOdds = { win: 0, draw: 0, defeat: 0 }
  let current = new Map<number, number>([[initial, 1]])
  let work = 0
  // Раскладка кубиков зависит только от состояния — считаем её один раз на состояние.
  const fireCache = new Map<number, { toAttackers: DamageOutcome[]; toDefenders: DamageOutcome[] }>()

  for (let round = 0; round < maxRounds && current.size; round++) {
    const next = new Map<number, number>()
    for (const [key, mass] of current) {
      const aKey = key % attacker.space
      const dKey = (key - aKey) / attacker.space

      let step = fireCache.get(key)
      if (!step) {
        const aDigits = digitsOf(aKey, attacker.ships)
        const dDigits = digitsOf(dKey, defender.ships)
        const damage: Record<string, number> = {}
        attacker.ships.forEach((ship, i) => { damage[ship.shipId] = aDigits[i]! })
        defender.ships.forEach((ship, i) => { damage[ship.shipId] = dDigits[i]! })
        step = {
          toDefenders: damageOutcomes(sideFire(preview, 'attacker', damage), defender.ships, dDigits),
          toAttackers: damageOutcomes(sideFire(preview, 'defender', damage), attacker.ships, aDigits),
        }
        fireCache.set(key, step)
      }

      work += step.toDefenders.length * step.toAttackers.length
      if (work > budget) return null

      // Никто никого не задевает — бой уже не кончится.
      if (step.toDefenders.length === 1 && step.toDefenders[0]!.shift === 0
        && step.toAttackers.length === 1 && step.toAttackers[0]!.shift === 0) {
        odds.draw += mass
        continue
      }

      for (const toDefender of step.toDefenders) {
        const nextD = dKey + toDefender.shift
        const defendersAlive = nextD !== defender.dead
        const shared = mass * toDefender.probability
        for (const toAttacker of step.toAttackers) {
          const probability = shared * toAttacker.probability
          if (probability < STATE_PRUNE_THRESHOLD) continue
          const nextA = aKey + toAttacker.shift
          const attackersAlive = preview.trigger === 'bombardment' || nextA !== attacker.dead
          if (!defendersAlive && attackersAlive) odds.win += probability
          else if (!attackersAlive && defendersAlive) odds.defeat += probability
          else if (!attackersAlive && !defendersAlive) odds.draw += probability
          else if (preview.trigger === 'bombardment') odds.draw += probability
          else {
            const nextKey = keyOf(nextA, nextD)
            next.set(nextKey, (next.get(nextKey) ?? 0) + probability)
          }
        }
      }
    }
    current = next
  }

  // Бой, не доигранный за потолок раундов, считаем разменом — как считал его и прежний прогон.
  for (const mass of current.values()) odds.draw += mass

  const total = odds.win + odds.draw + odds.defeat
  if (total <= 0) return null
  return { win: odds.win / total, draw: odds.draw / total, defeat: odds.defeat / total }
}

/**
 * Прогноз боя: ожидаемый итог первого раунда (всегда точно) и исход боя до конца
 * (точно, если перебор влез; иначе прогонами, с пометкой `exact: false`).
 */
export function forecastBattle(
  preview: CombatPreview,
  options: ForecastOptions = {},
): BattleForecast {
  const round = forecastRoundDamage(preview, {})

  if (
    combatSideFirepower(preview, 'attacker') === 0
    && combatSideFirepower(preview, 'defender') === 0
  ) {
    return { round, outcome: { win: 0, draw: 1, defeat: 0 }, exact: true }
  }

  const exact = exactBattleOutcome(preview, options)
  if (exact) return { round, outcome: exact, exact: true }

  const samples = options.samples ?? DEFAULT_SAMPLES
  return {
    round,
    outcome: estimateBattleOutcome(preview, {
      samples,
      ...(options.rng ? { rng: options.rng } : {}),
      ...(options.maxRounds ? { maxRounds: options.maxRounds } : {}),
    }),
    exact: false,
    samples,
  }
}
