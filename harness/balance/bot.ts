/**
 * Жадный бот для замеров баланса.
 *
 * Не претендует на сильную игру — он должен быть последовательным и никогда не вставать,
 * чтобы разница между прогонами объяснялась правилами, а не ботом.
 *
 * Обучающий `pickTutorialBotAction` для этого не годится: он берёт первое легальное действие
 * и не умеет ни строить, ни воевать. Транспорт сервера тоже не нужен — бот гоняет снимок
 * партии напрямую через `applyGameActionOnSnapshot`.
 *
 * Важно: боевые решения движок маршрутизирует вне очереди хода, поэтому бот обязан отвечать
 * за всех участников боя, а не только за активного игрока. Цикл, ведущий только
 * `activePlayerId`, встанет на `pendingCombat.phase === 'prep'`.
 */

import {
  actionMarkerLimitForPlayer,
  applyGameActionOnSnapshot,
  beginMatchForParticipants,
  buildCombatPreviewFromPending,
  canPlaceActionMarkerOnCell,
  combatPrepOf,
  combatSupportersAwaited,
  countControlledPowerCenters,
  gameSnapshotFromMap,
  getBuildableShipsForMarker,
  getCombatRetreatDestinations,
  getMovableShipsAtMarker,
  getShipProductionCost,
  claimPicksRemaining,
  computeClaimLimit,
  getShipProductionRegionMin,
  hexKey,
  hitProbability,
  rechargePicksRemaining,
  siegeLossesOwedBy,
  besiegedCellKeysOf,
  doctrineChoiceOwed,
  type DoctrineId,
  SHIP_DICE,
  SHIP_HIT_THRESHOLD,
  SHIP_HULL,
  SHIP_PRODUCTION_COST,
  resolveCombatPrep,
} from '../../packages/rules/src/index.js'
import type {
  CombatPreview,
  GameSnapshot,
  HexCoord,
  MapDefinition,
  RuntimeCellState,
  ShipMovePlan,
  ShipType,
  ShipUnit,
} from '../../packages/rules/src/index.js'
import type { BattleRecord, GameRecord, PlayerSample, TurnSample } from './metrics.js'
import { withSeededRandom } from './rng.js'

export interface RunOptions {
  /**
   * Страховочный потолок ходов на стороне харнесса. Сам лимит партии теперь живёт в
   * правилах (`GameSnapshot.turnLimit`), поэтому здесь он только ловит разгон.
   */
  maxTurns: number
  /** Лимит ходов партии; `null` — без лимита. По умолчанию берётся из правил. */
  turnLimit: number | null | undefined
  /** false — партия без доктрин, для сравнения с фазой 5. */
  doctrines?: boolean
  /** Все боты берут одну доктрину — чтобы замерить её в чистом виде. */
  forcedDoctrine?: DoctrineId | null
  /**
   * Замер силы доктрины: одному игроку (место меняется от партии к партии) — эта доктрина
   * во всех окнах, остальным — как обычно (`forcedDoctrine` или выбор бота).
   */
  deviantDoctrine?: DoctrineId | null
  /** Длина окна доктрин в ходах; не задано — из правил. */
  doctrineWindow?: number
  /** Подмена порога победы для подбора: карта своего порога может не задавать. */
  victoryPowerCenters: number | null
  /** Аварийный предохранитель: партия не должна крутиться бесконечно. */
  maxSteps: number
  /** Сколько раундов бот готов драться, прежде чем выйти из боя. */
  maxCombatRounds: number
  /**
   * Фора первому игроку: сколько лишних нейтральных клеток отдать ему до старта.
   *
   * Зеркальный бот на симметричной карте снежный ком показать не может — оба играют
   * одинаково, и расхождение возникает только из костей. Поэтому разгон замеряется
   * иначе: выдаём фору и смотрим, растёт она или тает.
   */
  handicapCells: number
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxTurns: 60,
  turnLimit: undefined,
  victoryPowerCenters: null,
  maxSteps: 250_000,
  maxCombatRounds: 12,
  handicapCells: 0,
}

type ActionSink = typeof applyGameActionOnSnapshot

let actionSink: ActionSink = applyGameActionOnSnapshot

/**
 * Живой прогон против сервера (`harness/scripts/play-bots.ts`) подменяет исполнение действий:
 * бот решает на копии состояния, а действие уходит на сервер.
 */
export function setActionSink(sink: ActionSink | null): void {
  actionSink = sink ?? applyGameActionOnSnapshot
}

