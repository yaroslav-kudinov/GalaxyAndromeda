/**
 * Поведение ботов, которое замечает человек за столом: кто ходит в набеги на пустые центры
 * власти, кто их отбивает до начала следующего хода, кто штурмует, кто отнимает центры у того,
 * кто вот-вот победит, и кто оставляет свои центры открытыми.
 *
 * Трекер смотрит на центры власти после каждого шага партии и объясняет каждую смену хозяина:
 *
 * - **набег** — в фазе действий центр ушёл без боя: на нём не было кораблей хозяина (вход в
 *   пустой чужой центр, в том числе отступлением);
 * - **штурм** — в фазе действий центр ушёл после боя с гарнизоном (и штурм осаждённого центра);
 * - **осада** — в начале хода центр перешёл осаждающему;
 * - **захват** — в начале хода занят нейтральный центр.
 *
 * Центр, потерянный в фазе действий, считается **отбитым**, если прежний хозяин вернул его до
 * начала следующего хода, и **удержанным врагом**, если к началу хода он всё ещё чужой.
 */

import { hexKey, type GameSnapshot } from '../../packages/rules/src/index.js'
import { indexBoard, reachForShip } from '../../packages/rules/src/bot-board.js'
import { rivalMovableCells } from '../../packages/rules/src/bot-strategy.js'

/** Счётчики одного места за партию. */
export interface BehaviorCounters {
  /** Ходов, в которые место было в партии (по началам фазы действий). */
  turns: number
  /** Набеги: чужой центр взят без боя в фазе действий. */
  raids: number
  /** Штурмы: чужой центр взят боем в фазе действий. */
  storms: number
  /** Из них — штурм осаждённого центра. */
  besiegedStorms: number
  /** Центры, взятые осадой в начале хода. */
  siegeCaptures: number
  /** Нейтральные центры, занятые в начале хода. */
  neutralClaims: number
  /** Свои центры, потерянные в фазе действий: набегом и штурмом. */
  lostToRaids: number
  lostToStorms: number
  /** Потерянные в фазе действий и отбитые самим местом до начала следующего хода. */
  retaken: number
  /** Потерянные в фазе действий и так и оставшиеся у врага к началу следующего хода. */
  lossesHeld: number
  /** Центры, отнятые (набегом, штурмом, осадой) у того, кому до порога оставался один центр. */
  nearWinnerTakes: number
  /**
   * Свои центры без кораблей, до которых в начале фазы действий долетает вражеский корабль
   * под маркером, — сумма за партию; делить на `turns`.
   */
  exposedPcTurns: number
}

export function emptyCounters(): BehaviorCounters {
  return {
    turns: 0,
    raids: 0,
    storms: 0,
    besiegedStorms: 0,
    siegeCaptures: 0,
    neutralClaims: 0,
    lostToRaids: 0,
    lostToStorms: 0,
    retaken: 0,
    lossesHeld: 0,
    nearWinnerTakes: 0,
    exposedPcTurns: 0,
  }
}

interface PcState {
  owner: string | null
  /** На клетке стояли корабли хозяина. */
  garrison: boolean
}

export interface BehaviorTracker {
  /** Сравнить центры с прошлым шагом и объяснить каждую смену хозяина. Звать после каждого шага. */
  observe(game: GameSnapshot): void
  /** Начало фазы действий: маркеры расставлены — посчитать открытые центры. */
  onActionsStart(game: GameSnapshot): void
  /** Начало нового хода: центры, потерянные в прошлой фазе действий, решены. */
  onTurnStart(game: GameSnapshot): void
  result(): Record<string, BehaviorCounters>
}

