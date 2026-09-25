/**
 * Тактический слой ботов средней и высокой сложности: расстановка маркеров, выбор маркера
 * и того, что он делает (перелёт, бой, постройка), выбор клеток захвата и фишек перезарядки.
 *
 * Каждый вариант получает оценку в очках — сумму понятных слагаемых: «займём нейтральный
 * центр», «приблизимся к цели на ход», «оставим центр без гарнизона», «ожидаемые потери в
 * бою». Веса слагаемых берутся из стратегического слоя (`bot-strategy.ts`). Бот не ищет
 * вглубь: одна оценка на вариант, поэтому шаг укладывается в единицы миллисекунд даже на
 * карте для шестерых.
 */

import {
  coordOfKey,
  distancesFrom,
  hasRoomFor,
  isCombatCellFor,
  reachForShip,
  type BoardIndex,
} from './bot-board.js'
import {
  combatStrength,
  estimateFromStrengths,
  estimatePreview,
  fleetValue,
  type BattleEstimate,
} from './bot-combat-math.js'
import {
  analyzeSituation,
  baseCellGoalValue,
  BOT_PROFILES,
  cellGoalValue,
  defenseShareFor,
  defenseValue,
  garrisonNeed,
  isDenyTarget,
  PICKET_STRENGTH,
  POWER_CENTER_VALUE,
  raidRisk,
  raidRiskAverted,
  rivalMovableCells,
  shipCost,
  type BotSituation,
  type SmartDifficulty,
} from './bot-strategy.js'
import { currentBotMemory, resolvePlan } from './bot-plan.js'
import { claimPicksRemaining, eligibleClaimCells } from './claim.js'
import { buildCombatPreview, combatShotModifier, isBattleUnresolvable } from './combat.js'
import { shipHitThreshold } from './combat-hits.js'
import { MAX_FLEET_SIZE_PER_PLAYER, MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER } from './constants.js'
import { effectiveMoveRange } from './doctrines.js'
import { actionMarkerLimitForPlayer } from './marker-pools.js'
import { actionMarkerSlotFree, canPlaceActionMarkerOnCell } from './markers.js'
import type { ShipMovePlan } from './movement.js'
import { computeRechargeBudget, rechargePicksRemaining, type ResourceTokenRef } from './resource-recharge.js'
import type { GameSnapshot } from './save-file.js'
import { canBesiegeCell } from './siege.js'
import { SHIP_PRODUCTION_COST, SHIP_PRODUCTION_REGION_MIN } from './ships.js'
import { hexKey, type HexCoord, type MapDefinition, type ShipType, type ShipUnit } from './types.js'

export type BotActionSink = (
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
) => { errors: string[] }

/** Контекст одного решения: стратегическая картина плюс кэши тактических расчётов. */
export interface TacticalContext {
  game: GameSnapshot
  map: MapDefinition
  playerId: string
  situation: BotSituation
  board: BoardIndex
  approachCache: Map<string, number>
  goals: ApproachGoal[] | null
  threatCache: Map<string, number>
}

interface ApproachGoal {
  key: string
  value: number
  /** Цель, для которой хватит одного корабля (захват), — второй туда не нужен. */
  claimOnly: boolean
  /** Через сколько ходов до неё долетит ближайший свой корабль. */
  ownTurns: number
}

