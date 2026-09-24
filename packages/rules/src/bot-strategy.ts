/**
 * Стратегический слой ботов средней и высокой сложности.
 *
 * Раз на вызов бот смотрит на партию целиком: сколько у кого центров власти и сколько их
 * будет после захватов следующего хода, чей флот сильнее, кто близок к победе, каким центрам
 * самого бота грозит удар. Из этого складываются веса режимов — расширение, атака,
 * накопление, оборона, осада, добивание, помеха лидеру. Режимы не переключают бота рывком:
 * они задают веса, с которыми тактический слой ценит клетки, постройки и бои. Поэтому любое
 * решение бота можно разложить на слагаемые и объяснить.
 */

import { combatStrength } from './bot-combat-math.js'
import {
  distancesFrom,
  indexBoard,
  reachForShip,
  regionsOf,
  type BoardIndex,
  type RegionInfo,
} from './bot-board.js'
import { computeClaimLimit } from './claim.js'
import { activeDoctrineId, type DoctrineId } from './doctrines.js'
import { powerCentersCapturedNextTurn } from './siege.js'
import type { GameSnapshot } from './save-file.js'
import { SHIP_PRODUCTION_COST, SHIP_PRODUCTION_REGION_MIN } from './ships.js'
import type { ShipType } from './types.js'
import { victoryThresholdForSnapshot } from './victory.js'

export type SmartDifficulty = 'medium' | 'hard'

/** Стратегические режимы: каждый — вес от 0 до 1, а не выключатель. */
export type BotMode = 'expand' | 'attack' | 'buildup' | 'defend' | 'siege' | 'finish' | 'deny'

export const BOT_MODES: readonly BotMode[] = ['expand', 'attack', 'buildup', 'defend', 'siege', 'finish', 'deny']

/**
 * Чем уровни различаются — числами, а не разными алгоритмами: так проще объяснить разницу
 * игроку и проверить её замером.
 */
export interface BotProfile {
  difficulty: SmartDifficulty
  /** Доля внимания к обороне своих центров: высокий — полная, средний — малая. */
  defenseShare: number
  /** Видит ли бот, кто из врагов долетит до его центров в этот ход. */
  threatAware: boolean
  /** Вес помехи лидеру, близкому к победе. */
  denyShare: number
  /** Шансы боя, выбор штурма или осады, отступление и поддержка — по расчёту, а не по правилу. */
  smartCombat: boolean
  /** Копит на тяжёлые корабли и строит там, где они нужны. */
  smartProduction: boolean
  /** Доктрина по взвешенной оценке ситуации. */
  smartDoctrine: boolean
  /** Поднимает фишки перезарядки там и того вида, где будет строить. */
  smartRecharge: boolean
  /** Придерживает маркер рядом с угрожаемым центром до поздних кругов — на ответный удар. */
  reserveMarkers: boolean
}

export const BOT_PROFILES: Record<SmartDifficulty, BotProfile> = {
  medium: {
    difficulty: 'medium',
    defenseShare: 0.15,
    threatAware: false,
    denyShare: 0.25,
    smartCombat: false,
    smartProduction: false,
    smartDoctrine: false,
    smartRecharge: false,
    reserveMarkers: false,
  },
  hard: {
    difficulty: 'hard',
    defenseShare: 1,
    threatAware: true,
    denyShare: 1,
    smartCombat: true,
    smartProduction: true,
    smartDoctrine: true,
    smartRecharge: true,
    reserveMarkers: true,
  },
}

export interface ShipAt {
  id: string
  type: ShipType
  key: string
}

export interface PlayerView {
  id: string
  powerCenters: number
  /** Центры власти после тика осад и захватов в начале следующего хода. */
  projected: number
  cells: number
  ships: ShipAt[]
  strength: number
  claimLimit: number
  doctrine: DoctrineId
  largestRegion: number
}

/** Угроза своему центру власти: какая вражеская сила до него долетает. */
export interface PowerCenterThreat {
  key: string
  /** Сила врага, способного войти на центр в этот ход (в фазе действий — только с маркерами). */
  now: number
  /** Сила врага в пределах хода вообще — угроза на следующий ход. */
  next: number
  /** Сила своего гарнизона на клетке. */
  garrison: number
  /** Кто грозит сильнее всех. */
  attackerId: string | null
  /** Враг уже стоит на центре: без ответа центр уйдёт захватом или осадой. */
  occupied: boolean
  /** Это последний центр игрока: потеря — выбывание. */
  last: boolean
}

