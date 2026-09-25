/**
 * Стратегический слой ботов средней и высокой сложности.
 *
 * Раз на вызов бот смотрит на партию целиком: сколько у кого центров власти и сколько их
 * будет после захватов следующего хода, чей флот сильнее, кто вот-вот победит, каким центрам
 * самого бота грозит удар. Из этого складываются веса режимов — расширение, атака,
 * накопление, оборона, осада, добивание, помеха. Режимы не переключают бота рывком: они
 * задают веса, с которыми тактический слой ценит клетки, постройки и бои. Поэтому любое
 * решение бота можно разложить на слагаемые и объяснить.
 *
 * Оба уровня развивают экономику, а не только бегут за центрами (режим `develop`): ценят клетки с
 * фишками и рост регионов, тратят скопившиеся деньги на корабли и не берут каждый центр в первый
 * же ход — центр режет бюджет перезарядки, поэтому неоспариваемый центр подождёт, пока
 * экономика не встанет на ноги.
 *
 * Оба уровня прежде всего бегут к порогу сами. Высокий отличается тем, что замечает соперника,
 * который вот-вот победит (`NearWinner`), и тогда бросает силы на то, чтобы его остановить;
 * пока такого соперника нет, свою оборону он держит минимальной — она съедает темп.
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
import { computeRechargeBudget } from './resource-recharge.js'
import { activeDoctrineId, type DoctrineId } from './doctrines.js'
import { powerCentersCapturedNextTurn } from './siege.js'
import type { GameSnapshot } from './save-file.js'
import { SHIP_PRODUCTION_COST, SHIP_PRODUCTION_REGION_MIN } from './ships.js'
import { hexKey, type ShipType } from './types.js'
import { effectiveMoveRange } from './doctrines.js'
import { victoryThresholdForSnapshot } from './victory.js'

export type SmartDifficulty = 'medium' | 'hard'

/** Стратегические режимы: каждый — вес от 0 до 1, а не выключатель. */
export type BotMode = 'expand' | 'develop' | 'attack' | 'buildup' | 'defend' | 'siege' | 'finish' | 'deny'

export const BOT_MODES: readonly BotMode[] = ['expand', 'develop', 'attack', 'buildup', 'defend', 'siege', 'finish', 'deny']

/**
 * Чем уровни различаются — числами и флагами, а не разными алгоритмами: так проще объяснить
 * разницу игроку и проверить её замером.
 */
export interface BotProfile {
  difficulty: SmartDifficulty
  /** Доля внимания к обычной обороне своих центров. */
  routineDefense: number
  /**
   * Доля внимания к пустому центру, до которого долетает враг: чужой центр без гарнизона
   * уходит набегом сразу, поэтому хватает одного корабля-пикета, чтобы набег стал боем.
   */
  raidDefense: number
  /**
   * Вес экономического развития: клетки с фишками, рост регионов, трата денег, бюджет
   * перезарядки. 0 — бот бежит за центрами, как прежде.
   */
  economy: number
  /** Насколько откладывать неоспариваемый центр ради развития (доля ценности центра). */
  pacing: number
  /** Учитывать потерю перезарядки при взятии центра (множитель). */
  rechargeAware: number
  /** Скидка на трату денег, которые вернёт простаивающая перезарядка. */
  reinvest: number
  /** Насколько дешевле одиночная клетка вдали от своих: деньги с неё пока не потратить. */
  compactness: number
  /**
   * Доля внимания к обороне, от которой зависит партия: последний центр (выбывание), удар того,
   * кто вот-вот победит, или центр, без которого сорвётся своя победа.
   */
  criticalDefense: number
  /** Видит ли бот, кто из врагов долетит до его центров в этот ход. */
  threatAware: boolean
  /** Вес помехи сопернику, который вот-вот победит. 0 — бот в чужую победу не вмешивается. */
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
  /** Шансы боя по превью движка (поддержка, авианосцы, доктрины), а не по голой силе кораблей. */
  previewCombat: boolean
  /** Во сколько раз бот ценит постройку относительно перелёта. */
  buildScale: number
  /** Лишние деньги дешевле: скопившиеся фишки ничего не приносят, пока не потрачены. */
  richDiscount: boolean
  /** Оставлять на угрожаемом центре хотя бы один корабль, даже если удержать его нечем. */
  pickets: boolean
  /** Ценит взятый центр по шансу его удержать: враг рядом может отбить его в тот же ход. */
  holdAware: boolean
  /** Вес своих потерь в бою: больше единицы — бот бережёт флот. */
  lossAversion: number
  /** Множитель ценности штурма, когда центр можно взять осадой: меньше единицы — осада охотнее. */
  assaultBias: number
  /** Вес прироста своего огня от «Атаки» при выборе доктрины. */
  attackDoctrineBonus: number
  /** Вес ослабления вражеского огня от «Обороны» при выборе доктрины. */
  defenseDoctrineBonus: number
  /** Тревога, когда соперник в двух центрах от порога: 0 — ждать, пока останется один. */
  denyEarly: number
  /** Множитель тревоги к концу партии, когда по лимиту ходов победил бы соперник. */
  denyAtLimit: number
}