const act: ActionSink = (...args) => actionSink(...args)

function parseKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q: q ?? 0, r: r ?? 0 }
}

function indexCells(game: GameSnapshot): Map<string, RuntimeCellState> {
  const index = new Map<string, RuntimeCellState>()
  for (const cell of game.cells) index.set(hexKey(cell.coord.q, cell.coord.r), cell)
  return index
}

function faceUpValueFor(game: GameSnapshot, playerId: string): number {
  let total = 0
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== playerId) continue
    for (const token of cell.resourceTokens) {
      if (token.faceUp !== false) total += token.value
    }
  }
  return total
}

const NEIGHBOUR_OFFSETS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const

/**
 * Размер наибольшего связного региона игрока — именно он открывает классы кораблей
 * (`SHIP_PRODUCTION_REGION_MIN`). Считаем сами, чтобы не строить полный spatial summary.
 */
function largestRegionSize(game: GameSnapshot, playerId: string): number {
  const own = new Set<string>()
  for (const cell of game.cells) {
    if (cell.controlOwnerId === playerId) own.add(hexKey(cell.coord.q, cell.coord.r))
  }
  const seen = new Set<string>()
  let largest = 0
  for (const start of own) {
    if (seen.has(start)) continue
    let size = 0
    const stack = [start]
    while (stack.length) {
      const key = stack.pop()!
      if (seen.has(key) || !own.has(key)) continue
      seen.add(key)
      size += 1
      const { q, r } = parseKey(key)
      for (const [dq, dr] of NEIGHBOUR_OFFSETS) stack.push(hexKey(q + dq, r + dr))
    }
    if (size > largest) largest = size
  }
  return largest
}

/**
 * Отдаёт игроку N ближайших нейтральных клеток — стартовая фора для замера разгона.
 * Обход в ширину от уже контролируемых клеток, чтобы фора была связной.
 */
function applyHandicap(game: GameSnapshot, playerId: string, cells: number): void {
  if (cells <= 0) return
  const index = indexCells(game)
  const frontier: string[] = []
  const seen = new Set<string>()
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== playerId) continue
    const key = hexKey(cell.coord.q, cell.coord.r)
    seen.add(key)
    frontier.push(key)
  }

  let granted = 0
  while (frontier.length && granted < cells) {
    const key = frontier.shift()!
    const { q, r } = parseKey(key)
    for (const [dq, dr] of NEIGHBOUR_OFFSETS) {
      if (granted >= cells) break
      const nextKey = hexKey(q + dq, r + dr)
      if (seen.has(nextKey)) continue
      seen.add(nextKey)
      const cell = index.get(nextKey)
      if (!cell) continue
      frontier.push(nextKey)
      if (cell.controlOwnerId != null) continue
      cell.controlOwnerId = playerId
      granted += 1
    }
  }
}

function controlledCells(game: GameSnapshot, playerId: string): number {
  return game.cells.filter((cell) => cell.controlOwnerId === playerId).length
}

function shipCount(game: GameSnapshot, playerId: string): number {
  return game.cells.reduce(
    (sum, cell) => sum + cell.ships.filter((ship) => ship.ownerId === playerId).length,
    0,
  )
}

function enemyShipsOn(cell: RuntimeCellState, playerId: string): ShipUnit[] {
  return cell.ships.filter((ship) => ship.ownerId !== playerId)
}

/**
 * Выбор доктрины. Правила — дуга из плана: рано расширяться, поздно держаться. Центр в осаде —
 * «Оборона» (перебросы гарнизона и −1 к вражеским попаданиям); флот сильнее вражеского и
 * центров мало — «Атака»; четыре центра и больше — «Оборона», пока не сорвали; иначе
 * «Экспансия». Ничьи между равноценными — случайно, как везде у бота.
 */
