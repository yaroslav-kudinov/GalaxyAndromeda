/**
 * Жадный бот: соперник в партиях с людьми (боты в лобби) и в замерах баланса.
 *
 * Три уровня сложности. «Лёгкий» — исходный жадный бот: последовательный, никогда не встаёт,
 * но играет прямолинейно. «Средний» и «высокий» решают по взвешенной оценке ситуации
 * (`bot-strategy.ts`, `bot-tactics.ts`, `bot-decisions.ts`): средний выбирает стратегический
 * режим и в основном наступает, высокий вдобавок видит угрозы своим центрам, мешает лидеру и
 * расчётливо ведёт бой. Уровень задаётся для каждого бота отдельно; по умолчанию — лёгкий.
 *
 * Боевые решения движок принимает вне очереди хода, поэтому бот отвечает за всех участников
 * боя, а не только за активного игрока.
 *
 * Живая партия: `planGreedyBotAction` решает на копии состояния и возвращает одно действие
 * бота — его применяют тем же путём, что и действие человека. За людей бот не ходит: их
 * решения, которые он «примеряет» в бою, остаются в копии.
 */

import { applyGameActionOnSnapshot, getMovableShipsAtMarker, resolveCombatPrep } from './movement.js'
import {
  buildCombatPreviewFromPending,
  combatPrepOf,
  combatSupportersAwaited,
  getCombatRetreatDestinations,
  type CombatPreview,
} from './combat.js'
import { actionMarkerLimitForPlayer, countControlledPowerCenters } from './marker-pools.js'
import { canPlaceActionMarkerOnCell } from './markers.js'
import { getBuildableShipsForMarker } from './production.js'
import { getShipProductionCost } from './ships.js'
import { claimPicksRemaining } from './claim.js'
import { rechargePicksRemaining } from './resource-recharge.js'
import { besiegedCellKeysOf, siegeLossesOwedBy } from './siege.js'
import { doctrineChoiceOwed, type DoctrineId } from './doctrines.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { ShipMovePlan } from './movement.js'
import { hexKey, type HexCoord, type MapDefinition, type ShipType, type ShipUnit } from './types.js'
import { combatStrength } from './bot-combat-math.js'
import { BOT_PROFILES, type SmartDifficulty } from './bot-strategy.js'
import {
  chooseClaimPicks,
  chooseMarkerCell,
  chooseRechargePicks,
  createTacticalContext,
  planMarker,
  reserveValueOf,
  type MarkerPlan,
} from './bot-tactics.js'
import {
  hardKeepFighting,
  hardPrepDecision,
  hardRetreatDestination,
  hardSupportSide,
  pickSmartDoctrine,
} from './bot-decisions.js'

export { combatStrength }

/** Уровень сложности бота. */
export type BotDifficulty = 'easy' | 'medium' | 'hard'

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard']

export interface GreedyBotOptions {
  /** Сложность каждого бота; не указан — 'easy'. */
  difficultyByPlayer?: Readonly<Record<string, BotDifficulty>>
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard'
}

/** Сложность бота `playerId`; всё непонятное — лёгкий уровень, как было до уровней. */
export function botDifficultyOf(options: GreedyBotOptions | undefined, playerId: string): BotDifficulty {
  const value = options?.difficultyByPlayer?.[playerId]
  return isBotDifficulty(value) ? value : 'easy'
}

/** Боевые развилки по расчёту шансов, а не по простому правилу. */
function smartCombatOf(difficulty: BotDifficulty): boolean {
  return difficulty !== 'easy' && BOT_PROFILES[difficulty].smartCombat
}

function smartLevel(difficulty: BotDifficulty): SmartDifficulty {
  return difficulty === 'medium' ? 'medium' : 'hard'
}

/** Сколько раундов бот готов драться, прежде чем выйти из боя. */
export const GREEDY_BOT_MAX_COMBAT_ROUNDS = 12

type ActionSink = typeof applyGameActionOnSnapshot

let actionSink: ActionSink = applyGameActionOnSnapshot

/**
 * Живой прогон против сервера (`harness/scripts/play-bots.ts`) подменяет исполнение действий:
 * бот решает на копии состояния, а действие уходит на сервер.
 */
export function setGreedyBotActionSink(sink: ActionSink | null): void {
  actionSink = sink ?? applyGameActionOnSnapshot
}

const act: ActionSink = (...args) => actionSink(...args)

type BotErrorListener = (error: unknown, where: string) => void

let botErrorListener: BotErrorListener | null = null

/**
 * Замер и тесты слушают сбои оценки среднего и высокого уровня: в живой партии сбой молча
 * заменяется решением простого бота, и без слушателя ошибку в расчёте не заметить.
 */
export function setBotErrorListener(listener: BotErrorListener | null): void {
  botErrorListener = listener
}

type BotTraceListener = (playerId: string, text: string) => void

