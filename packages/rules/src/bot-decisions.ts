/**
 * Решения ботов средней и высокой сложности вне очереди хода: доктрина и боевые развилки
 * (штурм или осада, ответ на осаду, продолжать ли бой, куда отступать, кого поддержать).
 */

import { distancesFrom, indexBoard, reachForShip } from './bot-board.js'
import { estimatePreview } from './bot-combat-math.js'
import {
  analyzeSituation,
  BOT_PROFILES,
  isDenyTarget,
  type BotMode,
  type BotSituation,
  type SmartDifficulty,
} from './bot-strategy.js'
import { createTacticalContext, evaluateCombatTarget, rechargeHeadroom } from './bot-tactics.js'
import {
  buildCombatPreviewFromPending,
  combatPrepOf,
  getCombatRetreatDestinations,
  type CombatPreview,
} from './combat.js'
import { type DoctrineId } from './doctrines.js'
import { countControlledPowerCenters } from './marker-pools.js'
import type { GameSnapshot } from './save-file.js'
import { besiegedCellKeysOf } from './siege.js'
import { hexKey, type HexCoord, type MapDefinition, type ShipType, type ShipUnit } from './types.js'
import { hitProbability, shipDice, shipHitThreshold } from './combat-hits.js'

// ---------------------------------------------------------------------------
// Доктрина
// ---------------------------------------------------------------------------

/** Главный режим → доктрина: так выбирает средний уровень. */
const DOCTRINE_FOR_MODE: Record<Exclude<BotMode, 'develop'>, DoctrineId> = {
  expand: 'expansion',
  attack: 'attack',
  siege: 'attack',
  deny: 'attack',
  buildup: 'production',
  defend: 'defense',
  finish: 'expansion',
}

/** Нейтральные клетки у своих кораблей — сколько бот сможет занять за окно доктрины. */
function claimableNearby(situation: BotSituation): number {
  const seen = new Set<string>()
  for (const ship of situation.me.ships) {
    for (const [key] of reachForShip(situation.board, ship.key, situation.playerId, ship.type)) {
      const cell = situation.board.cells.get(key)
      if (!cell || cell.controlOwnerId != null) continue
      if (cell.ships.some((other) => other.ownerId !== situation.playerId)) continue
      seen.add(key)
    }
  }
  return seen.size
}

export interface DoctrineScore {
  doctrineId: DoctrineId
  score: number
}

/**
 * Оценки доктрин высокого уровня: каждое слагаемое — выгода доктрины за окно в три хода в
 * грубых «клетках захвата» или «фишках», минус её цена.
 */
/** Ожидаемые попадания кораблей за раунд при поправке к нужному значению `modifier`. */
function hitsWith(types: readonly ShipType[], modifier: number): number {
  let hits = 0
  for (const type of types) hits += shipDice(type) * hitProbability(shipHitThreshold(type, 0, modifier))
  return hits
}