export const BOT_PROFILES: Record<SmartDifficulty, BotProfile> = {
  medium: {
    difficulty: 'medium',
    routineDefense: 0.15,
    raidDefense: 0,
    economy: 1,
    pacing: 0.35,
    rechargeAware: 1,
    reinvest: 0.6,
    compactness: 0.35,
    criticalDefense: 0.15,
    threatAware: false,
    denyShare: 0,
    smartCombat: false,
    smartProduction: false,
    smartDoctrine: false,
    // Точный выбор фишек перезарядки и скидка на толстый кошелёк — умения высокого уровня:
    // у среднего они сокращали отрыв высокого на карте для четверых (замер 2026-09-25).
    smartRecharge: false,
    reserveMarkers: false,
    previewCombat: false,
    buildScale: 1.5,
    richDiscount: false,
    pickets: true,
    holdAware: false,
    lossAversion: 1,
    assaultBias: 1,
    attackDoctrineBonus: 0,
    defenseDoctrineBonus: 0,
    denyEarly: 0,
    denyAtLimit: 0,
  },
  hard: {
    difficulty: 'hard',
    routineDefense: 0,
    // Пикеты на всех центрах, до которых долетает враг, в партиях ботов стоили темпа дороже
    // отбитых набегов (замер 2026-09-25); важные центры высокий держит через criticalDefense.
    raidDefense: 0,
    economy: 1,
    pacing: 0.35,
    rechargeAware: 1,
    reinvest: 0.6,
    compactness: 0.35,
    criticalDefense: 1,
    threatAware: true,
    denyShare: 1,
    smartCombat: true,
    smartProduction: true,
    smartDoctrine: true,
    smartRecharge: true,
    reserveMarkers: true,
    previewCombat: true,
    buildScale: 3,
    richDiscount: true,
    pickets: false,
    holdAware: true,
    lossAversion: 1,
    assaultBias: 1,
    attackDoctrineBonus: 4,
    defenseDoctrineBonus: 6,
    denyEarly: 0.5,
    denyAtLimit: 1,
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
  /**
   * Сколько центров у игрока может оказаться в начале следующего хода: `projected` плюс пустые
   * центры, до которых его корабли долетают в этот ход (в пределах лимита захвата).
   */
  potential: number
  cells: number
  ships: ShipAt[]
  strength: number
  claimLimit: number
  doctrine: DoctrineId
  largestRegion: number
  /** Своих клеток с фишками ресурсов. */
  tokenCells: number
}

/**
 * Экономика бота: чем он платит за корабли и сколько вернёт перезарядка. Бюджет перезарядки
 * падает на единицу с каждым центром власти, поэтому лишний центр до срока — это потерянные
 * фишки каждый следующий ход.
 */
export interface EconomyView {
  /** Бюджет перезарядки на этот ход. */
  budget: number
  /** Фишек лицом вниз — их поднимает перезарядка. */
  faceDown: number
  /** Средний номинал своих фишек (или 2, если фишек нет). */
  tokenValue: number
  /** Деньги лицом вверх в регионах, где можно строить (от трёх клеток). */
  usableWallet: number
  /** Деньги лицом вверх в мелких регионах: потратить их нельзя, пока регион не вырастет. */
  strandedWallet: number
}

/**
 * Соперник, который вот-вот победит. Высокий уровень, заметив его, бросает силы на помеху:
 * штурмует и осаждает его центры, оспаривает нейтральные центры у него на пути, снимает его
 * осады, в чужих боях поддерживает его противника, занимает клетки ему назло.
 */
export interface NearWinner {
  id: string
  /** 0…1: насколько срочно его останавливать. */
  urgency: number
  /** Словами — почему бот считает его близким к победе. */
  reason: string
  /** Пустые центры, до которых он долетает в этот ход. */
  reachablePowerCenters: Set<string>
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
  /** До центра долетает тот, кто вот-вот победит: потеря центра может отдать ему партию. */
  byNearWinner: boolean
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
  /** Соперник с наибольшим числом центров (с учётом захватов следующего хода). */
  leader: PlayerView | null
  /** Соперник, который вот-вот победит; `null` — такого нет, бот просто бежит к порогу. */
  nearWinner: NearWinner | null
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
  economy: EconomyView
  /** Сколько клеток бот займёт в конце хода, если корабли останутся на местах. */
  plannedClaims: { powerCenters: number; other: number; keys: Set<string> }
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
      potential: 0,
      cells: 0,
      ships: [],
      strength: 0,
      claimLimit: computeClaimLimit(game, id),
      doctrine: activeDoctrineId(game, id),
      largestRegion: regionsOf(board, id).largest?.size ?? 0,
      tokenCells: 0,
    })
  }
  for (const [key, cell] of board.cells) {
    const owner = cell.controlOwnerId ? views.get(cell.controlOwnerId) : undefined
    if (owner) {
      owner.cells += 1
      if (cell.isPowerCenter) owner.powerCenters += 1
      if (cell.resourceTokens.length > 0) owner.tokenCells += 1
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

/** Пустые центры (нейтральные и чужие), до которых игрок долетает в этот ход. */
function reachableEmptyPowerCenters(game: GameSnapshot, board: BoardIndex, view: PlayerView): Set<string> {
  const movable = rivalMovableCells(game, view.id)
  const out = new Set<string>()
  for (const ship of view.ships) {
    if (!movable(ship.key)) continue
    for (const key of reachForShip(board, ship.key, view.id, ship.type).keys()) {
      const cell = board.cells.get(key)
      if (!cell?.isPowerCenter || cell.controlOwnerId === view.id || cell.ships.length > 0) continue
      out.add(key)
    }
  }
  return out
}

/**
 * Кто из соперников вот-вот победит. Порог срабатывания — три ясных признака:
 *
 * 1. захваты следующего хода плюс пустые центры в пределах его полёта дают ему порог;
 * 2. у него уже на один центр меньше порога (или на два — тогда тревога слабее);
 * 3. последние ходы партии, и по лимиту ходов победил бы он.
 *
 * Если сам бот ближе к своей победе, помеха уступает добиванию.
 */
function findNearWinner(
  game: GameSnapshot,
  board: BoardIndex,
  me: PlayerView,
  rivals: readonly PlayerView[],
  threshold: number,
  turnsLeft: number,
  profile: BotProfile,
): NearWinner | null {
  let best: NearWinner | null = null
  const bestOthers = (except: string) => Math.max(0, ...[me, ...rivals].filter((view) => view.id !== except).map((view) => view.projected))
  for (const rival of rivals) {
    const reachable = reachableEmptyPowerCenters(game, board, rival)
    rival.potential = rival.projected + Math.min(reachable.size, Math.max(1, rival.claimLimit))
    let urgency = 0
    let reason = ''
    if (rival.potential >= threshold) {
      urgency = 1
      reason = `захватами следующего хода доберёт порог (${rival.potential} из ${threshold})`
    } else if (rival.projected >= threshold - 1) {
      urgency = 0.85
      reason = `до порога один центр (${rival.projected} из ${threshold})`
    } else if (rival.projected >= threshold - 2) {
      urgency = profile.denyEarly
      reason = `до порога два центра (${rival.projected} из ${threshold})`
    }
    // К концу партии побеждает больший счёт: ведущего по центрам тоже надо остановить.
    if (turnsLeft <= 2 && rival.projected > bestOthers(rival.id)) {
      const limitUrgency = (turnsLeft <= 1 ? 0.85 : 0.6) * profile.denyAtLimit
      if (limitUrgency > urgency) {
        urgency = limitUrgency
        reason = `ведёт по центрам к лимиту ходов (${rival.projected})`
      }
    }
    if (urgency <= 0) continue
    if (!best || urgency > best.urgency
      || (urgency === best.urgency && rival.potential > (rivals.find((view) => view.id === best!.id)?.potential ?? 0))) {
      best = { id: rival.id, urgency, reason, reachablePowerCenters: reachable }
    }
  }
  if (best) {
    // Сам ближе к победе — сначала добить своё, помеха вполсилы.
    me.potential = me.projected + Math.min(reachableEmptyPowerCenters(game, board, me).size, Math.max(1, me.claimLimit))
    const rival = rivals.find((view) => view.id === best!.id)!
    if (me.potential >= threshold && me.potential >= rival.potential) best.urgency *= 0.4
  }
  return best
}

function computeThreats(
  game: GameSnapshot,
  board: BoardIndex,
  me: PlayerView,
  rivals: readonly PlayerView[],
  nearWinner: NearWinner | null,
): Map<string, PowerCenterThreat> {
  const threats = new Map<string, PowerCenterThreat>()
  const movable = new Map(rivals.map((rival) => [rival.id, rivalMovableCells(game, rival.id)]))
  for (const [key, cell] of board.cells) {
    if (!cell.isPowerCenter || cell.controlOwnerId !== me.id) continue
    let now = 0
    let next = 0
    let attackerId: string | null = null
    let occupied = false
    let byNearWinner = false
    for (const rival of rivals) {
      const onCell = cell.ships.filter((ship) => ship.ownerId === rival.id).map((ship) => ship.type)
      if (onCell.length) occupied = true
      const reachNext = reachingStrength(board, rival, key, () => true) + combatStrength(onCell)
      const reachNow = reachingStrength(board, rival, key, movable.get(rival.id)!) + combatStrength(onCell)
      if (reachNow > now) {
        now = reachNow
        attackerId = rival.id
      }
      if (nearWinner?.id === rival.id && (reachNow > 0 || onCell.length > 0)) byNearWinner = true
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
      byNearWinner,
    })
  }
  return threats
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Сколько клеток бот займёт в конце хода, если корабли останутся там, где стоят. */
function countPlannedClaims(board: BoardIndex, playerId: string): { powerCenters: number; other: number; keys: Set<string> } {
  let powerCenters = 0
  let other = 0
  const keys = new Set<string>()
  for (const cell of board.cells.values()) {
    if (cell.controlOwnerId === playerId) continue
    if (!cell.ships.some((ship) => ship.ownerId === playerId)) continue
    if (cell.ships.some((ship) => ship.ownerId !== playerId)) continue
    keys.add(hexKey(cell.coord.q, cell.coord.r))
    if (cell.isPowerCenter) powerCenters += 1
    else other += 1
  }
  return { powerCenters, other, keys }
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
 * Оборона от этой угрозы важна для партии: потеря последнего центра — выбывание, центр в руках
 * того, кто вот-вот победит, может стать его победным, а свой центр перед собственной победой
 * держать надо до захватов следующего хода.
 */
export function isCriticalThreat(situation: Pick<BotSituation, 'me' | 'threshold'>, threat: PowerCenterThreat): boolean {
  return threat.last || threat.byNearWinner || situation.me.projected >= situation.threshold
}

/** Доля внимания к обороне этого центра: полная для важной обороны, иначе — обычная. */
export function defenseShareFor(
  situation: Pick<BotSituation, 'me' | 'threshold' | 'profile'>,
  threat: PowerCenterThreat,
): number {
  return isCriticalThreat(situation, threat) ? situation.profile.criticalDefense : situation.profile.routineDefense
}

/**
 * Веса режимов. Каждое слагаемое — отдельная причина, которую можно назвать словами:
 * «нейтральных центров ещё много», «флот вдвое сильнее соседа», «до победы один центр»,
 * «соперник доберёт порог захватами следующего хода».
 */
function computeModes(
  situation: Omit<BotSituation, 'modes' | 'mode'>,
): Record<BotMode, number> {
  const { me, threshold, turnsLeft, profile, nearWinner, fleetRatio, neutralPowerCenters, threats, turn } = situation
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

  // Оборона: враг у своих центров. Обычную оборону высокий уровень почти не держит — она съедает
  // темп; важную (последний центр, удар почти победителя) — держит в полную силу.
  let danger = 0
  for (const threat of threats.values()) {
    const pressure = threat.occupied ? 1 : clamp01(threat.now / Math.max(1, threat.garrison * 1.5 + 0.5))
    danger = Math.max(danger, pressure * defenseShareFor(situation, threat))
  }
  const defend = clamp01(danger)

  // Осада: центры соседей под гарнизоном, а перевеса для штурма нет — давим временем.
  const siege = clamp01(attack * 0.6 + (turnsLeft >= 3 ? 0.2 : 0))

  // Добивание: до порога один-два центра.
  const gap = threshold - me.projected
  const finish = gap <= 1 ? 1 : gap === 2 ? 0.55 : gap === 3 && turnsLeft <= 3 ? 0.35 : 0

  // Помеха: только если есть соперник, который вот-вот победит, и уровень на это способен.
  const deny = clamp01((nearWinner?.urgency ?? 0) * profile.denyShare)

  // Развитие: пока партия молода, а экономика слаба — регион мал для крейсеров, клеток с фишками
  // меньше, чем у соседей, деньги лежат в мелких регионах. К концу партии и перед своей победой
  // (или чужой, которую надо сорвать) развитие уступает центрам.
  const rivalTokenCells = situation.rivals.length
    ? situation.rivals.reduce((sum, rival) => sum + rival.tokenCells, 0) / situation.rivals.length
    : 0
  const weakness = (me.largestRegion < SHIP_PRODUCTION_REGION_MIN.cruiser ? 0.25 : 0)
    + (me.tokenCells < rivalTokenCells ? 0.15 : 0)
    + (situation.economy.strandedWallet >= 6 ? 0.1 : 0)
  const develop = clamp01(
    profile.economy
      * clamp01(0.75 - Math.max(0, turn - 1) * 0.06 + weakness)
      * (1 - finish * 0.8)
      * (1 - deny * 0.7),
  )

  return { expand, develop, attack, buildup, defend, siege, finish, deny }
}

function economyOf(game: GameSnapshot, board: BoardIndex, playerId: string, regions: readonly RegionInfo[]): EconomyView {
  let faceDown = 0
  let tokens = 0
  let total = 0
  for (const cell of board.cells.values()) {
    if (cell.controlOwnerId !== playerId) continue
    for (const token of cell.resourceTokens) {
      tokens += 1
      total += token.value
      if (token.faceUp === false) faceDown += 1
    }
  }
  let usableWallet = 0
  let strandedWallet = 0
  for (const region of regions) {
    const wallet = region.credits + region.production
    if (region.size >= SHIP_PRODUCTION_REGION_MIN.destroyer) usableWallet += wallet
    else strandedWallet += wallet
  }
  return {
    budget: computeRechargeBudget(game, playerId),
    faceDown,
    tokenValue: tokens > 0 ? total / tokens : 2,
    usableWallet,
    strandedWallet,
  }
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
    potential: 0,
    cells: 0,
    ships: [],
    strength: 0,
    claimLimit: 0,
    doctrine: 'none' as DoctrineId,
    largestRegion: 0,
    tokenCells: 0,
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
  for (const view of views.values()) view.potential = view.projected
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
  // Искать почти победителя имеет смысл только тому, кто станет ему мешать или от него защищаться.
  const nearWinner = profile.denyShare > 0 || profile.threatAware
    ? findNearWinner(game, board, me, rivals, threshold, turnsLeft, profile)
    : null
  const strongestRival = Math.max(0.5, ...rivals.map((rival) => rival.strength))
  const fleetRatio = me.strength / strongestRival

  const neutralPowerCenters: string[] = []
  for (const [key, cell] of board.cells) {
    if (cell.isPowerCenter && cell.controlOwnerId == null) neutralPowerCenters.push(key)
  }

  const threats = computeThreats(game, board, me, rivals, nearWinner)
  const regionsInfo = regionsOf(board, playerId)
  const economy = economyOf(game, board, playerId, regionsInfo.regions)

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
    nearWinner,
    fleetRatio,
    threats,
    neutralPowerCenters,
    capturesAhead,
    economy,
    plannedClaims: countPlannedClaims(board, playerId),
    regions: { largest: regionsInfo.largest, regionOf: regionsInfo.regionOf, list: regionsInfo.regions },
  }
  const modes = computeModes(base)
  return { ...base, modes, mode: dominantMode(modes) }
}

/** Базовая ценность одного центра власти в очках оценки; всё остальное меряется от неё. */
export const POWER_CENTER_VALUE = 100

/** Игрок — тот, кто вот-вот победит, и бот сейчас ему мешает. */
export function isDenyTarget(situation: BotSituation, playerId: string | null | undefined): boolean {
  return !!playerId && situation.nearWinner?.id === playerId && situation.modes.deny > 0
}

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
    // Центр, который почти победитель заберёт в начале следующего хода (его корабль стоит на
    // пустом центре или его осада падает), — самое срочное, что можно у него отнять.
    const snatch = isDenyTarget(situation, situation.capturesAhead.get(key))
      ? POWER_CENTER_VALUE * 1.2 * modes.deny
      : 0
    if (owner == null) {
      let value = POWER_CENTER_VALUE * (0.75 + modes.expand * 0.35 + modes.finish * 0.8)
      // Неоспариваемый центр подождёт, пока экономика встаёт на ноги: каждый центр режет бюджет
      // перезарядки на фишку за ход, а соперник его всё равно не успеет занять.
      const calm = isCalmPowerCenter(situation, key)
      if (calm) value = value * (1 - situation.profile.pacing * modes.develop) - rechargeLoss(situation)
      value += Math.max(snatch, denyContestBonus(situation, key))
      return value + tokenValue + economicValue(situation, key, tokenValue) * 0.5
    }
    const ownerView = situation.views.get(owner)
    let value = POWER_CENTER_VALUE * (0.8 + modes.attack * 0.3 + modes.finish * 0.8)
    // Чужой центр — двойной размен: у себя плюс один, у соперника минус один.
    value += POWER_CENTER_VALUE * 0.3
    // Центр того, кто вот-вот победит: взять его — значит отодвинуть его победу.
    if (isDenyTarget(situation, owner)) value += POWER_CENTER_VALUE * 1.2 * modes.deny
    value += snatch
    // Последний центр соперника: его взятие выбивает игрока из партии.
    if (ownerView && ownerView.powerCenters <= 1) value += POWER_CENTER_VALUE * 0.4
    return value + tokenValue
  }

  if (owner === playerId) return 0
  const regionBonus = touchesOwnRegion(situation, key) ? 4 : 0
  const economic = economicValue(situation, key, tokenValue)
  if (owner == null) {
    // Одиночная клетка вдали от своих — деньги с неё не потратить, пока вокруг не вырастет регион.
    const isolation = regionBonus > 0 || touchesPlannedClaim(situation, key) ? 1 : 1 - situation.profile.compactness * modes.develop
    return (6 + tokenValue * 2.2) * (0.5 + modes.expand * 0.6) * isolation + regionBonus + economic
  }
  // Чужая клетка без кораблей переходит сразу при входе: это набег на экономику соперника.
  const raid = 5 + tokenValue * 1.6 + (isDenyTarget(situation, owner) ? 8 * modes.deny : 0)
  return raid * (0.5 + modes.attack * 0.6) + regionBonus + economic * 0.7
}