let botTraceListener: BotTraceListener | null = null

/**
 * Объяснение решений среднего и высокого уровня: режим, выбранный маркер, слагаемые оценки.
 * Для отладки и разбора партий; в живой партии слушателя нет и строки не собираются.
 */
export function setBotTraceListener(listener: BotTraceListener | null): void {
  botTraceListener = listener
}

function trace(playerId: string, text: () => string): void {
  if (botTraceListener) botTraceListener(playerId, text())
}

/**
 * Оценка бота не должна ронять партию: при ошибке в расчёте берётся запасное решение.
 * Сигнал о спланированном действии (`planGreedyBotAction`) пропускается дальше.
 */
function safeEval<T>(where: string, evaluate: () => T, fallback: () => T): T {
  try {
    return evaluate()
  } catch (error) {
    if (error instanceof PlannedSignal) throw error
    botErrorListener?.(error, where)
    return fallback()
  }
}

export function parseKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q: q ?? 0, r: r ?? 0 }
}

export function indexCells(game: GameSnapshot): Map<string, RuntimeCellState> {
  const index = new Map<string, RuntimeCellState>()
  for (const cell of game.cells) index.set(hexKey(cell.coord.q, cell.coord.r), cell)
  return index
}

export function faceUpValueFor(game: GameSnapshot, playerId: string): number {
  let total = 0
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== playerId) continue
    for (const token of cell.resourceTokens) {
      if (token.faceUp !== false) total += token.value
    }
  }
  return total
}

function enemyShipsOn(cell: RuntimeCellState, playerId: string): ShipUnit[] {
  return cell.ships.filter((ship) => ship.ownerId !== playerId)
}

/**
 * Выбор доктрины. Лёгкий уровень — дуга из плана: рано расширяться, поздно держаться. Центр в
 * осаде — «Оборона» (перебросы гарнизона и −1 к вражеским попаданиям); флот сильнее вражеского
 * и центров мало — «Атака»; четыре центра и больше — «Оборона», пока не сорвали; иначе
 * «Экспансия». Ничьи между равноценными — случайно, как везде у бота.
 *
 * Средний уровень берёт доктрину своего главного режима, высокий — по взвешенной оценке
 * выгоды каждой доктрины за окно (`bot-decisions.ts`).
 */
export function pickDoctrine(game: GameSnapshot, playerId: string, difficulty: BotDifficulty = 'easy'): DoctrineId {
  if (difficulty !== 'easy') {
    const doctrineId = safeEval(
      'doctrine',
      () => pickSmartDoctrine(game, playerId, difficulty),
      () => pickDoctrine(game, playerId, 'easy'),
    )
    trace(playerId, () => `ход ${game.turnNumber}: доктрина ${doctrineId}`)
    return doctrineId
  }
  const powerCenters = countControlledPowerCenters(game, playerId)
  const myFleet: ShipType[] = []
  const enemyFleet: ShipType[] = []
  for (const cell of game.cells) {
    for (const ship of cell.ships) (ship.ownerId === playerId ? myFleet : enemyFleet).push(ship.type)
  }
  const scores: Record<DoctrineId, number> = {
    expansion: 3,
    production: powerCenters >= 3 ? 2 : 1,
    // Манёвры ускоряют только тяжёлые корабли — смысл есть, когда они в флоте.
    maneuvers: myFleet.some((type) => type === 'battleship' || type === 'carrier' || type === 'hyper') ? 3 : 0,
    attack: powerCenters <= 2 && combatStrength(myFleet) > 1.5 * combatStrength(enemyFleet) ? 4 : 0,
    defense: besiegedCellKeysOf(game, playerId).length > 0 ? 6 : powerCenters >= 4 ? 4 : 0,
    none: 0,
  }
  return pickAmongBest(Object.keys(scores) as DoctrineId[], (id) => scores[id]) ?? 'none'
}

/** Нападать стоит с заметным перевесом: бой идёт до конца, а урон копится у обеих сторон. */
const ATTACK_STRENGTH_MARGIN = 1.5

/**
 * Ценность клетки как цели хода. Центры власти — валюта победы, поэтому они дороже всего;
 * дальше идут нейтральные клетки с фишками, потом просто нейтральные.
 *
 * @param attackers — корабли маркера, способные дойти до этой клетки: в бой идут все вместе.
 */
