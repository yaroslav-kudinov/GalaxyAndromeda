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
  buildDestructionSelectionState,
  canPlaceActionMarkerOnCell,
  combatPrepOf,
  combatRoundStateOf,
  countControlledPowerCenters,
  gameSnapshotFromMap,
  getBuildableShipsForMarker,
  getCombatRetreatDestinations,
  getMovableShipsAtMarker,
  getShipProductionCost,
  getShipProductionRegionMin,
  hexKey,
  SHIP_PRODUCTION_COST,
  resolveCombatPrep,
} from '../../packages/rules/src/index.js'
import type {
  GameSnapshot,
  HexCoord,
  MapDefinition,
  RuntimeCellState,
  ShipMovePlan,
  ShipType,
  ShipUnit,
} from '../../packages/rules/src/index.js'
import type { GameRecord, PlayerSample, TurnSample } from './metrics.js'
import { withSeededRandom } from './rng.js'

export interface RunOptions {
  /**
   * Страховочный потолок ходов на стороне харнесса. Сам лимит партии теперь живёт в
   * правилах (`GameSnapshot.turnLimit`), поэтому здесь он только ловит разгон.
   */
  maxTurns: number
  /** Лимит ходов партии; `null` — без лимита. По умолчанию берётся из правил. */
  turnLimit: number | null | undefined
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
  maxCombatRounds: 3,
  handicapCells: 0,
}

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
 * Ценность клетки как цели хода. Центры власти — валюта победы, поэтому они дороже всего;
 * дальше идут нейтральные клетки с фишками, потом просто нейтральные.
 */
function targetScore(
  cell: RuntimeCellState | undefined,
  playerId: string,
  ownStackSize: number,
): number {
  if (!cell) return -1
  const enemies = enemyShipsOn(cell, playerId)
  const defended = enemies.length > 0
  const canWin = ownStackSize > enemies.length

  if (cell.isPowerCenter) {
    if (cell.controlOwnerId === playerId) return defended && canWin ? 60 : 5
    if (!defended) return cell.controlOwnerId == null ? 120 : 110
    return canWin ? 90 : -1
  }

  if (defended && !canWin) return -1

  const tokenValue = cell.resourceTokens.reduce((sum, token) => sum + token.value, 0)
  if (cell.controlOwnerId == null) return (tokenValue > 0 ? 40 + tokenValue : 20) + (defended ? 5 : 0)
  if (cell.controlOwnerId !== playerId) return defended ? 25 : 30
  return 1
}