export function scoreDoctrines(game: GameSnapshot, playerId: string): DoctrineScore[] {
  const situation = analyzeSituation(game, playerId, BOT_PROFILES.hard)
  const { modes, me, profile } = situation
  const besieged = besiegedCellKeysOf(game, playerId).length > 0
  const heavy = me.ships.filter((ship) => ship.type === 'battleship' || ship.type === 'carrier').length
  const claimable = claimableNearby(situation)
  const headroom = rechargeHeadroom(game, playerId)
  // Лишняя клетка захвата за ход ценна, пока есть что занимать.
  const claimGain = Math.min(3, claimable / 3)
  // Во сколько раз «Атака» усилит свой огонь и насколько «Оборона» ослабит вражеский: эсминцу
  // «Атака» удваивает попадания, а против «Обороны» на чужой клетке он не стреляет вовсе.
  const myTypes = me.ships.map((ship) => ship.type)
  const myHits = hitsWith(myTypes, 0)
  const attackGain = myHits > 0 ? hitsWith(myTypes, -1) / myHits - 1 : 0
  const enemyTypes = situation.rivals.flatMap((rival) => rival.ships.map((ship) => ship.type))
  const enemyHits = hitsWith(enemyTypes, 0)
  const defenseGain = enemyHits > 0 ? 1 - hitsWith(enemyTypes, 1) / enemyHits : 0
  const fighting = Math.max(modes.attack, modes.deny, modes.finish * 0.8)
  const scores: Record<DoctrineId, number> = {
    expansion: 1 + claimGain * (0.6 + modes.expand + modes.develop * 0.3) + modes.finish * 1.2 - 0.6,
    production: 0.8 + Math.min(2, Math.max(0, headroom)) * (0.6 + modes.buildup + modes.develop * 0.5),
    attack: besieged
      ? -10
      : 5 * fighting * Math.min(1.2, situation.fleetRatio) - 1.6 - claimGain * 0.4
        + profile.attackDoctrineBonus * attackGain * fighting,
    defense: (besieged ? 6 : 0) + 5 * modes.defend + (modes.finish >= 0.99 ? 1.5 : 0) - claimGain * 0.4
      + profile.defenseDoctrineBonus * defenseGain * Math.max(modes.defend, 0.3),
    maneuvers: heavy >= 2 ? 0.5 + heavy * 0.45 * Math.max(modes.attack, modes.deny) - 1.2 : -10,
    none: 0,
  }
  return (Object.keys(scores) as DoctrineId[]).map((doctrineId) => ({ doctrineId, score: scores[doctrineId] }))
}

export function pickSmartDoctrine(game: GameSnapshot, playerId: string, difficulty: SmartDifficulty): DoctrineId {
  if (!BOT_PROFILES[difficulty].smartDoctrine) {
    const situation = analyzeSituation(game, playerId, BOT_PROFILES.medium)
    if (besiegedCellKeysOf(game, playerId).length > 0) return 'defense'
    if (situation.mode === 'develop') {
      // Развитие: перезарядка не поспевает за тратами — «Производство», иначе — больше захвата.
      const { faceDown, budget } = situation.economy
      return faceDown > budget + 1 ? 'production' : 'expansion'
    }
    return DOCTRINE_FOR_MODE[situation.mode]
  }
  let best: DoctrineScore | null = null
  for (const item of scoreDoctrines(game, playerId)) {
    if (!best || item.score > best.score) best = item
  }
  return best?.doctrineId ?? 'expansion'
}

// ---------------------------------------------------------------------------
// Бой
// ---------------------------------------------------------------------------

export type PrepDecision = 'siege' | 'decline' | 'ready'

/** Атакующий в подготовке боя: штурмовать, осадить или (для ответа на осаду) отказаться. */
export function hardPrepDecision(
  game: GameSnapshot,
  map: MapDefinition,
  attackerId: string,
  difficulty: SmartDifficulty = 'hard',
): PrepDecision {
  const pending = game.pendingCombat
  const prep = combatPrepOf(pending)
  if (!pending || !prep) return 'ready'
  const preview = buildCombatPreviewFromPending(game)
  if (prep.siegeResponse) {
    if (!preview) return 'decline'
    const estimate = estimatePreview(preview)
    return estimate.winChance >= 0.55 ? 'ready' : 'decline'
  }
  if (!prep.siegeAvailable) return 'ready'
  if (prep.assaultBlocked || !preview) return 'siege'
  const ctx = createTacticalContext(game, map, attackerId, difficulty)
  const incoming = new Set(prep.incomingAttackerShipIds ?? [])
  const attackers: ShipUnit[] = []
  for (const cell of game.cells) {
    for (const ship of cell.ships) if (incoming.has(ship.id)) attackers.push(ship)
  }
  const option = evaluateCombatTarget(ctx, pending.cellKey, attackers, false)
  return option?.siege ? 'siege' : 'ready'
}