function targetScore(
  cell: RuntimeCellState | undefined,
  playerId: string,
  attackers: readonly ShipType[],
): number {
  if (!cell) return -1
  const enemies = enemyShipsOn(cell, playerId)
  const defended = enemies.length > 0
  const canWin =
    combatStrength(attackers) > ATTACK_STRENGTH_MARGIN * combatStrength(enemies.map((s) => s.type))
  if (cell.isPowerCenter) {
    if (cell.controlOwnerId === playerId) return defended && canWin ? 60 : 5
    if (!defended) return cell.controlOwnerId == null ? 120 : 110
    if (canWin) return 90
    // Без перевеса центр можно осадить: гарнизон тает сам, лишь бы нас не выбили вылазкой.
    const holds =
      attackers.length > 0
      && combatStrength(attackers) >= combatStrength(enemies.map((s) => s.type))
    return holds && cell.controlOwnerId !== null ? 70 : -1
  }

  if (defended && !canWin) return -1

  const tokenValue = cell.resourceTokens.reduce((sum, token) => sum + token.value, 0)
  if (cell.controlOwnerId == null) return (tokenValue > 0 ? 40 + tokenValue : 20) + (defended ? 5 : 0)
  if (cell.controlOwnerId !== playerId) return defended ? 25 : 30
  return 1
}

/**
 * Выбор среди равноценных вариантов — случайный (по сиду прогона).
 *
 * Если брать «первый по порядку», бот оказывается несимметричен: порядок клеток в файле карты
 * и порядок обхода соседей при зеркальном отражении карты не отражаются, и одна сторона
 * систематически получает лучшие ничьи. На идеально симметричной карте это давало одной
 * стороне 62–70 % побед — перекос бота, а не игры.
 */
export function pickAmongBest<T>(items: readonly T[], score: (item: T) => number): T | null {
  let bestScore = -Infinity
  let best: T[] = []
  for (const item of items) {
    const value = score(item)
    if (value > bestScore) {
      bestScore = value
      best = [item]
    } else if (value === bestScore) {
      best.push(item)
    }
  }
  if (best.length === 0 || bestScore <= -Infinity) return null
  return best[Math.floor(Math.random() * best.length)]!
}

export function tryPlaceMarker(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  difficulty: BotDifficulty = 'easy',
): boolean {
  if (difficulty !== 'easy') {
    const coord = safeEval(
      'marker',
      () => chooseMarkerCell(createTacticalContext(game, map, playerId, difficulty)),
      () => null,
    )
    if (coord) {
      const { errors } = act(game, map, playerId, 'toggle-marker', { coord, kind: 'action' })
      if (errors.length === 0) return true
    }
  }
  const limit = actionMarkerLimitForPlayer(game, playerId)
  const owned = game.actionMarkers.filter((marker) => marker.ownerId === playerId).length
  if (owned >= limit) return false

  const candidates = game.cells.filter(
    (cell) => !cell.actionMarkerId && canPlaceActionMarkerOnCell(cell, playerId),
  )
  // Клетки с кораблями полезнее: маркер на них двигает флот, а не только держит центр.
  const best = pickAmongBest(candidates, (cell) =>
    cell.ships.filter((ship) => ship.ownerId === playerId).length * 10 + (cell.isPowerCenter ? 3 : 0),
  )
  if (!best) return false

  const { errors } = act(game, map, playerId, 'toggle-marker', {
    coord: best.coord,
    kind: 'action',
  })
  return errors.length === 0
}

export interface SpendTally {
  tokenFaceValue: number
  shipCost: number
}

function tryBuild(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  markerId: string,
  markerCoord: HexCoord,
  tally: SpendTally,
): boolean {
  const options = getBuildableShipsForMarker(game, map.id, playerId, markerId)
  const affordable = options.filter((option) => !option.disabledReason && option.maxCount >= 1)
  if (affordable.length === 0) return false

  // Самый дорогой доступный корпус: дешёвые эсминцы строятся и так, а замер должен
  // показывать, когда открываются тяжёлые классы.
  const best = affordable.reduce((a, b) =>
    a.cost.credits + a.cost.production >= b.cost.credits + b.cost.production ? a : b,
  )
  const count = Math.max(1, best.maxCount)
  const ships = Array.from({ length: count }, () => ({ type: best.type, coord: markerCoord }))

  const before = faceUpValueFor(game, playerId)
  const { errors } = act(game, map, playerId, 'execute-production', {
    markerId,
    ships,
  })
  if (errors.length) return false

  const spent = before - faceUpValueFor(game, playerId)
  const cost = getShipProductionCost(best.type)
  tally.tokenFaceValue += Math.max(0, spent)
  tally.shipCost += (cost.credits + cost.production) * count
  return true
}

