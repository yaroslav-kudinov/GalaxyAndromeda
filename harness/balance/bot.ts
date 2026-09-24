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
  applyGameActionOnSnapshot,
  beginMatchForParticipants,
  combatPrepOf,
  countControlledPowerCenters,
  gameSnapshotFromMap,
  claimPicksRemaining,
  computeClaimLimit,
  getShipProductionRegionMin,
  hexKey,
  rechargePicksRemaining,
  siegeLossesOwedBy,
  doctrineChoiceOwed,
  type DoctrineId,
  SHIP_PRODUCTION_COST,
} from '../../packages/rules/src/index.js'
import type {
  GameSnapshot,
  MapDefinition,
  ShipType,
} from '../../packages/rules/src/index.js'
import {
  faceUpValueFor,
  indexCells,
  parseKey,
  pickDoctrine,
  stepActions,
  stepCombat,
  tryPlaceMarker,
  type MarkerAttempts,
  type SpendTally,
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
        const progressed = stepCombat(game, map, options, { onSiegeEstablished: () => { record.sieges.established += 1 } })
        if (!progressed || combatGuard > 200) {
          const attackerId = game.pendingCombat?.attackerId
          if (attackerId) applyGameActionOnSnapshot(game, map, attackerId, 'abort-combat')
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
        applyGameActionOnSnapshot(game, map, game.siegeContinuationChoice.playerId, 'resolve-siege-continuation', { continue: true })
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

      if (game.phase === 'planning') {
        for (const playerId of playerIds) {
          // До своих потерь в осаде доктрину не выбирают, а доктрины ждут всех.
          if (siegeLossesOwedBy(game, playerId).length > 0) {
            applyGameActionOnSnapshot(game, map, playerId, 'execute-siege-losses')
          }
          if (!doctrineChoiceOwed(game, playerId)) continue
          const doctrineId = playerId === record.deviantPlayerId && options.deviantDoctrine
            ? options.deviantDoctrine
            : options.forcedDoctrine ?? pickDoctrine(game, playerId)
          const window = String(game.doctrineChoice?.windowStart ?? game.turnNumber)
          if (!applyGameActionOnSnapshot(game, map, playerId, 'choose-doctrine', { doctrineId }).errors.length) {
            record.doctrines[window] ??= {}
            record.doctrines[window]![doctrineId] = (record.doctrines[window]![doctrineId] ?? 0) + 1
          }
        }
      }
      // Вскрытие доктрин сразу считает захват — он может принести победу.
      if (game.gameOver) continue

      let progressed = false
      if (game.phase === 'planning' && siegeLossesOwedBy(game, active).length > 0) {
        progressed = applyGameActionOnSnapshot(
          game, map, active, 'execute-siege-losses',
        ).errors.length === 0
      }
      if (!progressed && game.phase === 'planning' && claimPicksRemaining(game, active) > 0) {
        progressed = applyGameActionOnSnapshot(
          game, map, active, 'execute-claim-picks',
        ).errors.length === 0
      }
      if (!progressed && game.phase === 'planning' && rechargePicksRemaining(game, active) > 0) {
        progressed = applyGameActionOnSnapshot(
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