export interface BotSituation {
  playerId: string
  profile: BotProfile
  board: BoardIndex
  turn: number
  turnsLeft: number
  threshold: number
  views: Map<string, PlayerView>
  me: PlayerView
  rivals: PlayerView[]
  /** Соперник, ближе всех к победе. */
  leader: PlayerView | null
  /** Насколько лидер близок к победе: 0 — далеко, 1 — побеждает в начале следующего хода. */
  leaderUrgency: number
  /** Сила своего флота к сильнейшему сопернику. */
  fleetRatio: number
  modes: Record<BotMode, number>
  /** Главный режим — для объяснения решения. */
  mode: BotMode
  threats: Map<string, PowerCenterThreat>
  /** Нейтральные центры власти на карте. */
  neutralPowerCenters: string[]
  /** Центры, которые сменят хозяина в начале следующего хода: ключ → кто забирает. */
  capturesAhead: Map<string, string>
  /** Сколько клеток бот займёт в конце хода, если корабли останутся на местах. */
  plannedClaims: { powerCenters: number; other: number }
  regions: { largest: RegionInfo | null; regionOf: Map<string, number>; list: RegionInfo[] }
}

function participantIds(game: GameSnapshot): string[] {
  const participating = game.participatingPlayerIds?.length ? new Set(game.participatingPlayerIds) : null
  return game.players
    .filter((player) => !player.eliminated && (!participating || participating.has(player.id)))
    .map((player) => player.id)
}

function buildViews(game: GameSnapshot, board: BoardIndex): Map<string, PlayerView> {
  const views = new Map<string, PlayerView>()
  for (const id of participantIds(game)) {
    views.set(id, {
      id,
      powerCenters: 0,
      projected: 0,
      cells: 0,
      ships: [],
      strength: 0,
      claimLimit: computeClaimLimit(game, id),
      doctrine: activeDoctrineId(game, id),
      largestRegion: regionsOf(board, id).largest?.size ?? 0,
    })
  }
  for (const [key, cell] of board.cells) {
    const owner = cell.controlOwnerId ? views.get(cell.controlOwnerId) : undefined
    if (owner) {
      owner.cells += 1
      if (cell.isPowerCenter) owner.powerCenters += 1
    }
    for (const ship of cell.ships) views.get(ship.ownerId)?.ships.push({ id: ship.id, type: ship.type, key })
  }
  for (const view of views.values()) {
    view.strength = combatStrength(view.ships.map((ship) => ship.type))
    view.projected = view.powerCenters
  }
  return views
}

/** Сила группы кораблей одного игрока, долетающей до клетки. */
function reachingStrength(
  board: BoardIndex,
  view: PlayerView,
  targetKey: string,
  movable: (key: string) => boolean,
): number {
  const types: ShipType[] = []
  for (const ship of view.ships) {
    if (ship.key === targetKey) continue
    if (!movable(ship.key)) continue
    if (reachForShip(board, ship.key, view.id, ship.type).has(targetKey)) types.push(ship.type)
  }
  return combatStrength(types)
}

/**
 * С каких клеток соперник ещё может ходить в этот ход. Маркеры видны всем: в фазе действий
 * ходят только корабли под маркером. В планировании игрок расставляет все маркеры за свою
 * очередь, поэтому у соперника с маркерами на карте расстановка уже окончена — опасны только
 * клетки под ними; соперник без маркеров ещё может поставить их куда угодно.
 */
export function rivalMovableCells(game: GameSnapshot, rivalId: string): ((key: string) => boolean) {
  const own = game.actionMarkers.filter((marker) => marker.ownerId === rivalId)
  if (game.phase !== 'actions' && own.length === 0) return () => true
  const cells = new Set(own.map((marker) => `${marker.coord.q},${marker.coord.r}`))
  return (key) => cells.has(key)
}