function tryMove(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  markerCoord: HexCoord,
): boolean {
  const options = getMovableShipsAtMarker(game, map, playerId, markerCoord)
  const movable = options.filter((option) => !option.disabledReason)
  if (movable.length === 0) return false

  const cells = indexCells(game)
  const originKey = hexKey(markerCoord.q, markerCoord.r)
  const taken = new Set<string>([originKey])
  const assigned = new Set<string>()
  const moves: ShipMovePlan[] = []
  let combatChosen = false

  // Кто из кораблей маркера дотягивается до клетки боя: в бой они идут все вместе.
  const attackersFor = (key: string) =>
    movable
      .filter((option) => !assigned.has(option.ship.id) && option.combatReachableKeys.includes(key))
      .map((option) => option.ship.type)
  const scoreFor = (key: string) => {
    const cell = cells.get(key)
    const isCombat = !!cell && enemyShipsOn(cell, playerId).length > 0
    if (isCombat && combatChosen) return -1
    return targetScore(cell, playerId, isCombat ? attackersFor(key) : [])
  }

  for (const option of movable) {
    if (assigned.has(option.ship.id)) continue
    const reachable = [...option.reachableKeys, ...option.combatReachableKeys].filter(
      (key) => !taken.has(key) && scoreFor(key) > 0,
    )
    const bestKey = pickAmongBest(reachable, scoreFor)
    if (!bestKey) continue
    taken.add(bestKey)
    const cell = cells.get(bestKey)
    if (cell && enemyShipsOn(cell, playerId).length > 0) {
      // Один маркер — один бой, и идти в него поодиночке бессмысленно.
      combatChosen = true
      for (const other of movable) {
        if (assigned.has(other.ship.id) || !other.combatReachableKeys.includes(bestKey)) continue
        assigned.add(other.ship.id)
        moves.push({ shipId: other.ship.id, to: parseKey(bestKey) })
      }
      continue
    }
    assigned.add(option.ship.id)
    moves.push({ shipId: option.ship.id, to: parseKey(bestKey) })
  }
  if (moves.length === 0) return false

  const { errors } = act(game, map, playerId, 'execute-marker-movement', {
    from: markerCoord,
    moves,
  })
  return errors.length === 0
}

/** Снимает маркер, который нечем исполнить, иначе фаза действий не закроется. */
function dropMarker(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  coord: HexCoord,
): boolean {
  const { errors } = act(game, map, playerId, 'toggle-marker', {
    coord,
    kind: 'action',
  })
  return errors.length === 0
}

/**
 * Сколько раз маркер уже пробовали исполнить за этот ход. Ход, начавший бой, маркер не
 * тратит: если бой кончился отступлением, бот без счётчика будет начинать его бесконечно.
 */
export type MarkerAttempts = Map<string, number>

const MAX_MARKER_ATTEMPTS = 2

export function stepActions(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  tally: SpendTally,
  attempts: MarkerAttempts,
  difficulty: BotDifficulty = 'easy',
): boolean {
  if (game.actionMarkerResolvedThisTurn) return false
  if (difficulty !== 'easy') return stepActionsSmart(game, map, playerId, tally, attempts, difficulty)
  return stepActionsEasy(game, map, playerId, tally, attempts)
}

function stepActionsEasy(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  tally: SpendTally,
  attempts: MarkerAttempts,
): boolean {
  const markers = game.actionMarkers.filter((marker) => marker.ownerId === playerId)
  if (markers.length === 0) return false

  const countMarkers = () => game.actionMarkers.filter((m) => m.ownerId === playerId).length
  const before = countMarkers()
  /**
   * Действие засчитывается, если маркер израсходован, снят — или начался бой: ход,
   * поднявший бой, маркер не тратит до его разрешения. Без этой проверки движок
   * принимает часть холостых действий без ошибки и фаза действий зацикливается.
   */
  const consumed = () =>
    game.pendingCombat != null || game.actionMarkerResolvedThisTurn || countMarkers() < before

  for (const marker of markers) {
    const key = `${game.turnNumber}:${marker.id}`
    const tried = attempts.get(key) ?? 0
    if (tried >= MAX_MARKER_ATTEMPTS) continue
    attempts.set(key, tried + 1)
    if (tryBuild(game, map, playerId, marker.id, marker.coord, tally) && consumed()) return true
    if (tryMove(game, map, playerId, marker.coord) && consumed()) return true
  }

  // Ничего исполнить не удалось — снимаем маркер, иначе фаза действий не закроется.
  const stuck = markers.find(
    (marker) => (attempts.get(`${game.turnNumber}:${marker.id}`) ?? 0) >= MAX_MARKER_ATTEMPTS,
  )
  return dropMarker(game, map, playerId, (stuck ?? markers[0]!).coord) && consumed()
}

/** Веса режимов одной строкой — для объяснения решения. */
function describeModes(modes: Record<string, number>): string {
  return Object.entries(modes)
    .filter(([, weight]) => weight >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, weight]) => `${mode} ${weight.toFixed(2)}`)
    .join(', ')
}