/** Пороги региона, открывающие постройку: любые корабли, крейсер, авианосец, линкор. */
const REGION_STEPS: readonly (readonly [number, number])[] = [
  [SHIP_PRODUCTION_REGION_MIN.destroyer, 14],
  [SHIP_PRODUCTION_REGION_MIN.cruiser, 10],
  [SHIP_PRODUCTION_REGION_MIN.carrier, 12],
  [SHIP_PRODUCTION_REGION_MIN.battleship, 12],
]

/**
 * Экономическая ценность клетки в режиме развития: фишки, которые попадут в кошелёк, где их
 * можно потратить, рост региона до порога нового класса кораблей и сшивка своих регионов.
 */
export function economicValue(situation: BotSituation, key: string, tokenValue: number): number {
  const develop = situation.modes.develop
  if (develop <= 0) return 0
  const touching = new Set<number>()
  for (const next of situation.board.neighbors.get(key) ?? []) {
    const region = situation.regions.regionOf.get(next)
    if (region != null) touching.add(region)
  }
  let before = 0
  let merged = 1
  // Клетки, которые бот займёт в начале хода, войдут в тот же регион.
  for (const next of situation.board.neighbors.get(key) ?? []) {
    if (situation.plannedClaims.keys.has(next)) merged += 1
  }
  for (const id of touching) {
    const size = situation.regions.list[id]?.size ?? 0
    before = Math.max(before, size)
    merged += size
  }
  let value = 0
  for (const [size, bonus] of REGION_STEPS) if (before < size && merged >= size) value += bonus
  if (touching.size >= 2) value += 6
  // Фишки в регионе от трёх клеток сразу идут в дело; в одиночной клетке — только когда он вырастет.
  value += tokenValue * (merged >= SHIP_PRODUCTION_REGION_MIN.destroyer ? 2.4 : 1.2)
  return develop * value
}