export function createTacticalContext(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  difficulty: SmartDifficulty,
): TacticalContext {
  const situation = analyzeSituation(game, playerId, BOT_PROFILES[difficulty])
  const memory = currentBotMemory()
  if (memory && situation.profile.commitment > 0) {
    situation.plan = resolvePlan(
      situation,
      memory,
      (key) => baseCellGoalValue(situation, key),
      (id) => isDenyTarget(situation, id),
    )
  }
  return {
    game,
    map,
    playerId,
    situation,
    board: situation.board,
    approachCache: new Map(),
    goals: null,
    threatCache: new Map(),
  }
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

/** Кого оставлять в гарнизоне первым: медленные тяжёлые корабли, быстрым — захват. */
const KEEP_PRIORITY: Record<ShipType, number> = {
  battleship: 5,
  carrier: 4,
  cruiser: 3,
  hyper: 2,
  destroyer: 1,
}

/** Затраты на сам перелёт: без них бот гонял бы корабли ради сотых долей очка. */
const MOVE_COST = 0.6
/** Сколько стоит приближение к цели на ход относительно самой цели. */
const APPROACH_DECAY = 0.55
const APPROACH_WEIGHT = 0.5
/** Сколько стоит лишняя клетка захвата сверх лимита: займётся не в этот ход. */
const OVER_LIMIT_CLAIM_SHARE = 0.3

function ownShipsAt(board: BoardIndex, key: string, playerId: string): ShipUnit[] {
  return board.cells.get(key)?.ships.filter((ship) => ship.ownerId === playerId) ?? []
}

/**
 * Сила врагов, способных дойти до клетки в этот ход (для удержания центра). Корабли на самой
 * клетке — по желанию: в бою за неё они и есть противник, а после победы их уже нет.
 */
function enemyReachStrength(ctx: TacticalContext, key: string, includeOnCell = true): number {
  const cacheKey = includeOnCell ? key : `${key}|без клетки`
  const cached = ctx.threatCache.get(cacheKey)
  if (cached != null) return cached
  let worst = 0
  for (const rival of ctx.situation.rivals) {
    const movable = rivalMovableCells(ctx.game, rival.id)
    const types: ShipType[] = []
    for (const ship of rival.ships) {
      if (ship.key === key) {
        if (includeOnCell) types.push(ship.type)
        continue
      }
      if (!movable(ship.key)) continue
      if (reachForShip(ctx.board, ship.key, rival.id, ship.type).has(key)) types.push(ship.type)
    }
    worst = Math.max(worst, combatStrength(types))
  }
  ctx.threatCache.set(cacheKey, worst)
  return worst
}

/**
 * Гарнизон, который уровень держит по правилу, что бы ни сулил ход по плану. Средний держит
 * только последний центр; высокий — центры, оборона которых важна для партии (последний, под
 * ударом почти победителя, перед своей победой). Обычную оборону от набега высокий не держит по
 * правилу, а взвешивает против плана (`raidRisk`, см. `planMoves` и `planBuild`).
 */
function garrisonNeedFor(ctx: TacticalContext, key: string): number {
  const need = garrisonNeed(ctx.situation, key)
  if (need <= 0) return 0
  const threat = ctx.situation.threats.get(key)
  if (!threat) return 0
  const { profile } = ctx.situation
  return (profile.threatAware ? defenseShareFor(ctx.situation, threat) >= 0.5 : threat.last) ? need : 0
}

/** Возвращаться ли кораблю на свой пустой центр ради пикета по правилу: только ради важной обороны. */
function returnsForPicket(ctx: TacticalContext, key: string): boolean {
  return garrisonNeedFor(ctx, key) > 0
}

/** Своя сила на клетке без кораблей из `except`. */
function ownStrengthAt(ctx: TacticalContext, key: string, except: ReadonlySet<string> = new Set()): number {
  return combatStrength(ownShipsAt(ctx.board, key, ctx.playerId).filter((ship) => !except.has(ship.id)).map((ship) => ship.type))
}

function approachGoals(ctx: TacticalContext): ApproachGoal[] {
  if (ctx.goals) return ctx.goals
  const { situation, board, playerId } = ctx
  const raw: { key: string; value: number; claimOnly: boolean }[] = []
  for (const [key, cell] of board.cells) {
    if (cell.controlOwnerId === playerId) {
      if (!cell.isPowerCenter || !situation.profile.threatAware) continue
      const need = garrisonNeedFor(ctx, key)
      const threat = situation.threats.get(key)
      if (need <= 0 || !threat || threat.garrison >= need || !returnsForPicket(ctx, key)) continue
      raw.push({ key, value: defenseValue(situation, key) * 0.6, claimOnly: false })
      continue
    }
    const value = cellGoalValue(situation, key)
    if (value < 10) continue
    const defended = cell.ships.some((ship) => ship.ownerId !== playerId)
    raw.push({ key, value, claimOnly: !defended && !cell.isPowerCenter })
  }
  raw.sort((a, b) => b.value - a.value)
  const top = raw.slice(0, 28)
  ctx.goals = top.map((goal) => {
    const dist = distancesFrom(board, goal.key)
    let ownTurns = Infinity
    for (const ship of situation.me.ships) {
      const d = dist.get(ship.key)
      if (d == null) continue
      const speed = effectiveMoveRange(ctx.game, ship.type, playerId)
      ownTurns = Math.min(ownTurns, Math.ceil(d / speed))
    }
    return { ...goal, ownTurns }
  })
  return ctx.goals
}

/**
 * Насколько клетка хороша как стоянка на будущее: ценность лучшей цели, до которой отсюда
 * лететь, с убыванием за каждый ход пути. Цель, куда свой корабль уже ближе, делится.
 */
function approachValue(ctx: TacticalContext, key: string, type: ShipType): number {
  const cacheKey = `${key}|${type}`
  const cached = ctx.approachCache.get(cacheKey)
  if (cached != null) return cached
  const speed = effectiveMoveRange(ctx.game, type, ctx.playerId)
  let best = 0
  for (const goal of approachGoals(ctx)) {
    const d = distancesFrom(ctx.board, goal.key).get(key)
    if (d == null || d === 0) continue
    const turns = Math.ceil(d / speed)
    let value = goal.value * APPROACH_DECAY ** turns
    if (goal.claimOnly && goal.ownTurns < turns) value *= 0.35
    // Эсминец в бою слаб — гнать его к защищённым целям смысла мало.
    if (!goal.claimOnly && type === 'destroyer') value *= 0.7
    if (value > best) best = value
  }
  ctx.approachCache.set(cacheKey, best)
  return best
}

// ---------------------------------------------------------------------------
// Бой
// ---------------------------------------------------------------------------

export interface CombatOption {
  key: string
  attackers: ShipUnit[]
  value: number
  siege: boolean
  estimate: BattleEstimate | null
  reason: string
}

/** Кто в бою на клетке будет защищаться против бота — с учётом чужой осады. */
function defendersAt(ctx: TacticalContext, key: string): ShipUnit[] {
  const cell = ctx.board.cells.get(key)
  if (!cell) return []
  const enemies = cell.ships.filter((ship) => ship.ownerId !== ctx.playerId)
  const siege = ctx.game.sieges?.[key]
  if (siege && siege.besiegerId !== ctx.playerId) {
    // Против осаждающего бьётся и сам осаждённый, и третий игрок — гарнизон в стороне.
    return enemies.filter((ship) => ship.ownerId === siege.besiegerId)
  }
  const owners = [...new Set(enemies.map((ship) => ship.ownerId))]
  if (owners.length <= 1) return enemies
  const owner = cell.controlOwnerId && owners.includes(cell.controlOwnerId) ? cell.controlOwnerId : owners[0]!
  return enemies.filter((ship) => ship.ownerId === owner)
}

/**
 * Шанс удержать центр, на который бот ставит корабли силой `arriving`: враг, способный долететь
 * до клетки в этот ход, может его отбить. 1 — никто не долетает. Средний уровень об этом не
 * думает и берёт всё, до чего дотянется.
 */
function holdSafety(ctx: TacticalContext, key: string, arriving: number): number {
  if (!ctx.situation.profile.holdAware) return 1
  const danger = enemyReachStrength(ctx, key, false)
  if (danger <= 0) return 1
  const held = combatStrength(ownShipsAt(ctx.board, key, ctx.playerId).map((ship) => ship.type)) + arriving
  const risk = danger / (danger + 1.5 * held + 0.05)
  return 1 - 0.6 * risk
}

/** Во что обойдётся бою ставка: ценность клетки для бота, если он её выиграет. */
function combatStake(ctx: TacticalContext, key: string, arriving: number): number {
  const cell = ctx.board.cells.get(key)
  if (!cell) return 0
  const siege = ctx.game.sieges?.[key]
  if (cell.isPowerCenter) {
    if (cell.controlOwnerId === ctx.playerId) {
      // Враг на своём центре: без ответа центр уйдёт захватом или осадой. Высокий уровень
      // выбивает его как отбирает чужой центр — это тот же размен; средний — вполсилы.
      const recapture = ctx.situation.profile.threatAware ? POWER_CENTER_VALUE * 1.1 : 25
      return Math.max(recapture, defenseValue(ctx.situation, key) * 1.25)
    }
    if (siege && siege.besiegerId !== ctx.playerId && siege.besiegedId !== ctx.playerId) {
      // Снять осаду того, кто вот-вот победит, — отнять у него центр, который он почти взял.
      const deny = isDenyTarget(ctx.situation, siege.besiegerId) ? POWER_CENTER_VALUE * 1.1 * ctx.situation.modes.deny : 0
      return cellGoalValue(ctx.situation, key) * 0.25 + deny
    }
    return cellGoalValue(ctx.situation, key) * holdSafety(ctx, key, arriving)
  }
  return cellGoalValue(ctx.situation, key)
}

function killWeight(ctx: TacticalContext, ownerId: string | undefined): number {
  if (!ownerId) return 1
  let weight = 1
  // Флот того, кто вот-вот победит, — то, чем он возьмёт последние центры.
  if (isDenyTarget(ctx.situation, ownerId)) weight += 0.6 * ctx.situation.modes.deny
  for (const threat of ctx.situation.threats.values()) {
    if (threat.attackerId === ownerId && (threat.now > 0 || threat.occupied)) {
      weight += 0.3 * defenseShareFor(ctx.situation, threat)
      break
    }
  }
  return weight
}

/**
 * Ценность боя за клетку: шанс победы на ставку плюс ожидаемые потери врага минус свои.
 * Для защищённого чужого центра сравнивается со второй дорогой — осадой.
 */
export function evaluateCombatTarget(
  ctx: TacticalContext,
  key: string,
  attackers: ShipUnit[],
  quick: boolean,
): CombatOption | null {
  const cell = ctx.board.cells.get(key)
  if (!cell || attackers.length === 0) return null
  const { situation, playerId } = ctx
  const defenders = defendersAt(ctx, key)
  if (defenders.length === 0) return null
  const attackerTypes = attackers.map((ship) => ship.type)
  const defenderTypes = defenders.map((ship) => ship.type)

  let estimate: BattleEstimate | null
  let assaultPossible = true
  if (quick) {
    estimate = estimateFromStrengths(
      combatStrength(attackerTypes),
      combatStrength(defenderTypes),
      fleetValue(attackerTypes),
      fleetValue(defenderTypes),
    )
    // Штурм, в котором сами атакующие не стреляют (авианосцы, гиперорудие в упор, эсминец
    // против «Обороны»), держится на поддержке соседей, а соседи того же маркера к бою улетят.
    // Такой бой бот не начинает: это уже не оценка, а правило.
    const modifier = combatShotModifier(ctx.game, playerId, defenders[0]?.ownerId ?? null, cell.coord)
    assaultPossible = attackerTypes.some((type) => shipHitThreshold(type, 0, modifier) != null)
  } else {
    const preview = buildCombatPreview(ctx.game, cell.coord, playerId, attackers)
    if (!preview) return null
    // То же с поправками доктрин: эсминцу против «Обороны» на её клетке нужна семёрка.
    const attackersShoot = preview.attacker.ships.some((ship) => ship.dice > 0 && ship.threshold != null)
    assaultPossible = attackersShoot && !isBattleUnresolvable(preview)
    estimate = estimatePreview(preview)
  }

  // После боя на клетке останется примерно половина силы атакующих — ею и держать.
  const stake = combatStake(ctx, key, combatStrength(attackerTypes) * 0.6)
  const kill = killWeight(ctx, defenders[0]?.ownerId)
  const finishing = situation.modes.finish >= 0.99 || situation.modes.deny >= 0.8
  const lossWeight = (finishing ? 0.65 : 1) * situation.profile.lossAversion
  // Ставка высока (добивание, помеха лидеру, свой центр) — бот рискует охотнее.
  const bigStake = stake >= POWER_CENTER_VALUE * 1.4
  const minWin = bigStake ? 0.35 : situation.profile.smartCombat ? 0.55 : 0.5
  const besiegeable = canBesiegeCell(ctx.game, playerId, cell.coord)

  let best: CombatOption | null = null
  if (assaultPossible && estimate && estimate.winChance >= minWin) {
    let value = estimate.winChance * stake + estimate.defenderLoss * kill - estimate.attackerLoss * lossWeight
    // Штурм стоит флота, осада — только времени. Когда время не поджимает, бот высокого уровня
    // штурмует лишь то, что не взять осадой.
    if (besiegeable && !finishing) value *= situation.profile.assaultBias
    best = { key, attackers, value, siege: false, estimate, reason: 'штурм' }
  }

  if (besiegeable) {
    const siege = siegeOption(ctx, key, attackers, defenders, stake, estimate)
    if (siege && (!best || siege.value > best.value)) best = siege
  }
  if (best && best.value <= 0) return null
  return best
}

/**
 * Осада: гарнизон тает по кораблю в ход, осаждающий не теряет ничего, пока держит клетку.
 * Стоит того, если флот выдержит вылазку с перебросами и партия успеет кончиться не раньше.
 */
function siegeOption(
  ctx: TacticalContext,
  key: string,
  attackers: ShipUnit[],
  garrison: ShipUnit[],
  stake: number,
  assault: BattleEstimate | null,
): CombatOption | null {
  const { situation } = ctx
  const turnsNeeded = garrison.length
  if (turnsNeeded > Math.max(1, situation.turnsLeft)) return null
  const mine = combatStrength(attackers.map((ship) => ship.type))
  // Вылазка гарнизона идёт с перебросами промахов — примерно полуторная сила.
  const theirs = combatStrength(garrison.map((ship) => ship.type)) * 1.5
  const hold = theirs <= 0 ? 2 : mine / theirs
  if (hold < 0.9) return null
  if (!situation.profile.smartCombat && assault && assault.ratio >= 3) {
    // Средний уровень решает в подготовке боя по простому правилу: при подавляющем перевесе —
    // штурм, иначе — осада. Оценка хода должна совпадать с тем, что он сделает.
    return null
  }
  const holdChance = Math.min(1, 0.55 + 0.25 * hold)
  const tiedUp = 0.06 * fleetValue(attackers.map((ship) => ship.type)) * turnsNeeded
  const value = stake * 0.85 ** turnsNeeded * holdChance - tiedUp
  return { key, attackers, value, siege: true, estimate: assault, reason: 'осада' }
}

// ---------------------------------------------------------------------------
// Перелёт
// ---------------------------------------------------------------------------

export interface MovePlan {
  moves: ShipMovePlan[]
  value: number
  combat: CombatOption | null
  reason: string
}

/**
 * Лучший перелёт кораблей с клетки маркера: не больше одного боя, остальные корабли —
 * по одной на клетку цели, с учётом гарнизона, лимита захвата и приближения к целям.
 */
export function planMoves(ctx: TacticalContext, markerKey: string, quick: boolean): MovePlan | null {
  const { board, playerId, situation } = ctx
  const cell = board.cells.get(markerKey)
  if (!cell) return null
  const mine = cell.ships.filter((ship) => ship.ownerId === playerId)
  if (mine.length === 0) return null
  // Общая клетка — осада: её решает отдельный разбор (вылазка или штурм гарнизона).
  if (cell.ships.some((ship) => ship.ownerId !== playerId)) return null

  const kept = new Set<string>()
  if (cell.isPowerCenter && cell.controlOwnerId === playerId) {
    const need = garrisonNeedFor(ctx, markerKey)
    if (need > 0) {
      const all = combatStrength(mine.map((ship) => ship.type))
      if (all >= need) {
        // Удержать можно: оставляем тяжёлые медленные корабли, быстрые идут на захват.
        const order = [...mine].sort((a, b) => KEEP_PRIORITY[b.type] - KEEP_PRIORITY[a.type])
        const keptTypes: ShipType[] = []
        for (const ship of order) {
          if (keptTypes.length > 0 && combatStrength(keptTypes) >= need) break
          kept.add(ship.id)
          keptTypes.push(ship.type)
        }
      } else if (situation.profile.pickets) {
        // Удержать нечем: весь флот на клетке погиб бы в штурме. Оставляем пикет — самый
        // дешёвый корабль, чтобы центр не ушёл захватом без боя.
        const picket = [...mine].sort((a, b) => shipCost(a.type) - shipCost(b.type))[0]!
        kept.add(picket.id)
      }
    }
  }
  const free = mine.filter((ship) => !kept.has(ship.id))
  if (free.length === 0) return null

  const reach = new Map<string, Map<string, number>>()
  for (const ship of free) reach.set(ship.id, reachForShip(board, markerKey, playerId, ship.type))

  // Свой центр, с которого уходят корабли: оставить его пустым — значит рискнуть набегом.
  // Высокий уровень сравнивает этот риск с тем, что даст уход (`raidRisk`); средний не считает.
  const guardOrigin = cell.isPowerCenter && cell.controlOwnerId === playerId && kept.size === 0
    && raidRisk(situation, markerKey, 0) > 0
  const exposeCost = (leaving: ReadonlySet<string>) => {
    if (!guardOrigin || mine.some((ship) => !leaving.has(ship.id))) return 0
    return raidRiskAverted(situation, markerKey, 0, ownStrengthAt(ctx, markerKey))
  }

  let combat: CombatOption | null = null
  const combatKeys = new Set<string>()
  for (const cells of reach.values()) {
    for (const key of cells.keys()) if (isCombatCellFor(board, playerId, key)) combatKeys.add(key)
  }
  for (const key of combatKeys) {
    const attackers = free.filter((ship) => reach.get(ship.id)!.has(key))
    let option = evaluateCombatTarget(ctx, key, attackers, quick)
    const cost = option ? exposeCost(new Set(attackers.map((ship) => ship.id))) : 0
    if (option && cost > 0) {
      option = { ...option, value: option.value - cost, reason: `${option.reason}, центр без пикета (риск набега ${cost.toFixed(0)})` }
      if (attackers.length >= 2) {
        // Тот же бой без самого дешёвого корабля: он остаётся пикетом.
        const picket = [...attackers].sort((a, b) => shipCost(a.type) - shipCost(b.type))[0]!
        const lean = evaluateCombatTarget(ctx, key, attackers.filter((ship) => ship !== picket), quick)
        if (lean && lean.value > option.value) option = { ...lean, reason: `${lean.reason}, пикет остаётся` }
      }
      if (option.value <= 0) option = null
    }
    if (option && (!combat || option.value > combat.value)) combat = option
  }

  const moves: ShipMovePlan[] = []
  const reasons: string[] = []
  let value = 0
  const moving = new Set<string>()
  if (combat) {
    for (const ship of combat.attackers) {
      moves.push({ shipId: ship.id, to: coordOfKey(combat.key) })
      moving.add(ship.id)
    }
    value += combat.value
    reasons.push(`${combat.reason} ${combat.key}`)
  }

  const incoming = new Map<string, number>()
  const ownAt = (key: string) => ownShipsAt(board, key, playerId).length
  let originLeft = mine.length - moving.size
  const claimLimit = situation.me.claimLimit
  let claimSlots = claimLimit - situation.plannedClaims.powerCenters - situation.plannedClaims.other
  const originPending = cell.controlOwnerId !== playerId
  const originGoal = originPending ? cellGoalValue(situation, markerKey) : 0

  const remaining = free.filter((ship) => !moving.has(ship.id))
  while (remaining.length > 0) {
    let best: { ship: ShipUnit; key: string; gain: number; note: string } | null = null
    for (const ship of remaining) {
      const here = approachValue(ctx, markerKey, ship.type)
      // Последний корабль уходит с клетки, которую бот вот-вот займёт, — захват пропадёт. Со
      // своего центра под угрозой — оставляет его набегу: ход должен дать больше, чем стоит риск.
      const leaveCost = originLeft === 1
        ? (originPending ? originGoal : guardOrigin ? raidRiskAverted(situation, markerKey, 0, combatStrength([ship.type])) : 0)
        : 0
      for (const [key] of reach.get(ship.id)!) {
        if (isCombatCellFor(board, playerId, key)) continue
        const dest = board.cells.get(key)!
        const extra = incoming.get(key) ?? 0
        if (!hasRoomFor(dest, playerId, extra)) continue
        let gain = -MOVE_COST - leaveCost
        let note = ''
        const covered = ownAt(key) + extra > 0
        if (dest.controlOwnerId !== playerId) {
          if (!covered) {
            let goal = cellGoalValue(situation, key)
            const needsClaim = dest.controlOwnerId == null || dest.isPowerCenter
            if (needsClaim && !dest.isPowerCenter && claimSlots <= 0) goal *= OVER_LIMIT_CLAIM_SHARE
            if (dest.isPowerCenter) goal *= holdSafety(ctx, key, combatStrength([ship.type]))
            gain += goal
            note = dest.isPowerCenter ? 'центр' : dest.controlOwnerId ? 'набег' : 'захват'
          } else if (dest.isPowerCenter && situation.profile.threatAware) {
            // Второй корабль на центре, который вот-вот займём, — чтобы его не сбили.
            const danger = enemyReachStrength(ctx, key)
            const held = combatStrength(ownShipsAt(board, key, playerId).map((s) => s.type))
            if (danger > held) gain += cellGoalValue(situation, key) * 0.3
          }
        } else if (dest.isPowerCenter) {
          const need = garrisonNeedFor(ctx, key)
          const empty = ownAt(key) + extra === 0
          if (need <= 0 && empty && situation.profile.raidRiskWeight > 0) {
            // Вернуться на свой пустой центр под угрозой набега — если это выгоднее хода по плану.
            const averted = raidRiskAverted(situation, key, 0, combatStrength([ship.type]))
            if (averted > 0) {
              gain += averted
              note = 'пикет'
            }
          }
          if (need > 0) {
            const held = combatStrength(ownShipsAt(board, key, playerId).map((s) => s.type))
            const empty = ownAt(key) + extra === 0
            const deficit = need - held
            const add = combatStrength([ship.type]) || PICKET_STRENGTH
            if (empty && (situation.profile.pickets || returnsForPicket(ctx, key))) {
              // Пустой центр под угрозой: первый корабль превращает захват в бой.
              gain += defenseValue(situation, key) * 0.7
              note = 'пикет'
            } else if (deficit > 0 && add >= deficit * 0.5) {
              // Подкрепление имеет смысл, только если оно заметно приближает к удержанию.
              gain += defenseValue(situation, key) * 0.6 * Math.min(1, add / deficit)
              note = 'гарнизон'
            }
          }
        }
        gain += APPROACH_WEIGHT * (approachValue(ctx, key, ship.type) - here)
        if (!best || gain > best.gain) best = { ship, key, gain, note: note || 'сближение' }
      }
    }
    if (!best || best.gain <= 0.5) break
    const dest = board.cells.get(best.key)!
    moves.push({ shipId: best.ship.id, to: coordOfKey(best.key) })
    remaining.splice(remaining.indexOf(best.ship), 1)
    incoming.set(best.key, (incoming.get(best.key) ?? 0) + 1)
    if (originLeft === 1 && originPending && !cell.isPowerCenter) claimSlots += 1
    originLeft -= 1
    if (dest.controlOwnerId == null && !dest.isPowerCenter && ownAt(best.key) + (incoming.get(best.key)! - 1) === 0) {
      claimSlots -= 1
    }
    value += best.gain
    reasons.push(`${best.note} ${best.key}`)
  }

  if (guardOrigin && moves.length > 0) {
    reasons.push(originLeft > 0
      ? `пикет остаётся на ${markerKey}`
      : `центр ${markerKey} без пикета: ход выгоднее обороны (риск набега ${raidRisk(situation, markerKey, 0).toFixed(0)})`)
  }
  if (moves.length === 0) return null
  return { moves, value, combat, reason: reasons.join(', ') }
}

// ---------------------------------------------------------------------------
// Постройка
// ---------------------------------------------------------------------------

export interface BuildPlan {
  type: ShipType
  count: number
  value: number
  reason: string
}

/** Классы, которые бот строит: гиперорудие стреляет только издалека, а бот так не воюет. */
const BUILD_TYPES: readonly ShipType[] = ['destroyer', 'cruiser', 'carrier', 'battleship']

function shipWorth(ctx: TacticalContext, type: ShipType): number {
  const { modes, me } = ctx.situation
  // Корабли нужны и для развития: занимать клетки и держать выросшую территорию.
  const military = 0.85 + 0.35 * Math.max(modes.attack, modes.buildup, modes.defend, modes.deny, modes.develop * 0.6)
  switch (type) {
    case 'destroyer':
      return 4 * 0.95 * military + 2.6 * modes.expand
    case 'cruiser':
      return 8 * 1.3 * military
    case 'carrier': {
      const heavy = me.ships.filter((ship) => ship.type === 'cruiser' || ship.type === 'battleship').length
      return 11 * (heavy >= 3 ? 1.45 : 0.85) * military
    }
    case 'battleship':
      return 13 * 1.42 * military
    default:
      return 0
  }
}

/** Цена одной фишки номинала в оценке постройки: деньги можно потратить и позже. */
const MONEY_COST = 0.72

export function planBuild(ctx: TacticalContext, markerKey: string): BuildPlan | null {
  const { board, playerId, situation, game } = ctx
  const cell = board.cells.get(markerKey)
  if (!cell || cell.controlOwnerId !== playerId) return null
  if (game.sieges?.[markerKey]?.besiegedId === playerId) return null
  const regionId = situation.regions.regionOf.get(markerKey)
  const region = regionId == null ? undefined : situation.regions.list[regionId]
  if (!region) return null
  const own = cell.ships.filter((ship) => ship.ownerId === playerId).length
  const slots = Math.min(MAX_SHIPS_PER_CELL_PER_PLAYER - own, MAX_SHIPS_PER_CELL - cell.ships.length)
  if (slots <= 0) return null

  const fleetCount = new Map<ShipType, number>()
  for (const ship of situation.me.ships) fleetCount.set(ship.type, (fleetCount.get(ship.type) ?? 0) + 1)

  // Копить на тяжёлый класс: он открыт в регионе, но денег пока не хватает, а до него немного.
  let savingFor: ShipType | null = null
  if (situation.profile.smartProduction) {
    for (const type of ['battleship', 'carrier'] as ShipType[]) {
      if (region.size < SHIP_PRODUCTION_REGION_MIN[type]) continue
      if ((fleetCount.get(type) ?? 0) >= MAX_FLEET_SIZE_PER_PLAYER[type]) continue
      const cost = SHIP_PRODUCTION_COST[type]
      const affordable = region.credits >= cost.credits && region.production >= cost.production
      if (affordable) break
      const have = Math.min(region.credits, cost.credits) + Math.min(region.production, cost.production)
      if (have >= 0.45 * (cost.credits + cost.production)) {
        savingFor = type
        break
      }
    }
  }

  const need = cell.isPowerCenter ? garrisonNeedFor(ctx, markerKey) : 0
  const held = combatStrength(cell.ships.filter((ship) => ship.ownerId === playerId).map((ship) => ship.type))
  const deficit = Math.max(0, need - held)

  let best: BuildPlan | null = null
  for (const type of BUILD_TYPES) {
    if (region.size < SHIP_PRODUCTION_REGION_MIN[type]) continue
    const cost = SHIP_PRODUCTION_COST[type]
    const fleetLeft = MAX_FLEET_SIZE_PER_PLAYER[type] - (fleetCount.get(type) ?? 0)
    const count = Math.min(
      slots,
      fleetLeft,
      Math.floor(region.credits / cost.credits),
      Math.floor(region.production / cost.production),
    )
    if (count < 1) continue
    const worth = shipWorth(ctx, type)
    let moneyCost = MONEY_COST
    if (situation.profile.richDiscount) {
      // Скопившиеся деньги ничего не приносят: чем толще кошелёк региона, тем дешевле трата.
      const wallet = region.credits + region.production
      if (wallet >= 36) moneyCost *= 0.45
      else if (wallet >= 22) moneyCost *= 0.7
    }
    // Потраченные фишки вернёт перезарядка следующего хода, если её бюджет простаивает: такие
    // деньги почти ничего не стоят, а лежащие лицом вверх — не приносят ничего.
    const spare = Math.max(0, situation.economy.budget - situation.economy.faceDown)
    if (spare > 0 && situation.profile.economy > 0) {
      const tokensNeeded = Math.max(1, (shipCost(type) * count) / Math.max(1, situation.economy.tokenValue))
      moneyCost *= 1 - situation.profile.reinvest * Math.min(1, spare / tokensNeeded)
    }
    if (savingFor && shipCost(type) < shipCost(savingFor) && deficit <= 0) moneyCost = 1.25
    let value = count * (worth * situation.profile.buildScale - shipCost(type) * moneyCost)
    let reason = `постройка ${type}×${count}`
    if (deficit <= 0 && held <= 0 && cell.isPowerCenter && situation.profile.raidRiskWeight > 0) {
      // Пустой свой центр под угрозой набега: построенный корабль сразу встаёт пикетом.
      const averted = raidRiskAverted(situation, markerKey, 0, combatStrength(Array.from({ length: count }, () => type)))
      if (averted > 0) {
        value += averted
        reason += ' в пикет'
      }
    }
    if (deficit > 0) {
      const added = combatStrength(Array.from({ length: count }, () => type))
      if (held <= 0 && situation.profile.pickets) {
        // Пустой центр под угрозой: построенные корабли сразу становятся гарнизоном.
        value += defenseValue(situation, markerKey) * (0.7 + 0.2 * Math.min(1, added / deficit))
        reason += ' в пикет'
      } else if (added >= deficit * 0.5) {
        value += defenseValue(situation, markerKey) * 0.6 * Math.min(1, added / deficit)
        reason += ' в гарнизон'
      }
    }
    if (!best || value > best.value) best = { type, count, value, reason }
  }
  if (!best || best.value <= 0) return null
  return best
}

// ---------------------------------------------------------------------------
// Бой на своей клетке: вылазка из осады или штурм осаждённого гарнизона
// ---------------------------------------------------------------------------

export interface AssaultPlan {
  value: number
  reason: string
}

export function planSharedCell(ctx: TacticalContext, markerKey: string): AssaultPlan | null {
  const { board, playerId, game, situation } = ctx
  const cell = board.cells.get(markerKey)
  if (!cell) return null
  const mine = cell.ships.filter((ship) => ship.ownerId === playerId)
  if (mine.length === 0) return null
  const enemies = cell.ships.filter((ship) => ship.ownerId !== playerId)
  if (enemies.length === 0) return null
  const siege = game.sieges?.[markerKey]
  const preview = buildCombatPreview(game, cell.coord, playerId, mine)
  if (!preview || isBattleUnresolvable(preview)) return null
  const estimate = estimatePreview(preview)
  if (siege?.besiegedId === playerId) {
    // Вылазка: снять осаду, пока гарнизон не растаял. Это тот же отбитый центр, что и штурм.
    const recapture = situation.profile.threatAware ? POWER_CENTER_VALUE * 1.1 : 20
    const stake = Math.max(recapture, defenseValue(situation, markerKey))
    const value = estimate.winChance * stake + estimate.defenderLoss - estimate.attackerLoss
    if (estimate.winChance < 0.5 || value <= 0) return null
    return { value, reason: 'вылазка из осады' }
  }
  if (siege?.besiegerId === playerId) {
    // Гарнизон и так тает; штурмовать стоит, если это заметно быстрее и почти без риска.
    const garrison = enemies.filter((ship) => ship.ownerId === siege.besiegedId).length
    if (garrison <= 1 && situation.turnsLeft > 0) return null
    const stake = cellGoalValue(situation, markerKey)
    const wait = stake * 0.85 ** garrison
    const value = estimate.winChance * stake + estimate.defenderLoss - estimate.attackerLoss - wait
    if (estimate.winChance < 0.7 || value <= 0) return null
    return { value, reason: 'штурм осаждённого центра' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Выбор действия маркера
// ---------------------------------------------------------------------------

export type MarkerPlan =
  | { kind: 'move'; value: number; reason: string; moves: ShipMovePlan[]; combat: CombatOption | null }
  | { kind: 'build'; value: number; reason: string; type: ShipType; count: number }
  | { kind: 'assault'; value: number; reason: string }

export function planMarker(ctx: TacticalContext, markerKey: string, quick: boolean): MarkerPlan | null {
  let best: MarkerPlan | null = null
  const shared = planSharedCell(ctx, markerKey)
  if (shared) best = { kind: 'assault', value: shared.value, reason: shared.reason }
  const move = planMoves(ctx, markerKey, quick)
  if (move && (!best || move.value > best.value)) {
    best = { kind: 'move', value: move.value, reason: move.reason, moves: move.moves, combat: move.combat }
  }
  const build = planBuild(ctx, markerKey)
  if (build && (!best || build.value > best.value)) {
    best = { kind: 'build', value: build.value, reason: build.reason, type: build.type, count: build.count }
  }
  return best
}

/**
 * Запас на ответ: клетка с кораблями рядом со своим центром, до которого долетает враг.
 * Маркер на ней позволяет выбить врага, если он всё-таки сядет на центр.
 */
export function reserveValueOf(ctx: TacticalContext, key: string): number {
  if (!ctx.situation.profile.reserveMarkers) return 0
  const cell = ctx.board.cells.get(key)
  const ships = cell?.ships.filter((ship) => ship.ownerId === ctx.playerId) ?? []
  if (ships.length === 0) return 0
  let best = 0
  for (const threat of ctx.situation.threats.values()) {
    if (threat.next <= 0 && !threat.occupied) continue
    if (threat.key === key) continue
    const covers = ships.some((ship) => reachForShip(ctx.board, key, ctx.playerId, ship.type).has(threat.key))
    if (!covers) continue
    // Маркер рядом с центром, который могут взять набегом, — это шанс отбить его до начала хода.
    const raid = threat.garrison <= 0 ? raidRisk(ctx.situation, threat.key, 0) * 0.3 : 0
    best = Math.max(best, defenseValue(ctx.situation, threat.key) * 0.25, raid)
  }
  return best
}

/** Куда поставить следующий маркер действия: туда, где у маркера будет лучшее дело. */
export function chooseMarkerCell(ctx: TacticalContext): HexCoord | null {
  const { game, playerId, board } = ctx
  const limit = actionMarkerLimitForPlayer(game, playerId)
  const owned = game.actionMarkers.filter((marker) => marker.ownerId === playerId).length
  if (owned >= limit) return null
  let best: { key: string; score: number } | null = null
  const candidates: string[] = []
  for (const [key, cell] of board.cells) {
    // На осаждённой клетке у каждой стороны свой маркер: штурм, вылазка.
    if (!actionMarkerSlotFree(game, cell, playerId) || !canPlaceActionMarkerOnCell(cell, playerId)) continue
    candidates.push(key)
  }
  // Ничьи — случайно, как у простого бота: иначе зеркальные карты дают перекос по местам.
  const scored = candidates.map((key) => {
    const plan = planMarker(ctx, key, true)
    const ships = ownShipsAt(board, key, playerId).length
    // Даже бесполезный сейчас маркер не лишний: он даёт ход в поздних кругах, когда соперник
    // уже отходил, — поэтому ставим все, но сначала туда, где есть дело.
    const score = Math.max(0, plan?.value ?? 0) + reserveValueOf(ctx, key) + ships * 0.01
    return { key, score }
  })
  let top = -Infinity
  const ties: string[] = []
  for (const item of scored) {
    if (item.score > top + 1e-9) {
      top = item.score
      ties.length = 0
      ties.push(item.key)
    } else if (Math.abs(item.score - top) <= 1e-9) {
      ties.push(item.key)
    }
  }
  if (ties.length === 0) return null
  const pick = ties[Math.floor(Math.random() * ties.length)]!
  best = { key: pick, score: top }
  return coordOfKey(best.key)
}

// ---------------------------------------------------------------------------
// Захват и перезарядка
// ---------------------------------------------------------------------------

/**
 * Какие клетки занять, если подходящих больше лимита: центры, помеха почти победителю,
 * связность регионов, фишки.
 */
export function chooseClaimPicks(game: GameSnapshot, playerId: string, difficulty: SmartDifficulty): HexCoord[] | undefined {
  const remaining = claimPicksRemaining(game, playerId)
  if (remaining <= 0) return undefined
  const eligible = eligibleClaimCells(game, playerId)
  if (eligible.length === 0) return undefined
  const situation = analyzeSituation(game, playerId, BOT_PROFILES[difficulty])
  const scored = eligible.map((cell) => {
    const key = hexKey(cell.coord.q, cell.coord.r)
    let score = cellGoalValue(situation, key)
    if (cell.isPowerCenter) score += 1000
    // Клетка, соединяющая свои регионы, растит регион, а с ним — доступные классы кораблей.
    const touching = new Set<number>()
    for (const next of situation.board.neighbors.get(key) ?? []) {
      const region = situation.regions.regionOf.get(next)
      if (region != null) touching.add(region)
    }
    score += touching.size >= 2 ? 12 : touching.size === 1 ? 4 : 0
    const target = situation.nearWinner
    if (target && situation.modes.deny > 0) {
      // Помеха почти победителю: клетка у его границы — клетка, которую он не возьмёт, а
      // центр, до которого он долетает, — центр, который не станет его победным.
      if (cell.isPowerCenter && target.reachablePowerCenters.has(key)) score += 200 * situation.modes.deny
      const touchesTarget = (situation.board.neighbors.get(key) ?? [])
        .some((next) => situation.board.cells.get(next)?.controlOwnerId === target.id)
      if (touchesTarget) score += 10 * situation.modes.deny
    }
    return { cell, score }
  })
  scored.sort((a, b) => b.score - a.score || a.cell.coord.q - b.cell.coord.q || a.cell.coord.r - b.cell.coord.r)
  return scored.slice(0, remaining).map((item) => ({ ...item.cell.coord }))
}

/**
 * Какие фишки поднять. Движок поднимает самые крупные; бот высокого уровня поднимает их там,
 * где будет строить (в главном регионе), и держит баланс кредитов и производства под
 * корабль, на который копит.
 */
export function chooseRechargePicks(game: GameSnapshot, playerId: string): ResourceTokenRef[] | undefined {
  const remaining = rechargePicksRemaining(game, playerId)
  if (remaining <= 0) return undefined
  const situation = analyzeSituation(game, playerId, BOT_PROFILES.hard)
  const main = situation.regions.largest
  if (!main) return undefined
  const target: ShipType = main.size >= SHIP_PRODUCTION_REGION_MIN.battleship
    ? 'battleship'
    : main.size >= SHIP_PRODUCTION_REGION_MIN.cruiser
      ? 'cruiser'
      : 'destroyer'
  const cost = SHIP_PRODUCTION_COST[target]
  let credits = main.credits
  let production = main.production
  const tokens: { ref: ResourceTokenRef; value: number; type: string; inMain: boolean }[] = []
  for (const [key, cell] of situation.board.cells) {
    if (cell.controlOwnerId !== playerId) continue
    cell.resourceTokens.forEach((token, tokenIndex) => {
      if (token.faceUp !== false) return
      tokens.push({
        ref: { coord: { ...cell.coord }, tokenIndex },
        value: token.value,
        type: token.type,
        inMain: situation.regions.regionOf.get(key) === main.id,
      })
    })
  }
  const picks: ResourceTokenRef[] = []
  const used = new Set<number>()
  for (let n = 0; n < remaining && used.size < tokens.length; n += 1) {
    // Чего не хватает на целевой корабль сильнее — то и поднимаем.
    const creditNeed = Math.max(0, cost.credits - credits) / cost.credits
    const productionNeed = Math.max(0, cost.production - production) / cost.production
    let bestIndex = -1
    let bestScore = -Infinity
    tokens.forEach((token, index) => {
      if (used.has(index)) return
      const need = token.type === 'credits' ? creditNeed : productionNeed
      const score = token.value * (token.inMain ? 1 : 0.45) * (1 + need)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    })
    if (bestIndex < 0) break
    used.add(bestIndex)
    const token = tokens[bestIndex]!
    picks.push(token.ref)
    if (token.inMain) {
      if (token.type === 'credits') credits += token.value
      else production += token.value
    }
  }
  return picks.length ? picks : undefined
}

/** Сколько фишек игрок поднимет в этот ход — для оценки доктрины «Производство». */
export function rechargeHeadroom(game: GameSnapshot, playerId: string): number {
  let faceDown = 0
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== playerId) continue
    for (const token of cell.resourceTokens) if (token.faceUp === false) faceDown += 1
  }
  return faceDown - computeRechargeBudget(game, playerId, 0)
}