/** Исполнить план маркера; постройку записать в замер трат. Отказ движка — в слушатель сбоев. */
function executeMarkerPlan(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  marker: { id: string; coord: HexCoord },
  plan: MarkerPlan,
  tally: SpendTally,
): boolean {
  let errors: string[]
  if (plan.kind === 'build') {
    const before = faceUpValueFor(game, playerId)
    const ships = Array.from({ length: plan.count }, () => ({ type: plan.type, coord: { ...marker.coord } }))
    errors = act(game, map, playerId, 'execute-production', { markerId: marker.id, ships }).errors
    if (!errors.length) {
      const cost = getShipProductionCost(plan.type)
      tally.tokenFaceValue += Math.max(0, before - faceUpValueFor(game, playerId))
      tally.shipCost += (cost.credits + cost.production) * plan.count
    }
  } else if (plan.kind === 'assault') {
    errors = act(game, map, playerId, 'execute-marker-assault', { from: { ...marker.coord } }).errors
  } else {
    errors = act(game, map, playerId, 'execute-marker-movement', { from: { ...marker.coord }, moves: plan.moves }).errors
  }
  // Отказ за человека в живой партии — не расхождение оценки с правилами.
  if (errors.length && errors[0] !== NOT_A_BOT) botErrorListener?.(new Error(errors.join('; ')), `plan-${plan.kind}`)
  return errors.length === 0
}

/**
 * Ход маркером для среднего и высокого уровня: оценить дело каждого маркера и исполнить
 * лучший. Маркер, который держит ответ на угрозу своему центру, придерживается до поздних
 * кругов. Если оценка разошлась с правилами и движок отказал — запасной путь простого бота,
 * а в крайнем случае маркер снимается: фаза действий обязана закрыться.
 */
function stepActionsSmart(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  tally: SpendTally,
  attempts: MarkerAttempts,
  difficulty: Exclude<BotDifficulty, 'easy'>,
): boolean {
  const markers = game.actionMarkers.filter((marker) => marker.ownerId === playerId)
  if (markers.length === 0) return false
  const countMarkers = () => game.actionMarkers.filter((m) => m.ownerId === playerId).length
  const before = countMarkers()
  const consumed = () =>
    game.pendingCombat != null || game.actionMarkerResolvedThisTurn || countMarkers() < before

  // Пока у соперников есть маркеры, запас на ответ ещё может понадобиться.
  const rivalsStillAct = game.actionMarkers.some((marker) => marker.ownerId !== playerId)
  let modeNote = ''
  const evaluated = safeEval('actions', () => {
    const ctx = createTacticalContext(game, map, playerId, difficulty)
    if (botTraceListener) modeNote = describeModes(ctx.situation.modes)
    return markers.map((marker) => {
      const key = hexKey(marker.coord.q, marker.coord.r)
      const tried = attempts.get(`${game.turnNumber}:${marker.id}`) ?? 0
      const plan = tried >= MAX_MARKER_ATTEMPTS ? null : planMarker(ctx, key, false)
      const reserve = reserveValueOf(ctx, key)
      const value = plan?.value ?? -Infinity
      return { marker, plan, reserve, tried, score: value - (rivalsStillAct ? reserve : 0) }
    })
  }, () => null)
  if (!evaluated) return stepActionsEasy(game, map, playerId, tally, attempts)
  const candidates = evaluated

  const tryPlan = (candidate: (typeof candidates)[number]): boolean => {
    if (!candidate.plan) return false
    const { plan, marker } = candidate
    trace(playerId, () =>
      `ход ${game.turnNumber}, маркер ${marker.coord.q},${marker.coord.r}: ${plan.kind} — ${plan.reason} `
        + `(оценка ${plan.value.toFixed(1)}; ${modeNote})`)
    attempts.set(`${game.turnNumber}:${candidate.marker.id}`, candidate.tried + 1)
    if (executeMarkerPlan(game, map, playerId, candidate.marker, candidate.plan, tally) && consumed()) return true
    // Движок отказал: оценка разошлась с правилами. Запасной путь — как у простого бота.
    if (tryBuild(game, map, playerId, candidate.marker.id, candidate.marker.coord, tally) && consumed()) return true
    return tryMove(game, map, playerId, candidate.marker.coord) && consumed()
  }

  const ranked = candidates
    .filter((candidate) => candidate.plan && candidate.plan.value > 0)
    .sort((a, b) => b.score - a.score)
  const top = ranked[0]
  if (top && top.score > 0) {
    for (const candidate of ranked) if (tryPlan(candidate)) return true
  }

  // Полезного дела сейчас нет. Сначала снимаем маркер, который ни на что не годен и не держит
  // запас; иначе исполняем придержанный план; иначе снимаем наименее нужный маркер.
  const idle = candidates
    .filter((candidate) => !(candidate.plan && candidate.plan.value > 0) && candidate.reserve <= 0)
  if (idle.length > 0) return dropMarker(game, map, playerId, idle[0]!.marker.coord) && consumed()
  for (const candidate of ranked) if (tryPlan(candidate)) return true
  const leastNeeded = [...candidates].sort((a, b) => a.reserve - b.reserve)[0]!
  return dropMarker(game, map, playerId, leastNeeded.marker.coord) && consumed()
}

/**
 * Стоит ли стороне продолжать бой: оставшаяся сила (ожидаемые попадания на оставшуюся
 * прочность) не меньше вражеской. Отступление — чтобы не терять флот в заведомо проигранном бою.
 */