function sideStake(game: GameSnapshot, preview: CombatPreview, playerId: string, side: 'attacker' | 'defender'): number {
  const cell = game.cells.find((candidate) => hexKey(candidate.coord.q, candidate.coord.r) === preview.coordKey)
  if (!cell?.isPowerCenter) return 1
  if (side === 'defender' && cell.controlOwnerId === playerId) {
    return countControlledPowerCenters(game, playerId) <= 1 ? 3 : 2
  }
  return 1.5
}

/**
 * Продолжать ли бой. Защитник своего последнего центра не отступает: отступление всё равно
 * отдаёт клетку, а с ней и партию. Прочие сравнивают оставшиеся силы с поправкой на ставку.
 */
export function hardKeepFighting(
  game: GameSnapshot,
  playerId: string,
  side: 'attacker' | 'defender',
  roundNumber: number,
  maxRounds: number,
): boolean {
  if (roundNumber >= maxRounds) return false
  const preview = buildCombatPreviewFromPending(game)
  if (!preview) return true
  const estimate = estimatePreview(preview)
  const myRatio = side === 'attacker' ? estimate.ratio : 1 / Math.max(estimate.ratio, 1e-6)
  const stake = sideStake(game, preview, playerId, side)
  if (stake >= 3) return true
  const needed = stake >= 2 ? 0.6 : stake >= 1.5 ? 0.7 : 0.85
  return myRatio >= needed
}

/** Куда отступать: на свою клетку, подальше от врага; при равенстве — на свой центр. */
export function hardRetreatDestination(game: GameSnapshot, playerId: string): HexCoord | undefined {
  const options = getCombatRetreatDestinations(game, playerId)
  if (options.length <= 1) return options[0]
  const board = indexBoard(game)
  let best: { coord: HexCoord; score: number } | null = null
  for (const coord of options) {
    const key = hexKey(coord.q, coord.r)
    const cell = board.cells.get(key)
    let score = 0
    if (cell?.controlOwnerId === playerId) score += cell.isPowerCenter ? 6 : 3
    // Чем ближе враги, тем хуже стоянка.
    const dist = distancesFrom(board, key)
    let nearestEnemy = 99
    for (const [otherKey, other] of board.cells) {
      if (!other.ships.some((ship) => ship.ownerId !== playerId)) continue
      nearestEnemy = Math.min(nearestEnemy, dist.get(otherKey) ?? 99)
    }
    score += Math.min(4, nearestEnemy)
    if (!best || score > best.score) best = { coord, score }
  }
  return best?.coord ?? options[0]
}

/**
 * Кого поддержать третьему игроку. Поддержка ничего не стоит — по кораблям поддержки не
 * стреляют, — поэтому бот помогает против того, кто опаснее ему самому: соседа, который грозит
 * его центрам, или сильнейшего по центрам. Высокий уровень, кроме того, всегда встаёт против
 * того, кто вот-вот победит; средний в чужую победу не вмешивается.
 */
export function hardSupportSide(
  game: GameSnapshot,
  playerId: string,
  attackerId: string,
  defenderId: string,
  difficulty: SmartDifficulty = 'hard',
): 'attacker' | 'defender' | null {
  const situation = analyzeSituation(game, playerId, BOT_PROFILES[difficulty])
  const danger = (id: string): number => {
    const view = situation.views.get(id)
    if (!view) return 0
    let score = view.projected * 10 + view.strength * 0.05
    if (isDenyTarget(situation, id)) score += 60 * situation.modes.deny
    for (const threat of situation.threats.values()) {
      if (threat.attackerId === id) score += threat.occupied ? 30 : threat.now > 0 ? 12 : 4
    }
    return score
  }
  const attackerDanger = danger(attackerId)
  const defenderDanger = danger(defenderId)
  if (Math.abs(attackerDanger - defenderDanger) < 1) return null
  return attackerDanger > defenderDanger ? 'defender' : 'attacker'
}