export function createBehaviorTracker(game: GameSnapshot, playerIds: readonly string[], threshold: number): BehaviorTracker {
  const counters: Record<string, BehaviorCounters> = Object.fromEntries(playerIds.map((id) => [id, emptyCounters()]))
  const bump = (playerId: string | null, key: keyof BehaviorCounters) => {
    if (playerId && counters[playerId]) counters[playerId]![key] += 1
  }

  let prev = new Map<string, PcState>()
  let prevPhase = game.phase
  let prevTurn = game.turnNumber
  let prevSieges: Record<string, string> = {}
  /** Хозяева центров в начале фазы действий: от них считаются потери и отбитые центры. */
  let ownedAtActionsStart = new Map<string, string>()
  /** Центры, которые их хозяин потерял в этой фазе действий. */
  const lostThisTurn = new Set<string>()

  const snapshot = (current: GameSnapshot) => {
    const next = new Map<string, PcState>()
    for (const cell of current.cells) {
      if (!cell.isPowerCenter) continue
      const owner = cell.controlOwnerId ?? null
      next.set(hexKey(cell.coord.q, cell.coord.r), {
        owner,
        garrison: !!owner && cell.ships.some((ship) => ship.ownerId === owner),
      })
    }
    prev = next
    prevPhase = current.phase
    prevTurn = current.turnNumber
    prevSieges = Object.fromEntries(Object.entries(current.sieges ?? {}).map(([key, siege]) => [key, siege.besiegerId]))
  }
  snapshot(game)

  const powerCentersBefore = (playerId: string): number => {
    let count = 0
    for (const state of prev.values()) if (state.owner === playerId) count += 1
    return count
  }

  return {
    observe(current) {
      const duringActions = current.turnNumber === prevTurn && prevPhase === 'actions' && current.phase === 'actions'
      const changes: { key: string; before: PcState; owner: string | null }[] = []
      for (const cell of current.cells) {
        if (!cell.isPowerCenter) continue
        const key = hexKey(cell.coord.q, cell.coord.r)
        const before = prev.get(key)
        const owner = cell.controlOwnerId ?? null
        if (before && before.owner !== owner) changes.push({ key, before, owner })
      }
      for (const { key, before, owner } of changes) {
        const loser = before.owner
        if (owner && loser && powerCentersBefore(loser) >= threshold - 1) bump(owner, 'nearWinnerTakes')
        if (duringActions) {
          if (!owner || !loser) continue
          const siegeStorm = prevSieges[key] === owner
          const original = ownedAtActionsStart.get(key)
          bump(owner, before.garrison ? 'storms' : 'raids')
          if (before.garrison && siegeStorm) bump(owner, 'besiegedStorms')
          if (loser === original) {
            bump(loser, before.garrison ? 'lostToStorms' : 'lostToRaids')
            lostThisTurn.add(key)
          }
          if (owner === original && lostThisTurn.has(key)) bump(owner, 'retaken')
          continue
        }
        if (!owner) continue
        if (prevSieges[key] === owner) bump(owner, 'siegeCaptures')
        else if (!loser) bump(owner, 'neutralClaims')
      }
      snapshot(current)
    },

    onActionsStart(current) {
      const board = indexBoard(current)
      const active = new Set(
        current.players
          .filter((player) => !player.eliminated && playerIds.includes(player.id))
          .map((player) => player.id),
      )
      const movable = new Map([...active].map((id) => [id, rivalMovableCells(current, id)]))
      // Куда долетает каждый игрок кораблями под маркерами.
      const reach = new Map<string, Set<string>>()
      for (const [key, cell] of board.cells) {
        for (const ship of cell.ships) {
          if (!active.has(ship.ownerId) || !movable.get(ship.ownerId)!(key)) continue
          let cells = reach.get(ship.ownerId)
          if (!cells) reach.set(ship.ownerId, (cells = new Set()))
          for (const target of reachForShip(board, key, ship.ownerId, ship.type).keys()) cells.add(target)
        }
      }
      for (const id of active) bump(id, 'turns')
      ownedAtActionsStart = new Map()
      for (const [key, cell] of board.cells) {
        if (cell.isPowerCenter && cell.controlOwnerId) ownedAtActionsStart.set(key, cell.controlOwnerId)
      }
      for (const [key, cell] of board.cells) {
        const owner = cell.controlOwnerId
        if (!cell.isPowerCenter || !owner || !active.has(owner)) continue
        if (cell.ships.some((ship) => ship.ownerId === owner)) continue
        const exposed = [...reach].some(([id, cells]) => id !== owner && cells.has(key))
        if (exposed) bump(owner, 'exposedPcTurns')
      }
    },

    onTurnStart(current) {
      for (const key of lostThisTurn) {
        const original = ownedAtActionsStart.get(key)!
        const cell = current.cells.find((candidate) => hexKey(candidate.coord.q, candidate.coord.r) === key)
        if (cell?.controlOwnerId !== original) bump(original, 'lossesHeld')
      }
      lostThisTurn.clear()
      ownedAtActionsStart = new Map()
    },

    result() {
      return counters
    },
  }
}