function tryPlaceMarker(game: GameSnapshot, map: MapDefinition, playerId: string): boolean {
  const limit = actionMarkerLimitForPlayer(game, playerId)
  const owned = game.actionMarkers.filter((marker) => marker.ownerId === playerId).length
  if (owned >= limit) return false

  let best: { cell: RuntimeCellState; score: number } | null = null
  for (const cell of game.cells) {
    if (cell.actionMarkerId) continue
    if (!canPlaceActionMarkerOnCell(cell, playerId)) continue
    // Клетки с кораблями полезнее: маркер на них двигает флот, а не только держит центр.
    const own = cell.ships.filter((ship) => ship.ownerId === playerId).length
    const score = own * 10 + (cell.isPowerCenter ? 3 : 0)
    if (!best || score > best.score) best = { cell, score }
  }
  if (!best) return false

  const { errors } = applyGameActionOnSnapshot(game, map, playerId, 'toggle-marker', {
    coord: best.cell.coord,
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
  const { errors } = applyGameActionOnSnapshot(game, map, playerId, 'execute-production', {
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
  const ownStackSize = movable.length
  const originKey = hexKey(markerCoord.q, markerCoord.r)
  const taken = new Set<string>([originKey])
  const moves: ShipMovePlan[] = []

  for (const option of movable) {
    const reachable = [...option.reachableKeys, ...option.combatReachableKeys]
    let bestKey: string | null = null
    let bestScore = 0
    for (const key of reachable) {
      if (taken.has(key)) continue
      const score = targetScore(cells.get(key), playerId, ownStackSize)
      if (score > bestScore) {
        bestScore = score
        bestKey = key
      }
    }
    if (!bestKey) continue
    taken.add(bestKey)
    moves.push({ shipId: option.ship.id, to: parseKey(bestKey) })
  }
  if (moves.length === 0) return false

  const { errors } = applyGameActionOnSnapshot(game, map, playerId, 'execute-marker-movement', {
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
  const { errors } = applyGameActionOnSnapshot(game, map, playerId, 'toggle-marker', {
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

/** Корабли на уничтожение: фронт приоритета, помещающийся в остаток урона. */
function pickDestruction(game: GameSnapshot): string[] {
  const pending = game.pendingCombat
  const round = combatRoundStateOf(pending)
  if (!pending || !round) return []

  const cells = indexCells(game)
  const battleCell = cells.get(pending.cellKey)
  const loserShips = round.attackerWon
    ? (battleCell?.ships ?? []).filter((ship) => ship.ownerId === round.defenderId)
    : round.incomingAttackerShipIds
        .map((id) => game.cells.flatMap((cell) => cell.ships).find((ship) => ship.id === id))
        .filter((ship): ship is ShipUnit => !!ship)

  const skipTypes = new Set<ShipType>(
    (round.attackerWon ? round.defenderSkipTypes : round.attackerSkipTypes) ?? [],
  )
  const state = buildDestructionSelectionState(game, loserShips, round.remainingDamage, skipTypes)
  return state.immediatelyDestroyableIds.slice(0, 1)
}

/**
 * Один шаг боевого конечного автомата. Возвращает false, если продвинуться не удалось —
 * тогда вызывающий аварийно снимает бой, чтобы партия не зависла.
 */
function stepCombat(game: GameSnapshot, map: MapDefinition, options: RunOptions): boolean {
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
    const ready = applyGameActionOnSnapshot(game, map, attackerId, 'update-combat-prep', {
      ready: true,
    })
    if (ready.errors.length) return false
    if (pending.trigger !== 'bombardment' && prep.defenderId) {
      applyGameActionOnSnapshot(game, map, prep.defenderId, 'update-combat-prep', { ready: true })
    }
    return true
  }

  if (pending.phase === 'awaiting-destruction') {
    const round = combatRoundStateOf(pending)
    if (!round) return false
    const { errors } = applyGameActionOnSnapshot(
      game,
      map,
      round.winnerId,
      'confirm-combat-destruction',
      { destructionSelection: pickDestruction(game) },
    )
    return errors.length === 0
  }

  if (pending.phase === 'awaiting-continue') {
    const attackerId = pending.attackerId
    const defenderId = pending.defenderIds[0]
    const decided = pending.continueDecisions ?? {}
    const side = decided.attacker === undefined ? 'attacker' : 'defender'
    const playerId = side === 'attacker' ? attackerId : defenderId
    if (!playerId) return false

    if (pending.roundNumber < options.maxCombatRounds) {
      const { errors } = applyGameActionOnSnapshot(game, map, playerId, 'continue-combat')
      return errors.length === 0
    }

    const retreats = getCombatRetreatDestinations(game, playerId)
    const retreatTo = retreats[0]
    const { errors } = applyGameActionOnSnapshot(
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
      // Будущая формула лимита захвата (фаза 3). На базовом замере показывает,
      // насколько рост территории уже сейчас упёрся бы в этот потолок.
      claimLimit: 1 + powerCenters,
      claimsMade: Math.max(0, cells - (previousCells[playerId] ?? cells)),
    }
  }
  return { turn, byPlayer }
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
    }

    if (playerIds.length < 2) {
      record.error = `Карта ${map.id}: меньше двух игроков со стартовой позицией`
      return record
    }

    if (options.handicapCells > 0) {
      record.handicappedPlayerId = playerIds[0]!
      applyHandicap(game, playerIds[0]!, options.handicapCells)
    }
    if (options.victoryPowerCenters != null) {
      game.victoryPowerCenters = options.victoryPowerCenters
    }

    beginMatchForParticipants(game, map.id, playerIds, { turnLimit: options.turnLimit })

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

    while (steps-- > 0) {
      if (game.gameOver) break
      if (game.turnNumber > options.maxTurns) {
        record.hitTurnCap = true
        break
      }

      if (game.pendingCombat) {
        combatGuard += 1
        const progressed = stepCombat(game, map, options)
        if (!progressed || combatGuard > 200) {
          const attackerId = game.pendingCombat?.attackerId
          if (attackerId) applyGameActionOnSnapshot(game, map, attackerId, 'abort-combat')
          if (game.pendingCombat) {
            record.error = 'Бой не удалось разрешить'
            break
          }
        }
        continue
      }
      combatGuard = 0

      if (game.turnNumber !== currentTurn) closeTurn()

      const active = game.activePlayerId
      if (!active) break

      const seen = orderSeen[active]
      if (seen && seen.length <= record.samples.length) {
        seen.push(orderIndex)
        orderIndex += 1
      }

      let progressed = false
      if (game.phase === 'planning') progressed = tryPlaceMarker(game, map, active)
      else if (game.phase === 'actions') progressed = stepActions(game, map, active, tally, attempts)

      note(
        `t${game.turnNumber} ${game.phase} ${active} `
          + `m=${game.actionMarkers.filter((m) => m.ownerId === active).length} `
          + `res=${game.actionMarkerResolvedThisTurn ? 1 : 0} prog=${progressed ? 1 : 0}`,
      )

      if (progressed) continue
      // Бой мог подняться прямо сейчас — передавать фазу поверх него нельзя.
      if (game.pendingCombat) continue

      const { errors } = applyGameActionOnSnapshot(game, map, active, 'advance-phase')
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