/** Через сколько ходов ближайший корабль игрока долетит до клетки (без учёта препятствий). */
function turnsToReach(situation: BotSituation, view: PlayerView, dist: Map<string, number>): number {
  let best = Infinity
  for (const ship of view.ships) {
    const d = dist.get(ship.key)
    if (d == null) continue
    best = Math.min(best, Math.ceil(d / Math.max(1, effectiveMoveRange(situation.board.game, ship.type, view.id))))
  }
  return best
}

/**
 * Нейтральный центр, который можно взять позже: ни один соперник не долетит до него раньше,
 * чем через два хода после бота. Такой центр в режиме развития подождёт — экономика окрепнет,
 * а бюджет перезарядки пока останется выше. Оспариваемый центр берётся сразу.
 */
export function isCalmPowerCenter(situation: BotSituation, key: string): boolean {
  if (situation.modes.develop <= 0) return false
  const dist = distancesFrom(situation.board, key)
  const mine = turnsToReach(situation, situation.me, dist)
  if (!Number.isFinite(mine)) return false
  return situation.rivals.every((rival) => turnsToReach(situation, rival, dist) > mine + 2)
}

/**
 * Что бот теряет в экономике, взяв ещё один центр: фишку перезарядки за каждый оставшийся ход
 * (в пределах горизонта), если он тратит деньги и перезарядке есть что поднимать. Перед своей
 * победой не считается.
 */