function computeThreats(
  game: GameSnapshot,
  board: BoardIndex,
  me: PlayerView,
  rivals: readonly PlayerView[],
): Map<string, PowerCenterThreat> {
  const threats = new Map<string, PowerCenterThreat>()
  const movable = new Map(rivals.map((rival) => [rival.id, rivalMovableCells(game, rival.id)]))
  for (const [key, cell] of board.cells) {
    if (!cell.isPowerCenter || cell.controlOwnerId !== me.id) continue
    let now = 0
    let next = 0
    let attackerId: string | null = null
    let occupied = false
    for (const rival of rivals) {
      const onCell = cell.ships.filter((ship) => ship.ownerId === rival.id).map((ship) => ship.type)
      if (onCell.length) occupied = true
      const reachNext = reachingStrength(board, rival, key, () => true) + combatStrength(onCell)
      const reachNow = reachingStrength(board, rival, key, movable.get(rival.id)!) + combatStrength(onCell)
      if (reachNow > now) {
        now = reachNow
        attackerId = rival.id
      }
      next = Math.max(next, reachNext)
    }
    const garrison = combatStrength(cell.ships.filter((ship) => ship.ownerId === me.id).map((ship) => ship.type))
    threats.set(key, {
      key,
      now,
      next,
      garrison,
      attackerId: attackerId ?? null,
      occupied,
      last: me.powerCenters <= 1,
    })
  }
  return threats
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Сколько клеток бот займёт в конце хода, если корабли останутся там, где стоят. */
function countPlannedClaims(board: BoardIndex, playerId: string): { powerCenters: number; other: number } {
  let powerCenters = 0
  let other = 0
  for (const cell of board.cells.values()) {
    if (cell.controlOwnerId === playerId) continue
    if (!cell.ships.some((ship) => ship.ownerId === playerId)) continue
    if (cell.ships.some((ship) => ship.ownerId !== playerId)) continue
    if (cell.isPowerCenter) powerCenters += 1
    else other += 1
  }
  return { powerCenters, other }
}

/**
 * Ближайший класс, который откроется с ростом региона, и сколько клеток до него осталось.
 * Нужен режиму накопления: копить на линкор имеет смысл, когда он вот-вот станет доступен.
 */
export function nextUnlock(regionSize: number): { type: ShipType; missing: number } | null {
  let best: { type: ShipType; missing: number } | null = null
  for (const type of ['cruiser', 'carrier', 'battleship'] as ShipType[]) {
    const missing = SHIP_PRODUCTION_REGION_MIN[type] - regionSize
    if (missing <= 0) continue
    if (!best || missing < best.missing) best = { type, missing }
  }
  return best
}

export function shipCost(type: ShipType): number {
  const cost = SHIP_PRODUCTION_COST[type]
  return cost.credits + cost.production
}

/**
 * Веса режимов. Каждое слагаемое — отдельная причина, которую можно назвать словами:
 * «нейтральных центров ещё много», «флот вдвое сильнее соседа», «до победы один центр».
 */
function computeModes(
  situation: Omit<BotSituation, 'modes' | 'mode'>,
): Record<BotMode, number> {
  const { me, threshold, turnsLeft, profile, leaderUrgency, fleetRatio, neutralPowerCenters, threats, turn } = situation
  const neutralShare = neutralPowerCenters.length / Math.max(1, threshold)

  // Расширение: пока есть нейтральные центры и клетки, а партия молода.
  const expand = clamp01(0.35 + neutralShare * 0.6 - Math.max(0, turn - 6) * 0.05)

  // Атака: флот сильнее соседей, нейтраль кончается или время уходит, а центров мало.
  const behind = situation.rivals.some((rival) => rival.projected > me.projected) ? 1 : 0
  const attack = clamp01(
    (fleetRatio - 0.8) * 0.8
      + (neutralPowerCenters.length === 0 ? 0.35 : 0)
      + (turnsLeft <= 4 ? 0.25 * behind : 0)
      + Math.max(0, turn - 5) * 0.03,
  )

  // Накопление: флот слабее соседей или вот-вот откроется тяжёлый класс.
  const unlock = nextUnlock(me.largestRegion)
  const buildup = clamp01(
    (fleetRatio < 1 ? (1 - fleetRatio) * 0.8 : 0)
      + (unlock && unlock.missing <= 3 && unlock.type !== 'cruiser' ? 0.3 : 0),
  )

  // Оборона: враг у своих центров. Средний уровень смотрит на это вполглаза.
  let danger = 0
  for (const threat of threats.values()) {
    const pressure = threat.occupied ? 1 : clamp01(threat.now / Math.max(1, threat.garrison * 1.5 + 0.5))
    danger = Math.max(danger, pressure * (threat.last ? 1 : 0.7))
  }
  const defend = clamp01(danger) * profile.defenseShare

  // Осада: центры соседей под гарнизоном, а перевеса для штурма нет — давим временем.
  const siege = clamp01(attack * 0.6 + (turnsLeft >= 3 ? 0.2 : 0))

  // Добивание: до порога один-два центра.
  const gap = threshold - me.projected
  const finish = gap <= 1 ? 1 : gap === 2 ? 0.55 : gap === 3 && turnsLeft <= 3 ? 0.35 : 0

  // Помеха лидеру: соперник близок к порогу или ведёт к концу партии.
  const deny = clamp01(leaderUrgency) * profile.denyShare

  return { expand, attack, buildup, defend, siege, finish, deny }
}

function dominantMode(modes: Record<BotMode, number>): BotMode {
  let best: BotMode = 'expand'
  for (const mode of BOT_MODES) if (modes[mode] > modes[best]) best = mode
  return best
}

/** Стратегическая картина для бота `playerId`. Дешёвая: считается на каждый вызов бота. */
export function analyzeSituation(
  game: GameSnapshot,
  playerId: string,
  profile: BotProfile,
  board: BoardIndex = indexBoard(game),
): BotSituation {
  const views = buildViews(game, board)
  const me = views.get(playerId) ?? {
    id: playerId,
    powerCenters: 0,
    projected: 0,
    cells: 0,
    ships: [],
    strength: 0,
    claimLimit: 0,
    doctrine: 'none' as DoctrineId,
    largestRegion: 0,
  }
  const capturesAhead = new Map<string, string>()
  for (const capture of powerCentersCapturedNextTurn(game)) {
    const key = `${capture.coord.q},${capture.coord.r}`
    capturesAhead.set(key, capture.capturerId)
    const capturer = views.get(capture.capturerId)
    if (capturer) capturer.projected += 1
    if (capture.ownerId) {
      const owner = views.get(capture.ownerId)
      if (owner) owner.projected -= 1
    }
  }
  const rivals = [...views.values()].filter((view) => view.id !== playerId)
  const threshold = victoryThresholdForSnapshot(game)
  const turnLimit = game.turnLimit ?? null
  const turnsLeft = turnLimit == null ? 99 : Math.max(0, turnLimit - game.turnNumber)

  let leader: PlayerView | null = null
  for (const rival of rivals) {
    if (!leader || rival.projected > leader.projected
      || (rival.projected === leader.projected && rival.strength > leader.strength)) {
      leader = rival
    }
  }
  let leaderUrgency = 0
  if (leader) {
    const gap = threshold - leader.projected
    // Мешать лидеру дорого — это ходы не на себя. Оправдано, только когда он вот-вот победит.
    leaderUrgency = gap <= 0 ? 1 : gap === 1 ? 0.7 : gap === 2 ? 0.25 : 0
    // К концу партии побеждает больший счёт, а не порог: мешать надо и ведущему по центрам.
    if (turnsLeft <= 2 && leader.projected > me.projected) leaderUrgency = Math.max(leaderUrgency, 0.5)
    // Сам бот впереди и лидер не у порога — пусть соперники мешают друг другу.
    if (me.projected > leader.projected && gap >= 2) leaderUrgency = 0
  }
  const strongestRival = Math.max(0.5, ...rivals.map((rival) => rival.strength))
  const fleetRatio = me.strength / strongestRival

  const neutralPowerCenters: string[] = []
  for (const [key, cell] of board.cells) {
    if (cell.isPowerCenter && cell.controlOwnerId == null) neutralPowerCenters.push(key)
  }

  const threats = profile.threatAware || profile.defenseShare > 0
    ? computeThreats(game, board, me, rivals)
    : new Map<string, PowerCenterThreat>()
  const regionsInfo = regionsOf(board, playerId)

  const base = {
    playerId,
    profile,
    board,
    turn: game.turnNumber,
    turnsLeft,
    threshold,
    views,
    me,
    rivals,
    leader,
    leaderUrgency,
    fleetRatio,
    threats,
    neutralPowerCenters,
    capturesAhead,
    plannedClaims: countPlannedClaims(board, playerId),
    regions: { largest: regionsInfo.largest, regionOf: regionsInfo.regionOf, list: regionsInfo.regions },
  }
  const modes = computeModes(base)
  return { ...base, modes, mode: dominantMode(modes) }
}

/** Базовая ценность одного центра власти в очках оценки; всё остальное меряется от неё. */
export const POWER_CENTER_VALUE = 100

/**
 * Ценность клетки как цели: что даст бот, если в конце хода его корабль будет стоять здесь.
 * Бой сюда не входит — его цена считается отдельно, по шансам.
 */
export function cellGoalValue(situation: BotSituation, key: string): number {
  const cell = situation.board.cells.get(key)
  if (!cell) return 0
  const { modes, playerId } = situation
  const owner = cell.controlOwnerId
  const tokenValue = cell.resourceTokens.reduce((sum, token) => sum + token.value, 0)

  if (cell.isPowerCenter) {
    if (owner === playerId) return 0
    if (owner == null) {
      let value = POWER_CENTER_VALUE * (0.75 + modes.expand * 0.35 + modes.finish * 0.8)
      value += denyBonusNear(situation, key)
      return value + tokenValue
    }
    const ownerView = situation.views.get(owner)
    let value = POWER_CENTER_VALUE * (0.8 + modes.attack * 0.3 + modes.finish * 0.8)
    // Чужой центр — двойной размен: у себя плюс один, у соперника минус один.
    value += POWER_CENTER_VALUE * 0.3
    if (ownerView && situation.leader?.id === owner) value += POWER_CENTER_VALUE * situation.modes.deny * 0.9
    // Последний центр соперника: его взятие выбивает игрока из партии.
    if (ownerView && ownerView.powerCenters <= 1) value += POWER_CENTER_VALUE * 0.4
    return value + tokenValue
  }

  if (owner === playerId) return 0
  const regionBonus = touchesOwnRegion(situation, key) ? 4 : 0
  if (owner == null) {
    return (6 + tokenValue * 2.2) * (0.5 + modes.expand * 0.6) + regionBonus
  }
  // Чужая клетка без кораблей переходит сразу при входе: это набег на экономику соперника.
  const raid = 5 + tokenValue * 1.6 + (situation.leader?.id === owner ? 6 * modes.deny : 0)
  return raid * (0.5 + modes.attack * 0.6) + regionBonus
}

function touchesOwnRegion(situation: BotSituation, key: string): boolean {
  for (const next of situation.board.neighbors.get(key) ?? []) {
    if (situation.board.cells.get(next)?.controlOwnerId === situation.playerId) return true
  }
  return false
}

/** Помеха лидеру: нейтральный центр, к которому он ближе всех, стоит дороже. */
function denyBonusNear(situation: BotSituation, key: string): number {
  const leader = situation.leader
  if (!leader || situation.modes.deny <= 0) return 0
  const dist = distancesFrom(situation.board, key)
  let nearest = Infinity
  for (const ship of leader.ships) nearest = Math.min(nearest, dist.get(ship.key) ?? Infinity)
  if (nearest > 4) return 0
  return POWER_CENTER_VALUE * 0.6 * situation.modes.deny * (nearest <= 3 ? 1 : 0.5)
}

/** Сила одного эсминца: «пикет», без которого пустой центр берут простым захватом. */
export const PICKET_STRENGTH = 0.15

/**
 * Какой гарнизон нужен своему центру в этот ход. 0 — до центра никто не долетает.
 *
 * Хотя бы один корабль нужен всегда, когда враг может войти: пустой центр уходит захватом без
 * боя, а с пикетом врагу придётся драться или осаждать. Больше — столько, чтобы штурм не сулил
 * врагу перевеса; держать ли такую силу, решает тактика: безнадёжную оборону она не держит.
 */
export function garrisonNeed(situation: BotSituation, key: string): number {
  const threat = situation.threats.get(key)
  if (!threat) return 0
  if (threat.now <= 0 && !threat.occupied) return 0
  return Math.max(PICKET_STRENGTH, threat.now / 1.3)
}

/**
 * Ценность удержания своего центра: чем важнее центр для счёта, тем дороже. Враг, который
 * только может долететь, нападёт не наверняка; враг, уже стоящий на центре, — наверняка.
 */
export function defenseValue(situation: BotSituation, key: string): number {
  const threat = situation.threats.get(key)
  if (!threat) return 0
  const base = POWER_CENTER_VALUE * (threat.last ? 2.2 : 1.1)
  const nearWin = situation.modes.finish > 0.5 ? 0.4 : 0
  const likelihood = threat.occupied ? 1 : threat.now > 0 ? 0.6 : 0.25
  return base * (1 + nearWin) * likelihood * situation.profile.defenseShare
}