/** Штурмовать, а не осаждать: сила атаки втрое больше обороны вместе с перебросами. */
function overwhelms(preview: CombatPreview): boolean {
  const strength = (side: CombatPreview['attacker']) =>
    side.expectedHits * side.ships.reduce((sum, ship) => sum + ship.hull, 0)
  return strength(preview.attacker) >= 3 * strength(preview.defender)
}

function sideHoldsOut(preview: CombatPreview, side: 'attacker' | 'defender'): boolean {
  const strength = (sidePreview: CombatPreview['attacker']) => {
    const hull = sidePreview.ships.reduce((sum, ship) => sum + Math.max(0, ship.hull - ship.damage), 0)
    return sidePreview.expectedHits * hull
  }
  const own = strength(side === 'attacker' ? preview.attacker : preview.defender)
  const enemy = strength(side === 'attacker' ? preview.defender : preview.attacker)
  return own >= enemy
}

/**
 * Один шаг боевого конечного автомата. Возвращает false, если продвинуться не удалось —
 * тогда вызывающий аварийно снимает бой, чтобы партия не зависла.
 */
/** Кто из участников боя какого уровня: по умолчанию все лёгкие, как было до уровней. */
export type BotDifficultyResolver = (playerId: string) => BotDifficulty

const ALL_EASY: BotDifficultyResolver = () => 'easy'

export function stepCombat(
  game: GameSnapshot,
  map: MapDefinition,
  options: { maxCombatRounds: number } = { maxCombatRounds: GREEDY_BOT_MAX_COMBAT_ROUNDS },
  hooks: { onSiegeEstablished?: () => void } = {},
  difficultyOf: BotDifficultyResolver = ALL_EASY,
): boolean {
  const pending = game.pendingCombat
  if (!pending) return true

  if (pending.phase === 'prep') {
    const prep = combatPrepOf(pending)
    if (!prep) return false
    if (prep.phase === 'countdown') {
      // `resolveCombatPrep` сам отсчёт не проверяет — сервер делает это отдельно,
      // поэтому в харнессе никаких задержек не нужно.
      const { errors } = resolveCombatPrep(game, map)
      return errors.length === 0
    }
    const attackerId = pending.attackerId
    const preview = buildCombatPreviewFromPending(game)
    // Отвечает каждый, кто ещё не ответил. Отказ одного (в живой партии — человек, за которого
    // бот не ходит) не мешает ответить остальным.
    let progressed = false
    if (!prep.readyBy[attackerId] && smartCombatOf(difficultyOf(attackerId))) {
      // Высокий уровень считает шансы: штурм, осада или отказ от ответа на осаду.
      const decision = safeEval('combat-prep', () => hardPrepDecision(game, map, attackerId, smartLevel(difficultyOf(attackerId))), () => 'ready' as const)
      if (decision === 'siege') {
        const siege = act(game, map, attackerId, 'establish-siege')
        if (!siege.errors.length) {
          hooks.onSiegeEstablished?.()
          return true
        }
      }
      if (decision === 'decline' && prep.siegeResponse) {
        const decline = act(game, map, attackerId, 'cancel-combat-prep')
        if (!decline.errors.length) return true
      }
      progressed = act(game, map, attackerId, 'update-combat-prep', { ready: true }).errors.length === 0
    } else if (!prep.readyBy[attackerId]) {
      if (prep.siegeAvailable && preview && !overwhelms(preview)) {
        // Штурм без подавляющего перевеса стоит флота; осада берёт центр бесплатно, но дольше.
        const siege = act(game, map, attackerId, 'establish-siege')
        if (!siege.errors.length) {
          hooks.onSiegeEstablished?.()
          return true
        }
      }
      if (prep.siegeResponse && preview && !sideHoldsOut(preview, 'attacker')) {
        const decline = act(game, map, attackerId, 'cancel-combat-prep')
        if (!decline.errors.length) return true
      }
      progressed = act(game, map, attackerId, 'update-combat-prep', { ready: true }).errors.length === 0
    }
    if (pending.trigger !== 'bombardment' && prep.defenderId) {
      if (!prep.readyBy[prep.defenderId]) {
        const ready = act(game, map, prep.defenderId, 'update-combat-prep', { ready: true })
        progressed ||= ready.errors.length === 0
      }
      // Третьи игроки: без их ответа бой не начнётся.
      for (const candidate of preview?.supportCandidates ?? []) {
        if (prep.readyBy[candidate.playerId]) continue
        const smart = smartCombatOf(difficultyOf(candidate.playerId))
        const ready = act(game, map, candidate.playerId, 'update-combat-prep', {
          ready: true,
          // Гарнизон встаёт против своего осаждающего; прочие — против лидера (лёгкий и
          // средний) или против того, кто опаснее самому боту (высокий).
          supportSide: candidate.garrisonShipIds?.length
            ? 'attacker'
            : smart
              ? safeEval(
                'support',
                () => hardSupportSide(game, candidate.playerId, attackerId, prep.defenderId, smartLevel(difficultyOf(candidate.playerId))),
                () => supportSideFor(game, candidate.playerId, attackerId, prep.defenderId),
              )
              : supportSideFor(game, candidate.playerId, attackerId, prep.defenderId),
        })
        progressed ||= ready.errors.length === 0
      }
    }
    return progressed
  }

  if (pending.phase === 'awaiting-rerolls') {
    // Перебросы гарнизона бот отдаёт игре: она перебрасывает промахи самых точных кубиков.
    const playerId = pending.rolledRound.rerolls?.playerId
    if (!playerId) return false
    return act(game, map, playerId, 'finish-combat-rerolls', { auto: true }).errors.length === 0
  }

  if (pending.phase === 'awaiting-continue') {
    const attackerId = pending.attackerId
    const defenderId = pending.defenderIds[0]
    const decided = pending.continueDecisions ?? {}
    if (decided.attacker !== undefined && decided.defender !== undefined) {
      // Стороны решили — ждём поддерживающих; их кубики раздаёт автоматика.
      const supporters = combatSupportersAwaited(game, buildCombatPreviewFromPending(game))
        .filter((playerId) => !pending.supportReady?.[playerId])
      // Последнее подтверждение запускает раунд, поэтому по одному за шаг.
      return supporters.some((supporter) => act(game, map, supporter, 'continue-combat').errors.length === 0)
    }
    const side = decided.attacker === undefined ? 'attacker' : 'defender'
    const playerId = side === 'attacker' ? attackerId : defenderId
    if (!playerId) return false

    const retreats = getCombatRetreatDestinations(game, playerId)
    const smart = smartCombatOf(difficultyOf(playerId))
    let keepFighting: boolean
    if (smart) {
      keepFighting = !retreats.length
        || safeEval(
          'continue',
          () => hardKeepFighting(game, playerId, side, pending.roundNumber, options.maxCombatRounds),
          () => pending.roundNumber < options.maxCombatRounds,
        )
    } else {
      const preview = buildCombatPreviewFromPending(game)
      keepFighting =
        pending.roundNumber < options.maxCombatRounds
        && (!preview || !retreats.length || sideHoldsOut(preview, side))
    }
    if (keepFighting) {
      const { errors } = act(game, map, playerId, 'continue-combat')
      return errors.length === 0
    }

    const retreatTo = smart
      ? safeEval('retreat', () => hardRetreatDestination(game, playerId), () => retreats[0])
      : retreats[0]
    const { errors } = act(
      game,
      map,
      playerId,
      'stop-combat',
      retreatTo ? { retreatTo } : undefined,
    )
    return errors.length === 0
  }

  return false
}