function pickDoctrine(game: GameSnapshot, playerId: string): DoctrineId {
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

/**
 * Боевая сила группы: ожидаемые попадания за раунд, умноженные на суммарную прочность.
 * Грубая оценка по Ланчестеру — сколько группа успеет нанести, прежде чем её выбьют.
 * Бонус авианосца и поддержку не учитывает: бот осторожнее, чем мог бы быть.
 */
function combatStrength(types: readonly ShipType[]): number {
  let hits = 0
  let hull = 0
  for (const type of types) {
    hits += (SHIP_DICE[type] ?? 0) * hitProbability(SHIP_HIT_THRESHOLD[type] ?? null)
    hull += SHIP_HULL[type] ?? 1
  }
  return hits * hull
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
function pickAmongBest<T>(items: readonly T[], score: (item: T) => number): T | null {
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

function tryPlaceMarker(game: GameSnapshot, map: MapDefinition, playerId: string): boolean {
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

interface SpendTally {
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

function stepActions(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  tally: SpendTally,
  attempts: MarkerAttempts,
): boolean {
  if (game.actionMarkerResolvedThisTurn) return false
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
function stepCombat(
  game: GameSnapshot,
  map: MapDefinition,
  options: RunOptions,
  record?: GameRecord,
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
    if (prep.siegeAvailable && preview && !overwhelms(preview)) {
      // Штурм без подавляющего перевеса стоит флота; осада берёт центр бесплатно, но дольше.
      const siege = act(game, map, attackerId, 'establish-siege')
      if (!siege.errors.length) {
        if (record) record.sieges.established += 1
        return true
      }
    }
    if (prep.siegeResponse && preview && !sideHoldsOut(preview, 'attacker')) {
      const decline = act(game, map, attackerId, 'cancel-combat-prep')
      return decline.errors.length === 0
    }
    const ready = act(game, map, attackerId, 'update-combat-prep', {
      ready: true,
    })
    if (ready.errors.length) return false
    if (pending.trigger !== 'bombardment' && prep.defenderId) {
      act(game, map, prep.defenderId, 'update-combat-prep', { ready: true })
      // Третьи игроки: без их ответа бой не начнётся.
      for (const candidate of preview?.supportCandidates ?? []) {
        if (prep.readyBy[candidate.playerId]) continue
        act(game, map, candidate.playerId, 'update-combat-prep', {
          ready: true,
          // Гарнизон встаёт против своего осаждающего; прочие — против лидера.
          supportSide: candidate.garrisonShipIds?.length
            ? 'attacker'
            : supportSideFor(game, candidate.playerId, attackerId, prep.defenderId),
        })
      }
    }
    return true
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
      const supporter = combatSupportersAwaited(game, buildCombatPreviewFromPending(game))
        .find((playerId) => !pending.supportReady?.[playerId])
      if (!supporter) return false
      return act(game, map, supporter, 'continue-combat').errors.length === 0
    }
    const side = decided.attacker === undefined ? 'attacker' : 'defender'
    const playerId = side === 'attacker' ? attackerId : defenderId
    if (!playerId) return false

    const retreats = getCombatRetreatDestinations(game, playerId)
    const preview = buildCombatPreviewFromPending(game)
    const keepFighting =
      pending.roundNumber < options.maxCombatRounds
      && (!preview || !retreats.length || sideHoldsOut(preview, side))
    if (keepFighting) {
      const { errors } = act(game, map, playerId, 'continue-combat')
      return errors.length === 0
    }

    const retreatTo = retreats[0]
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
function supportSideFor(
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
 * Один шаг ботов на живой партии: бой, выбор доктрин, долги планирования, маркеры, действия.
 * Ходит только за `botIds`; ход человека не трогает.
 */
export function botStepLive(
  game: GameSnapshot,
  map: MapDefinition,
  botIds: ReadonlySet<string>,
  attempts: MarkerAttempts,
): void {
  if (game.gameOver) return
  if (game.siegeContinuationChoice) {
    const { playerId } = game.siegeContinuationChoice
    if (botIds.has(playerId)) act(game, map, playerId, 'resolve-siege-continuation', { continue: true })
    return
  }
  if (game.pendingCombat) {
    stepCombat(game, map, DEFAULT_RUN_OPTIONS)
    return
  }
  if (game.phase === 'planning' && game.doctrineChoice) {
    for (const playerId of botIds) {
      if (doctrineChoiceOwed(game, playerId)) {
        act(game, map, playerId, 'choose-doctrine', { doctrineId: pickDoctrine(game, playerId) })
      }
    }
  }
  const active = game.activePlayerId
  if (!active || !botIds.has(active)) return
  let progressed = false
  if (game.phase === 'planning' && siegeLossesOwedBy(game, active).length > 0) {
    progressed = act(game, map, active, 'execute-siege-losses').errors.length === 0
  }
  if (!progressed && game.phase === 'planning' && claimPicksRemaining(game, active) > 0) {
    progressed = act(game, map, active, 'execute-claim-picks').errors.length === 0
  }
  if (!progressed && game.phase === 'planning' && rechargePicksRemaining(game, active) > 0) {
    progressed = act(game, map, active, 'execute-recharge-picks').errors.length === 0
  }
  const tally: SpendTally = { tokenFaceValue: 0, shipCost: 0 }
  if (!progressed && game.phase === 'planning') progressed = tryPlaceMarker(game, map, active)
  else if (!progressed && game.phase === 'actions') progressed = stepActions(game, map, active, tally, attempts)
  if (!progressed && !game.pendingCombat) act(game, map, active, 'advance-phase')
}

function sampleTurn(
  game: GameSnapshot,
  playerIds: readonly string[],
  turn: number,
  previousCells: Record<string, number>,
): TurnSample {
  const byPlayer: Record<string, PlayerSample> = {}
  for (const playerId of playerIds) {
    const powerCenters = countControlledPowerCenters(game, playerId)
    const cells = controlledCells(game, playerId)
    byPlayer[playerId] = {
      powerCenters,
      cells,
      ships: shipCount(game, playerId),
      faceUpValue: faceUpValueFor(game, playerId),
      claimLimit: computeClaimLimit(game, playerId),
      claimsMade: Math.max(0, cells - (previousCells[playerId] ?? cells)),
    }
  }
  return { turn, byPlayer }
}

interface BattleWatch {
  trigger: BattleRecord['trigger']
  cellKey: string
  attackerId: string
  defenderId: string
  attackerShips: Map<string, ShipType>
  defenderShips: Map<string, ShipType>
  /** Корабли, вступившие в бой: атакующие из приказа, защитники с клетки боя. */
  incomingIds: string[]
  defenderCellIds: string[]
}

function shipsOf(game: GameSnapshot, playerId: string): Map<string, ShipType> {
  const out = new Map<string, ShipType>()
  for (const cell of game.cells) {
    for (const ship of cell.ships) if (ship.ownerId === playerId) out.set(ship.id, ship.type)
  }
  return out
}

function watchBattle(game: GameSnapshot): BattleWatch {
  const pending = game.pendingCombat!
  const defenderId = pending.defenderIds[0] ?? combatPrepOf(pending)?.defenderId ?? ''
  return {
    trigger: pending.trigger ?? 'movement',
    cellKey: pending.cellKey,
    attackerId: pending.attackerId,
    defenderId,
    attackerShips: shipsOf(game, pending.attackerId),
    defenderShips: shipsOf(game, defenderId),
    incomingIds: [
      ...(combatPrepOf(pending)?.incomingAttackerShipIds ?? pending.continuation?.incomingAttackerShipIds ?? []),
    ],
    defenderCellIds: (indexCells(game).get(pending.cellKey)?.ships ?? [])
      .filter((ship) => ship.ownerId === defenderId)
      .map((ship) => ship.id),
  }
}

/** Итог боя по доске: потери — корабли, которых больше нет; исход — кто остался на клетке. */
function finishBattle(game: GameSnapshot, watch: BattleWatch): BattleRecord {
  const lost = (before: Map<string, ShipType>, after: Map<string, ShipType>) => {
    let count = 0
    let value = 0
    for (const [id, type] of before) {
      if (after.has(id)) continue
      count += 1
      const cost = SHIP_PRODUCTION_COST[type]
      value += cost.credits + cost.production
    }
    return { count, value }
  }
  const attackerAfter = shipsOf(game, watch.attackerId)
  const defenderAfter = shipsOf(game, watch.defenderId)
  const attackerLoss = lost(watch.attackerShips, attackerAfter)
  const defenderLoss = lost(watch.defenderShips, defenderAfter)

  const cell = indexCells(game).get(watch.cellKey)
  const attackerOnCell = cell?.ships.some((ship) => ship.ownerId === watch.attackerId) ?? false
  const defenderOnCell = cell?.ships.some((ship) => ship.ownerId === watch.defenderId) ?? false
  const incomingAlive = watch.incomingIds.some((id) => attackerAfter.has(id))
  const defendersAlive = watch.defenderCellIds.some((id) => defenderAfter.has(id))
  let outcome: BattleRecord['outcome'] = 'none'
  if (watch.trigger === 'bombardment') {
    outcome = defenderOnCell ? 'none' : 'attacker'
  } else if (!incomingAlive && !defendersAlive) {
    outcome = 'mutual'
  } else if (attackerOnCell && !defenderOnCell) {
    outcome = defendersAlive ? 'retreat' : 'attacker'
  } else if (defenderOnCell && !attackerOnCell) {
    outcome = incomingAlive ? (attackerLoss.count + defenderLoss.count > 0 ? 'retreat' : 'none') : 'defender'
  }

  return {
    trigger: watch.trigger,
    outcome,
    attackerLosses: attackerLoss.count,
    defenderLosses: defenderLoss.count,
    attackerLossValue: attackerLoss.value,
    defenderLossValue: defenderLoss.value,
  }
}

export function runGame(map: MapDefinition, seed: number, options: RunOptions): GameRecord {
  return withSeededRandom(seed, () => {
    const game = gameSnapshotFromMap(map)
    const playerIds = game.players
      .filter((player) =>
        game.cells.some(
          (cell) =>
            cell.controlOwnerId === player.id
            || cell.ships.some((ship) => ship.ownerId === player.id),
        ),
      )
      .map((player) => player.id)

    const record: GameRecord = {
      seed,
      mapId: map.id,
      playerIds,
      winnerId: null,
      reason: null,
      turns: 0,
      hitTurnCap: false,
      meanOrderPosition: {},
      samples: [],
      tokenFaceValueSpent: 0,
      shipCostPaid: 0,
      firstUnlockTurn: {},
      eliminationTurns: [],
      battles: [],
      sieges: { established: 0, captured: 0, lifted: 0 },
      doctrines: {},
    }

    if (playerIds.length < 2) {
      record.error = `Карта ${map.id}: меньше двух игроков со стартовой позицией`
      return record
    }

    if (options.deviantDoctrine) {
      record.deviantPlayerId = playerIds[Math.abs(seed) % playerIds.length]!
    }

    if (options.handicapCells > 0) {
      record.handicappedPlayerId = playerIds[0]!
      applyHandicap(game, playerIds[0]!, options.handicapCells)
    }
    if (options.victoryPowerCenters != null) {
      game.victoryPowerCenters = options.victoryPowerCenters
    }

    beginMatchForParticipants(game, map.id, playerIds, {
      turnLimit: options.turnLimit,
      ...(options.doctrines === false
        ? { doctrineWindow: null }
        : options.doctrineWindow != null
          ? { doctrineWindow: options.doctrineWindow }
          : {}),
    })

    const tally: SpendTally = { tokenFaceValue: 0, shipCost: 0 }
    const orderSeen: Record<string, number[]> = Object.fromEntries(
      playerIds.map((id) => [id, [] as number[]]),
    )
    const eliminated = new Set<string>()
    let previousCells: Record<string, number> = Object.fromEntries(
      playerIds.map((id) => [id, controlledCells(game, id)]),
    )
    let currentTurn = game.turnNumber
    let orderIndex = 0
    let steps = options.maxSteps
    let combatGuard = 0
    let battle: BattleWatch | null = null
    // Кольцевой журнал последних шагов: без него зацикливание видно только как
    // «исчерпан лимит шагов», и непонятно, где именно бот встал.
    const attempts: MarkerAttempts = new Map()
    const trail: string[] = []
    const note = (text: string) => {
      trail.push(text)
      if (trail.length > 24) trail.shift()
    }

    const closeTurn = () => {
      const sample = sampleTurn(game, playerIds, currentTurn, previousCells)
      record.samples.push(sample)
      // Класс считается открытым, когда наибольший регион дорос до порога,
      // независимо от того, хватает ли на корабль денег.
      for (const playerId of playerIds) {
        const region = largestRegionSize(game, playerId)
        for (const type of Object.keys(SHIP_PRODUCTION_COST) as ShipType[]) {
          if (record.firstUnlockTurn[type] != null) continue
          if (region >= getShipProductionRegionMin(type)) {
            record.firstUnlockTurn[type] = currentTurn
          }
        }
      }
      previousCells = Object.fromEntries(
        playerIds.map((id) => [id, sample.byPlayer[id]?.cells ?? 0]),
      )
      for (const playerId of playerIds) {
        const player = game.players.find((p) => p.id === playerId)
        if (player?.eliminated && !eliminated.has(playerId)) {
          eliminated.add(playerId)
          record.eliminationTurns.push({ playerId, turn: currentTurn })
        }
      }
      currentTurn = game.turnNumber
      orderIndex = 0
    }

    let knownSieges: Record<string, { besiegerId: string }> = {}
    const watchSieges = () => {
      const now = game.sieges ?? {}
      for (const [key, siege] of Object.entries(knownSieges)) {
        if (now[key]) continue
        const cell = indexCells(game).get(key)
        if (cell?.controlOwnerId === siege.besiegerId) record.sieges.captured += 1
        else record.sieges.lifted += 1
      }
      knownSieges = Object.fromEntries(Object.entries(now).map(([key, siege]) => [key, { besiegerId: siege.besiegerId }]))
    }

    while (steps-- > 0) {
      watchSieges()
      if (game.gameOver) break
      if (game.turnNumber > options.maxTurns) {
        record.hitTurnCap = true
        break
      }

      if (game.pendingCombat) {
        battle ??= watchBattle(game)
        combatGuard += 1
        const progressed = stepCombat(game, map, options, record)
        if (!progressed || combatGuard > 200) {
          const attackerId = game.pendingCombat?.attackerId
          if (attackerId) act(game, map, attackerId, 'abort-combat')
          if (game.pendingCombat) {
            record.error = 'Бой не удалось разрешить'
            break
          }
        }
        if (!game.pendingCombat && battle) {
          record.battles.push(finishBattle(game, battle))
          battle = null
        }
        continue
      }
      combatGuard = 0

      if (game.siegeContinuationChoice) {
        // Победитель боя за осаждённый центр осаду продолжает.
        act(game, map, game.siegeContinuationChoice.playerId, 'resolve-siege-continuation', { continue: true })
        continue
      }

      if (game.turnNumber !== currentTurn) closeTurn()

      const active = game.activePlayerId
      if (!active) break

      const seen = orderSeen[active]
      if (seen && seen.length <= record.samples.length) {
        seen.push(orderIndex)
        orderIndex += 1
      }

      if (game.phase === 'planning' && game.doctrineChoice) {
        for (const playerId of playerIds) {
          if (!doctrineChoiceOwed(game, playerId)) continue
          const doctrineId = playerId === record.deviantPlayerId && options.deviantDoctrine
            ? options.deviantDoctrine
            : options.forcedDoctrine ?? pickDoctrine(game, playerId)
          const window = String(game.doctrineChoice?.windowStart ?? game.turnNumber)
          if (!act(game, map, playerId, 'choose-doctrine', { doctrineId }).errors.length) {
            record.doctrines[window] ??= {}
            record.doctrines[window]![doctrineId] = (record.doctrines[window]![doctrineId] ?? 0) + 1
          }
        }
      }

      let progressed = false
      if (game.phase === 'planning' && siegeLossesOwedBy(game, active).length > 0) {
        progressed = act(
          game, map, active, 'execute-siege-losses',
        ).errors.length === 0
      }
      if (!progressed && game.phase === 'planning' && claimPicksRemaining(game, active) > 0) {
        progressed = act(
          game, map, active, 'execute-claim-picks',
        ).errors.length === 0
      }
      if (!progressed && game.phase === 'planning' && rechargePicksRemaining(game, active) > 0) {
        progressed = act(
          game, map, active, 'execute-recharge-picks',
        ).errors.length === 0
      }
      if (!progressed && game.phase === 'planning') progressed = tryPlaceMarker(game, map, active)
      else if (game.phase === 'actions') progressed = stepActions(game, map, active, tally, attempts)

      note(
        `t${game.turnNumber} ${game.phase} ${active} `
          + `m=${game.actionMarkers.filter((m) => m.ownerId === active).length} `
          + `res=${game.actionMarkerResolvedThisTurn ? 1 : 0} prog=${progressed ? 1 : 0}`,
      )

      if (progressed) continue
      // Бой мог подняться прямо сейчас — передавать фазу поверх него нельзя.
      if (game.pendingCombat) continue

      const { errors } = act(game, map, active, 'advance-phase')
      if (errors.length) {
        record.error = `Фаза не продвигается: ${errors[0]}`
        break
      }
    }

    if (steps <= 0 && !record.error) {
      record.error = `Исчерпан лимит шагов | ${trail.join(' ; ')}`
    }

    closeTurn()
    record.turns = Math.max(1, record.samples.at(-1)?.turn ?? game.turnNumber)
    record.winnerId = game.gameOver?.winnerId ?? null
    record.reason = game.gameOver?.reason ?? null
    record.tokenFaceValueSpent = tally.tokenFaceValue
    record.shipCostPaid = tally.shipCost
    record.meanOrderPosition = Object.fromEntries(
      playerIds.map((id) => {
        const seen = orderSeen[id] ?? []
        const value = seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : 0
        return [id, value]
      }),
    )
    return record
  })
}