export function rechargeLoss(situation: BotSituation): number {
  const { economy, profile, modes, turnsLeft } = situation
  if (profile.economy <= 0 || economy.budget <= 0 || modes.finish >= 0.99) return 0
  const spending = Math.min(1, economy.faceDown / Math.max(1, economy.budget))
  return profile.rechargeAware * profile.economy * spending * economy.tokenValue * Math.min(6, turnsLeft) * 0.6 * (1 - modes.finish)
}

function touchesPlannedClaim(situation: BotSituation, key: string): boolean {
  for (const next of situation.board.neighbors.get(key) ?? []) {
    if (situation.plannedClaims.keys.has(next)) return true
  }
  return false
}

function touchesOwnRegion(situation: BotSituation, key: string): boolean {
  for (const next of situation.board.neighbors.get(key) ?? []) {
    if (situation.board.cells.get(next)?.controlOwnerId === situation.playerId) return true
  }
  return false
}

/**
 * Нейтральный центр, до которого почти победитель долетает в этот ход (или стоит рядом):
 * свой корабль на нём превращает его захват в бой.
 */
function denyContestBonus(situation: BotSituation, key: string): number {
  const target = situation.nearWinner
  if (!target || situation.modes.deny <= 0) return 0
  if (target.reachablePowerCenters.has(key)) return POWER_CENTER_VALUE * 0.9 * situation.modes.deny
  const view = situation.views.get(target.id)
  if (!view) return 0
  const dist = distancesFrom(situation.board, key)
  let nearest = Infinity
  for (const ship of view.ships) nearest = Math.min(nearest, dist.get(ship.key) ?? Infinity)
  return nearest <= 4 ? POWER_CENTER_VALUE * 0.4 * situation.modes.deny : 0
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
  // Пустой центр, до которого враг долетает сейчас, уходит набегом без боя.
  const raid = threat.garrison <= 0 && threat.now > 0 ? situation.profile.raidDefense * 0.6 : 0
  return base * (1 + nearWin) * likelihood * Math.max(defenseShareFor(situation, threat), raid)
}