/**
 * Кого поддержать третьему игроку: того, кто отстаёт по центрам власти, — чтобы не растить
 * лидера. При равенстве не вмешиваться.
 */
export function supportSideFor(
  game: GameSnapshot,
  playerId: string,
  attackerId: string,
  defenderId: string,
): 'attacker' | 'defender' | null {
  const attackerCenters = countControlledPowerCenters(game, attackerId)
  const defenderCenters = countControlledPowerCenters(game, defenderId)
  const mine = countControlledPowerCenters(game, playerId)
  // Лидер не помогает никому: ему выгодно, чтобы соперники тратили флот друг на друга.
  if (mine > Math.max(attackerCenters, defenderCenters)) return null
  if (attackerCenters > defenderCenters) return 'defender'
  if (defenderCenters > attackerCenters) return 'attacker'
  return null
}

/**
 * Выбор клеток захвата. Лёгкий уровень отдаёт выбор движку (центры власти, затем дорогие
 * фишки); средний и высокий выбирают сами — с учётом связности регионов и помехи лидеру.
 * Если выбор бота движок отклонил, решает движок: партия не должна стоять.
 */
export function settleClaimPicks(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  difficulty: BotDifficulty = 'easy',
): boolean {
  if (difficulty !== 'easy') {
    const picks = safeEval('claims', () => chooseClaimPicks(game, playerId, difficulty), () => undefined)
    if (picks?.length && act(game, map, playerId, 'execute-claim-picks', { picks }).errors.length === 0) return true
  }
  return act(game, map, playerId, 'execute-claim-picks').errors.length === 0
}

/** Выбор фишек перезарядки: высокий уровень поднимает их там и того вида, где будет строить. */
export function settleRechargePicks(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  difficulty: BotDifficulty = 'easy',
): boolean {
  if (difficulty !== 'easy' && BOT_PROFILES[difficulty].smartRecharge) {
    const picks = safeEval('recharge', () => chooseRechargePicks(game, playerId), () => undefined)
    if (picks?.length && act(game, map, playerId, 'execute-recharge-picks', { picks }).errors.length === 0) return true
  }
  return act(game, map, playerId, 'execute-recharge-picks').errors.length === 0
}

/**
 * Один шаг ботов на живой партии: бой, выбор доктрин, долги планирования, маркеры, действия.
 * Ходит только за `botIds`; ход человека не трогает.
 */
export function greedyBotStep(
  game: GameSnapshot,
  map: MapDefinition,
  botIds: ReadonlySet<string>,
  attempts: MarkerAttempts,
  options?: GreedyBotOptions,
): void {
  if (game.gameOver) return
  const difficultyOf: BotDifficultyResolver = (playerId) => botDifficultyOf(options, playerId)
  if (game.siegeContinuationChoice) {
    const { playerId } = game.siegeContinuationChoice
    if (botIds.has(playerId)) act(game, map, playerId, 'resolve-siege-continuation', { continue: true })
    return
  }
  if (game.pendingCombat) {
    stepCombat(game, map, undefined, undefined, difficultyOf)
    return
  }
  if (game.phase === 'planning') {
    // Потери в осаде и доктрина — вне очереди и раньше всего: доктрины вскрываются, когда
    // выбрали все, а до своих потерь в осаде игрок доктрину не выбирает (`planningStepFor`).
    for (const playerId of botIds) {
      if (siegeLossesOwedBy(game, playerId).length > 0) act(game, map, playerId, 'execute-siege-losses')
      if (doctrineChoiceOwed(game, playerId)) {
        act(game, map, playerId, 'choose-doctrine', {
          doctrineId: pickDoctrine(game, playerId, difficultyOf(playerId)),
        })
      }
    }
    // Захват и перезарядка — тоже сразу, не дожидаясь очереди: пока бот не выбрал клетки,
    // центры власти хода не подсчитаны и победа ни у кого не проверяется.
    for (const playerId of botIds) {
      if (claimPicksRemaining(game, playerId) > 0) settleClaimPicks(game, map, playerId, difficultyOf(playerId))
      if (rechargePicksRemaining(game, playerId) > 0) settleRechargePicks(game, map, playerId, difficultyOf(playerId))
    }
  }
  // Вскрытие доктрин сразу считает захват — он может принести победу.
  if (game.gameOver) return
  const active = game.activePlayerId
  if (!active || !botIds.has(active)) return
  const difficulty = difficultyOf(active)
  let progressed = false
  if (game.phase === 'planning' && siegeLossesOwedBy(game, active).length > 0) {
    progressed = act(game, map, active, 'execute-siege-losses').errors.length === 0
  }
  if (!progressed && game.phase === 'planning' && claimPicksRemaining(game, active) > 0) {
    progressed = settleClaimPicks(game, map, active, difficulty)
  }
  if (!progressed && game.phase === 'planning' && rechargePicksRemaining(game, active) > 0) {
    progressed = settleRechargePicks(game, map, active, difficulty)
  }
  const tally: SpendTally = { tokenFaceValue: 0, shipCost: 0 }
  if (!progressed && game.phase === 'planning') progressed = tryPlaceMarker(game, map, active, difficulty)
  else if (!progressed && game.phase === 'actions') {
    progressed = stepActions(game, map, active, tally, attempts, difficulty)
  }
  if (!progressed && !game.pendingCombat) act(game, map, active, 'advance-phase')
}


/** Действие, которое бот сделал бы сейчас. */
export interface PlannedBotAction {
  playerId: string
  actionId: string
  params?: Record<string, unknown>
}

class PlannedSignal extends Error {
  constructor(readonly action: PlannedBotAction) {
    super('planned')
  }
}

/** Отказ за человека: бот решает только за ботов. */
const NOT_A_BOT = 'Решение за игрока-человека'

/**
 * Какое действие сделал бы бот из `botIds` прямо сейчас. Бот ходит по копии состояния и
 * возвращает первое удачное действие бота; решения людей он не принимает и ждёт их.
 * `null` — ботам делать нечего (ход человека, ждём его решения).
 */
export function planGreedyBotAction(
  game: GameSnapshot,
  map: MapDefinition,
  botIds: ReadonlySet<string>,
  attempts: MarkerAttempts,
  options?: GreedyBotOptions,
): PlannedBotAction | null {
  const copy = structuredClone(game)
  setGreedyBotActionSink((g, m, playerId, actionId, params) => {
    if (!botIds.has(playerId)) return { errors: [NOT_A_BOT] }
    const result = applyGameActionOnSnapshot(g, m, playerId, actionId, params)
    if (!result.errors.length) throw new PlannedSignal({ playerId, actionId, params })
    return result
  })
  try {
    greedyBotStep(copy, map, botIds, attempts, options)
    return null
  } catch (e) {
    if (e instanceof PlannedSignal) return e.action
    throw e
  } finally {
    setGreedyBotActionSink(null)
  }
}
