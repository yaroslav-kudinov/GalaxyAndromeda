import { MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER, SHIP_LABELS } from './constants.js'
import { trimGameEventLog } from './event-log.js'
import { getCellKeys, HEX_DIRECTIONS, hexDistance } from './map.js'
import {
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
  ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
  mustResolveActionMarkerBeforeAdvance,
  canExecuteActionMarkerThisTurn,
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
  removeProductionMarker,
  toggleMarkerAtCell,
  type MarkerKind,
} from './markers.js'
import {
  autoResolveClaimPicks,
  claimPicksRemaining,
  executeClaimPicks,
  transferControlIfEnemyOwned,
  CLAIM_PICK_ERRORS,
} from './claim.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import {
  executeProductionBatch,
  executeProductionRecharge,
  executeBuyProductionMarker,
  type ProductionBatchPlan,
  type ShipPlacement,
  type TokenSpendRef,
} from './production.js'
import {
  executeMarkerBombardment,
  type BombardmentPlan,
} from './bombardment.js'
import {
  abortPendingCombat,
  applyCombatResultToSnapshot,
  beginOrAwaitCombatContinuation,
  buildCombatPreview,
  buildCombatPreviewFromPending,
  combatPrepOf,
  continuePendingCombat,
  getCombatDestinationKeys,
  getCombatDestinationKeysFromMoves,
  isCombatDestination,
  resolveCombatAtCell,
  removeOrphanedActionMarkersAt,
  setupCombatPrepForAssault,
  setupCombatPrepForMovement,
  stopPendingCombat,
  syncEliminatedCombatAutomation,
  updateCombatPrep,
  cancelCombatPrep,
  validateCombatOptions,
  validatePendingCombatPrepOptions,
  validateSingleCombatDestination,
  type CombatOptions,
  type CombatResolutionResult,
} from './combat.js'
import { getEffectiveMoveRange, isMovementIntoCellBlocked } from './events.js'
import { getShipMoveRange } from './ships.js'
import { advanceGameSnapshot, completeEventsPhaseIfActive } from './turn.js'
import type { HexCoord, LegalAction, MapDefinition, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'
import { getLegalActions } from './game.js'
import {
  autoResolveRechargePicks,
  executeRechargePicks,
  rechargePicksRemaining,
  RECHARGE_PICK_ERRORS,
} from './resource-recharge.js'
import type { ResourceTokenRef } from './resource-recharge.js'
import { applyVictoryAndDefeatChecks } from './victory.js'
import { surrenderPlayer } from './surrender.js'
import {
  autoResolveSiegeLosses,
  establishSiegeRecord,
  executeSiegeLosses,
  siegeLossesOwedBy,
  syncSieges,
  validateGarrisonDeparture,
} from './siege.js'

export interface ShipMovePlan {
  shipId: string
  to: HexCoord
  declareControl?: boolean
}

export interface MovableShipOption {
  ship: ShipUnit
  moveRange: number
  reachableKeys: string[]
  /** Клетки, куда ведёт бой (вражеские) — для UI превью; не проходят обычную валидацию */
  combatReachableKeys: string[]
  disabledReason?: string
}

function effectiveControlOwnerId(
  game: GameSnapshot,
  controlOwnerId: string | null,
): string | null {
  if (!controlOwnerId) return null
  const participating = game.participatingPlayerIds
  if (participating?.length && !participating.includes(controlOwnerId)) return null
  return controlOwnerId
}

function cellAt(game: GameSnapshot, coord: HexCoord): RuntimeCellState | undefined {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
}

function findShipOnBoard(
  game: GameSnapshot,
  shipId: string,
): (ShipUnit & { cellKey: string }) | null {
  for (const cell of game.cells) {
    const ship = cell.ships.find((s) => s.id === shipId)
    if (ship) {
      return { ...ship, cellKey: hexKey(cell.coord.q, cell.coord.r) }
    }
  }
  return null
}

function countPlayerShipsAt(cell: RuntimeCellState, playerId: string): number {
  return cell.ships.filter((s) => s.ownerId === playerId).length
}

function countIncomingMoves(
  moves: ShipMovePlan[],
  destKey: string,
  playerId: string,
  game: GameSnapshot,
): { player: number; total: number } {
  let player = 0
  let total = 0
  for (const move of moves) {
    if (hexKey(move.to.q, move.to.r) !== destKey) continue
    const ship = findShipOnBoard(game, move.shipId)
    if (!ship) continue
    total += 1
    if (ship.ownerId === playerId) player += 1
  }
  return { player, total }
}

/**
 * Клетка блокирует проход (вражеские корабли или вражеский контроль),
 * но может быть конечной точкой хода → бой.
 */
function blocksMovementTransit(
  game: GameSnapshot,
  playerId: string,
  cellKey: string,
): boolean {
  const [q, r] = cellKey.split(',').map(Number)
  return isCombatDestination(game, playerId, { q: q!, r: r! })
}

/**
 * Клетки в пределах moveRange по **пути по существующим гексам** (BFS).
 * «Пустые» дыры карты (гекса нет) нельзя пересекать — осевое hexDistance не подходит.
 * Клетки с врагами / вражеским контролем достижимы как конечная точка (бой),
 * но через них путь дальше не идёт.
 */
export function getReachableHexKeys(
  map: MapDefinition,
  from: HexCoord,
  shipType: ShipType,
  game?: GameSnapshot,
  playerId?: string,
): string[] {
  const range = game ? getEffectiveMoveRange(game, shipType) : getShipMoveRange(shipType)
  const fromKey = hexKey(from.q, from.r)

  const candidateKeys = new Set(
    game?.cells.length
      ? game.cells.map((c) => hexKey(c.coord.q, c.coord.r))
      : [...getCellKeys(map)],
  )
  if (!candidateKeys.has(fromKey) || range < 1) return []

  const reachable: string[] = []
  const dist = new Map<string, number>([[fromKey, 0]])
  const queue: string[] = [fromKey]

  while (queue.length > 0) {
    const cur = queue.shift()!
    const d = dist.get(cur)!
    if (d >= range) continue
    const [cq, cr] = cur.split(',').map(Number)
    for (const dir of HEX_DIRECTIONS) {
      const nk = hexKey(cq! + dir.q, cr! + dir.r)
      if (!candidateKeys.has(nk) || dist.has(nk)) continue
      const nd = d + 1
      dist.set(nk, nd)
      if (nd >= 1 && nd <= range) reachable.push(nk)
      // Через клетку боя путь не продолжаем
      if (game && playerId && blocksMovementTransit(game, playerId, nk)) continue
      queue.push(nk)
    }
  }

  return reachable
}

/** Длина кратчайшего пути по существующим гексам; null если пути нет в пределах maxSteps. */
export function hexPathDistance(
  existingKeys: ReadonlySet<string>,
  from: HexCoord,
  to: HexCoord,
  maxSteps: number,
  options?: {
    /** true = клетка непроходима как промежуточная (конечная `to` всегда допускается) */
    blocksTransit?: (cellKey: string) => boolean
  },
): number | null {
  const fromKey = hexKey(from.q, from.r)
  const toKey = hexKey(to.q, to.r)
  if (fromKey === toKey) return 0
  if (!existingKeys.has(fromKey) || !existingKeys.has(toKey) || maxSteps < 1) return null

  const dist = new Map<string, number>([[fromKey, 0]])
  const queue: string[] = [fromKey]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const d = dist.get(cur)!
    if (d >= maxSteps) continue
    const [cq, cr] = cur.split(',').map(Number)
    for (const dir of HEX_DIRECTIONS) {
      const nk = hexKey(cq! + dir.q, cr! + dir.r)
      if (!existingKeys.has(nk) || dist.has(nk)) continue
      const nd = d + 1
      if (nk === toKey) return nd
      if (options?.blocksTransit?.(nk)) continue
      dist.set(nk, nd)
      queue.push(nk)
    }
  }
  return null
}

/** @deprecated Захват клетки эсминцем — отдельное действие маркера, не движение. */
export function canDeclareControlForMove(
  _game: GameSnapshot,
  _ship: ShipUnit,
  _dest: RuntimeCellState,
): boolean {
  return false
}

export function validateDestinationForMove(
  game: GameSnapshot,
  _map: MapDefinition,
  playerId: string,
  ship: ShipUnit,
  from: HexCoord,
  to: HexCoord,
  declareControl: boolean,
  priorMoves: ShipMovePlan[],
): string[] {
  const errors: string[] = []
  const dest = cellAt(game, to)
  if (!dest) return [`Клетка ${hexKey(to.q, to.r)} вне карты`]

  const fromKey = hexKey(from.q, from.r)
  const toKey = hexKey(to.q, to.r)
  if (fromKey === toKey) return ['Выберите другую клетку назначения']

  const range = game ? getEffectiveMoveRange(game, ship.type) : getShipMoveRange(ship.type)
  const existingKeys = new Set(game.cells.map((c) => hexKey(c.coord.q, c.coord.r)))
  const pathDist = hexPathDistance(existingKeys, from, to, range, {
    blocksTransit: (key) => blocksMovementTransit(game, playerId, key),
  })
  if (pathDist == null || pathDist < 1) {
    return [`Нет пути по клеткам карты в пределах дальности ${range}`]
  }
  if (pathDist > range) {
    return [`Дальность ${range}, путь ${pathDist}`]
  }

  if (game && isMovementIntoCellBlocked(game, dest, fromKey, toKey)) {
    return ['Местная самооборона: нельзя входить в клетку с ресурсами или центром власти']
  }

  if (effectiveControlOwnerId(game, dest.controlOwnerId) != null
    && effectiveControlOwnerId(game, dest.controlOwnerId) !== playerId) {
    if (isCombatDestination(game, playerId, to)) {
      return errors
    }
  }

  if (isCombatDestination(game, playerId, to)) {
    return errors
  }

  if (declareControl) {
    errors.push('Захват эсминцем — отдельное действие маркера, не перемещение')
    return errors
  }

  const incoming = countIncomingMoves(priorMoves, toKey, playerId, game)
  const playerCount = countPlayerShipsAt(dest, playerId) + incoming.player
  const totalCount = dest.ships.length + incoming.total

  if (playerCount >= MAX_SHIPS_PER_CELL_PER_PLAYER) {
    errors.push(`Не более ${MAX_SHIPS_PER_CELL_PER_PLAYER} ваших кораблей на клетке`)
  }
  if (totalCount >= MAX_SHIPS_PER_CELL) {
    errors.push(`Не более ${MAX_SHIPS_PER_CELL} кораблей на клетке`)
  }

  return errors
}

export function getMovableShipsAtMarker(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
): MovableShipOption[] {
  if (!canExecuteActionMarkerThisTurn(game, playerId)) return []

  const fromCell = cellAt(game, from)
  if (!fromCell) return []

  const hasMarker = game.actionMarkers.some(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!hasMarker) return []

  return fromCell.ships
    .filter((s) => s.ownerId === playerId)
    .map((ship) => {
      const moveRange = getEffectiveMoveRange(game, ship.type)
      const rangeCandidates = getReachableHexKeys(map, from, ship.type, game, playerId)
      const reachableKeys = rangeCandidates.filter((key) => {
        const [q, r] = key.split(',').map(Number)
        return (
          validateDestinationForMove(game, map, playerId, ship, from, { q, r }, false, [])
            .length === 0
        )
      })
      const combatReachableKeys = getCombatDestinationKeys(game, playerId, rangeCandidates)

      let disabledReason: string | undefined
      if (reachableKeys.length === 0 && combatReachableKeys.length === 0) {
        disabledReason = 'Нет доступных клеток в радиусе хода'
      }

      return { ship, moveRange, reachableKeys, combatReachableKeys, disabledReason }
    })
}

export function validateMarkerMovement(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  moves: ShipMovePlan[],
): string[] {
  if (game.phase !== 'actions') return ['Движение только в фазе «Действия»']
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (game.actionMarkerResolvedThisTurn) return [ACTION_MARKER_ALREADY_RESOLVED_MSG]

  const fromCell = cellAt(game, from)
  if (!fromCell) return [`Клетка ${hexKey(from.q, from.r)} не найдена`]

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!marker) return ['На клетке нет вашего маркера действия']

  if (moves.length === 0) return ['Выберите хотя бы один корабль для перемещения']

  const errors: string[] = []
  const seenShipIds = new Set<string>()

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    if (seenShipIds.has(move.shipId)) {
      errors.push(`Корабль ${move.shipId} указан дважды`)
      continue
    }
    seenShipIds.add(move.shipId)

    const shipInfo = findShipOnBoard(game, move.shipId)
    if (!shipInfo) {
      errors.push(`Корабль ${move.shipId} не найден`)
      continue
    }
    if (shipInfo.ownerId !== playerId) {
      errors.push(`Корабль ${move.shipId} не ваш`)
      continue
    }
    if (shipInfo.cellKey !== hexKey(from.q, from.r)) {
      errors.push(`Корабль ${move.shipId} не на исходной клетке`)
      continue
    }

    errors.push(
      ...validateDestinationForMove(
        game,
        map,
        playerId,
        shipInfo,
        from,
        move.to,
        !!move.declareControl,
        moves.slice(0, i),
      ),
    )
  }

  errors.push(...validateSingleCombatDestination(game, moves, playerId))
  errors.push(...validateGarrisonDeparture(game, playerId, from, moves, hexDistance))

  return errors
}

export interface MarkerActionExecution {
  errors: string[]
  combatResult?: CombatResolutionResult
}

function applyControlAfterShipLanding(
  game: GameSnapshot,
  destCell: RuntimeCellState,
  ship: ShipUnit,
): void {
  transferControlIfEnemyOwned(game, destCell, ship.ownerId)
}

function finishPendingMovementPlans(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  moves: ShipMovePlan[],
  combatResult: Pick<CombatResolutionResult, 'attackerWon'> | null,
  combatKey: string | undefined,
): string[] {
  const summaries: string[] = []

  for (const move of moves) {
    const moveKey = hexKey(move.to.q, move.to.r)
    if (combatKey && moveKey === combatKey && combatResult && !combatResult.attackerWon) {
      continue
    }

    const shipInfo = findShipOnBoard(game, move.shipId)
    if (!shipInfo) continue

    const sourceCell = cellAt(game, parseHexKeyFromCellKey(shipInfo.cellKey))!
    const shipIdx = sourceCell.ships.findIndex((s) => s.id === move.shipId)
    if (shipIdx < 0) continue

    const destCell = cellAt(game, move.to)!
    const [ship] = sourceCell.ships.splice(shipIdx, 1)

    destCell.ships.push(ship)
    applyControlAfterShipLanding(game, destCell, ship)
    summaries.push(`${SHIP_LABELS[ship.type]} → (${move.to.q},${move.to.r})`)
  }

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (marker) removeActionMarker(game, marker.id, playerId)
  markActionMarkerResolvedThisTurn(game)
  // На всякий случай: маркеры клеток, с которых ушли все корабли владельца.
  removeOrphanedActionMarkersAt(game, from)
  if (combatKey) {
    const [cq, cr] = combatKey.split(',').map(Number)
    removeOrphanedActionMarkersAt(game, { q: cq, r: cr })
  }

  return summaries
}

export function executeMarkerMovement(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  moves: ShipMovePlan[],
  combatOptions?: CombatOptions,
): MarkerActionExecution {
  const errors = validateMarkerMovement(game, map, playerId, from, moves)
  if (errors.length) return { errors }

  const fromCell = cellAt(game, from)!
  const combatKeys = getCombatDestinationKeysFromMoves(game, moves, playerId)
  const combatKey = combatKeys[0]

  let combatResult: ReturnType<typeof resolveCombatAtCell> | null = null

  if (combatKey) {
    const [cq, cr] = combatKey.split(',').map(Number)
    const combatCoord = { q: cq, r: cr }
    const combatMoves = moves.filter((m) => hexKey(m.to.q, m.to.r) === combatKey)
    const incomingShips = combatMoves
      .map((m) => fromCell.ships.find((s) => s.id === m.shipId))
      .filter((s): s is ShipUnit => !!s)

    const previewOptions = {
      ...(combatOptions ?? {}),
      attackerMovementPlans: moves,
    }
    const preview = buildCombatPreview(game, combatCoord, playerId, incomingShips, previewOptions)
    if (preview) {
      if (!combatOptions) {
        const prepErrors = setupCombatPrepForMovement(
          game,
          from,
          moves,
          playerId,
          combatCoord,
          incomingShips.map((s) => s.id),
        )
        return { errors: prepErrors }
      }

      const optionErrors = validateCombatOptions(
        game,
        preview,
        incomingShips.map((s) => s.id),
        combatOptions,
      )
      if (optionErrors.length) return { errors: optionErrors }

      combatResult = resolveCombatAtCell(
        game,
        combatCoord,
        playerId,
        incomingShips,
        combatOptions,
        Math.random,
        preview,
      )

      applyCombatResultToSnapshot(
        game,
        combatResult,
        playerId,
        preview.defenderId,
        { incomingAttackerShips: incomingShips },
      )

      const followUp = beginOrAwaitCombatContinuation(game, {
        coord: combatCoord,
        attackerId: playerId,
        completedRoundNumber: 1,
        trigger: 'movement',
        continuation: {
          movementFrom: { ...from },
          movementPlans: moves.map((move) => ({ ...move, to: { ...move.to } })),
          incomingAttackerShipIds: incomingShips.map((ship) => ship.id),
        },
        combatOptions,
        shipsDestroyedInCombat: combatResult.destroyedShipIds.length > 0,
        damageByShipId: combatResult.damageByShipId,
        seedCombatResult: combatResult,
      })
      if (followUp.errors.length) {
        return { errors: followUp.errors, combatResult: combatResult ?? undefined }
      }
      // Бой ещё идёт — движение откладываем.
      if (game.pendingCombat) {
        return {
          errors: [],
          combatResult: followUp.combatResult ?? combatResult ?? undefined,
        }
      }
      // Бой уже завершён в follow-up (полный wipe и т.п.) — дожимаем вход на клетку ниже.
      if (followUp.combatResult) {
        combatResult = followUp.combatResult
      }
    }
  }

  const summaries: string[] = []

  for (const move of moves) {
    const moveKey = hexKey(move.to.q, move.to.r)
    if (combatKey && moveKey === combatKey && combatResult && !combatResult.attackerWon) {
      continue
    }

    const shipInfo = findShipOnBoard(game, move.shipId)
    if (!shipInfo) continue

    const sourceCell = cellAt(game, parseHexKeyFromCellKey(shipInfo.cellKey))!
    const shipIdx = sourceCell.ships.findIndex((s) => s.id === move.shipId)
    if (shipIdx < 0) continue

    const destCell = cellAt(game, move.to)!
    const [ship] = sourceCell.ships.splice(shipIdx, 1)

    destCell.ships.push(ship)
    applyControlAfterShipLanding(game, destCell, ship)
    summaries.push(`${SHIP_LABELS[ship.type]} → (${move.to.q},${move.to.r})`)
  }

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (marker) removeActionMarker(game, marker.id, playerId)
  markActionMarkerResolvedThisTurn(game)

  const combatNote = combatResult
    ? `; бой: ${combatResult.attackerWon ? 'атакующий победил' : 'защитник победил'}`
    : ''
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'movement',
    message: `Движение с (${from.q},${from.r}): ${summaries.join('; ') || '—'}${combatNote}`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)

  applyVictoryAndDefeatChecks(game, map.id)

  return { errors: [], combatResult: combatResult ?? undefined }
}

export function resolveCombatPrep(
  game: GameSnapshot,
  map: MapDefinition,
): { errors: string[]; combatResult?: CombatResolutionResult } {
  const pending = game.pendingCombat
  const prep = combatPrepOf(pending)
  if (!pending || !prep) return { errors: ['Нет подготовки к бою'] }

  const validationErrors = validatePendingCombatPrepOptions(game)
  if (validationErrors.length) {
    prep.phase = 'prep'
    prep.countdownStartedAt = undefined
    prep.readyBy = {}
    return { errors: validationErrors }
  }

  const opts = prep.combatOptions
  const attackerId = pending.attackerId
  const trigger = pending.trigger ?? 'movement'
  const movementFrom = prep.movementFrom
  const movementPlans = prep.movementPlans
  const bombardmentFrom = prep.bombardmentFrom
  const bombardmentPlans = prep.bombardmentPlans
  const queuedBombardmentPlans = prep.queuedBombardmentPlans ?? []

  const isBombardment = trigger === 'bombardment' && bombardmentFrom && bombardmentPlans
  const assaultFrom = prep.assaultFrom
  if (!isBombardment && !assaultFrom && !(movementFrom && movementPlans)) {
    return { errors: ['Некорректное состояние подготовки боя'] }
  }

  // Подготовку снимаем только после успешного исполнения: иначе отказ execute
  // оставил бы игроков без экрана боя и без возможности повторить.
  game.pendingCombat = undefined

  const result = assaultFrom
    ? executeAssaultOnSharedCell(game, map, attackerId, assaultFrom, opts ?? {}, {
        consumeMarker: !prep.siegeResponse,
      })
    : isBombardment
    ? executeMarkerBombardment(
        game,
        map,
        attackerId,
        bombardmentFrom,
        bombardmentPlans,
        opts,
        queuedBombardmentPlans,
      )
    : executeMarkerMovement(game, map, attackerId, movementFrom!, movementPlans!, opts)

  if (result.errors.length && !game.pendingCombat) {
    game.pendingCombat = pending
    prep.phase = 'prep'
    prep.countdownStartedAt = undefined
    prep.readyBy = {}
  }

  settleSieges(game, map.id)
  return result
}

/**
 * Бой на клетке, где уже стоят корабли обеих сторон: вылазка осаждённого, штурм осады или ответ
 * осаждённого. Маркер действия тратится в момент начала боя — корабли никуда не летят, дожимать
 * после боя нечего.
 */
export function executeAssaultOnSharedCell(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  coord: HexCoord,
  combatOptions: CombatOptions,
  options: { consumeMarker: boolean },
): MarkerActionExecution {
  const cell = cellAt(game, coord)
  const attackers = cell?.ships.filter((ship) => ship.ownerId === playerId) ?? []
  const preview = buildCombatPreview(game, coord, playerId, attackers, {
    supportSides: combatOptions.supportSides,
  })
  if (!cell || !preview) return { errors: ['На клетке нет противника'] }

  if (options.consumeMarker) {
    const marker = game.actionMarkers.find(
      (m) => m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(coord.q, coord.r),
    )
    if (marker) removeActionMarker(game, marker.id, playerId)
    markActionMarkerResolvedThisTurn(game)
  }

  const first = resolveCombatAtCell(game, coord, playerId, attackers, combatOptions, Math.random, preview)
  applyCombatResultToSnapshot(game, first, playerId, preview.defenderId)
  const followUp = beginOrAwaitCombatContinuation(game, {
    coord,
    attackerId: playerId,
    completedRoundNumber: 1,
    trigger: 'stack',
    combatOptions,
    shipsDestroyedInCombat: first.destroyedShipIds.length > 0,
    damageByShipId: first.damageByShipId,
    seedCombatResult: first,
  })
  applyVictoryAndDefeatChecks(game, map.id)
  return { errors: followUp.errors, combatResult: followUp.combatResult ?? first }
}

/** Маркер на клетке с кораблями противника: атаковать их, не двигаясь. */
export function executeMarkerAssault(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  combatOptions?: CombatOptions,
): MarkerActionExecution {
  if (game.phase !== 'actions') return { errors: ['Атаковать можно только в фазе «Действия»'] }
  if (game.activePlayerId !== playerId) return { errors: ['Сейчас ход другого игрока'] }
  if (game.actionMarkerResolvedThisTurn) return { errors: [ACTION_MARKER_ALREADY_RESOLVED_MSG] }
  const marker = game.actionMarkers.find(
    (m) => m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!marker) return { errors: ['На клетке нет вашего маркера действия'] }
  const cell = cellAt(game, from)
  if (!cell?.ships.some((ship) => ship.ownerId === playerId)) {
    return { errors: ['На клетке нет ваших кораблей'] }
  }
  if (!cell.ships.some((ship) => ship.ownerId !== playerId)) {
    return { errors: ['На клетке нет кораблей противника'] }
  }
  if (!combatOptions) return { errors: setupCombatPrepForAssault(game, playerId, from) }
  return executeAssaultOnSharedCell(game, map, playerId, from, combatOptions, { consumeMarker: true })
}

/**
 * Вместо штурма осадить центр власти: корабли входят на клетку, боя нет, маркер исполнен.
 * Осаждённого сразу спрашивают, не нападёт ли он немедленно.
 */
export function establishSiege(game: GameSnapshot, map: MapDefinition, playerId: string): string[] {
  const pending = game.pendingCombat
  const prep = combatPrepOf(pending)
  if (!pending || !prep) return ['Нет подготовки к бою']
  if (pending.attackerId !== playerId) return ['Осадить может только атакующий']
  if (!prep.siegeAvailable || !prep.movementFrom || !prep.movementPlans) {
    return ['Эту клетку осадить нельзя']
  }
  const [q, r] = pending.cellKey.split(',').map(Number)
  const coord = { q: q!, r: r! }
  const besiegedId = prep.defenderId

  game.pendingCombat = undefined
  finishPendingMovementPlans(
    game,
    playerId,
    prep.movementFrom,
    prep.movementPlans,
    { attackerWon: true },
    pending.cellKey,
  )
  establishSiegeRecord(game, coord, playerId, besiegedId)

  const besieged = game.players.find((player) => player.id === besiegedId)
  if (besieged && !besieged.eliminated) {
    // Ответ необязателен: если гарнизону нечем стрелять, спрашивать не о чем.
    const responseErrors = setupCombatPrepForAssault(game, besiegedId, coord, { siegeResponse: true })
    if (!responseErrors.length) {
      const preview = buildCombatPreviewFromPending(game)
      if (!preview || preview.attacker.diceTotal === 0) game.pendingCombat = undefined
    }
  }
  applyVictoryAndDefeatChecks(game, map.id)
  return []
}

function parseHexKeyFromCellKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

export function getLegalActionsForSnapshot(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
): LegalAction[] {
  completeEventsPhaseIfActive(game, mapId)
  const state = gameStateFromSnapshot(game, mapId)
  const actions = getLegalActions(state, playerId)

  const owedClaims = claimPicksRemaining(game, playerId)
  if (game.phase === 'planning' && owedClaims > 0 && !game.gameOver) {
    actions.push({
      id: 'execute-claim-picks',
      type: 'claimPicks',
      description: `Занять клетки (осталось ${owedClaims}); без выбора займутся лучшие`,
      params: { remaining: owedClaims },
    })
  }

  const owedSiege = siegeLossesOwedBy(game, playerId)
  if (game.phase === 'planning' && owedSiege.length > 0 && !game.gameOver) {
    actions.push({
      id: 'execute-siege-losses',
      type: 'siegeLosses',
      description: `Осада: выбрать потери гарнизона (клеток ${owedSiege.length}); без выбора погибнут самые дешёвые`,
      params: { cells: owedSiege },
    })
  }

  const owedPicks = rechargePicksRemaining(game, playerId)
  if (game.phase === 'planning' && owedPicks > 0 && !game.gameOver) {
    actions.push({
      id: 'execute-recharge-picks',
      type: 'rechargePicks',
      description: `Перезарядка: выбрать фишки (осталось ${owedPicks}); без выбора поднимутся самые крупные`,
      params: { remaining: owedPicks },
    })
  }

  const me = game.players.find((p) => p.id === playerId)
  if (!game.gameOver && me && !me.eliminated) {
    actions.push({
      id: 'surrender',
      type: 'surrender',
      description: 'Сдаться',
    })
  }

  appendCombatParticipantActions(game, playerId, actions)

  if (game.phase === 'actions' && game.activePlayerId === playerId) {
    const ownMarkers = game.actionMarkers.filter((m) => m.ownerId === playerId)
    if (mustResolveActionMarkerBeforeAdvance(game, playerId)) {
      return actions
        .filter((a) => a.id !== 'advance-phase')
        .concat({
          id: 'action-marker-unresolved',
          type: 'info',
          description: ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
        })
    }
    if (ownMarkers.length > 0 && game.actionMarkerResolvedThisTurn) {
      actions.push({
        id: 'action-marker-used',
        type: 'info',
        description: ACTION_MARKER_ALREADY_RESOLVED_MSG,
      })
    }
  }

  if (game.phase === 'production' && game.activePlayerId === playerId) {
    // legacy phase — игнорируем
  }

  return actions
}

/** Действия боя доступны участникам даже вне своего хода фазы. */
function appendCombatParticipantActions(
  game: GameSnapshot,
  playerId: string,
  actions: LegalAction[],
): void {
  const pending = game.pendingCombat
  if (!pending) return
  const me = game.players.find((p) => p.id === playerId)
  if (!me || me.eliminated) return

  const pushUnique = (action: LegalAction) => {
    if (!actions.some((candidate) => candidate.id === action.id)) actions.push(action)
  }

  if (pending.phase === 'prep') {
    const prep = combatPrepOf(pending)
    if (!prep) return
    const isAttacker = pending.attackerId === playerId
    const isDefender = prep.defenderId === playerId
    const preview = buildCombatPreviewFromPending(game)
    const isSupport = Boolean(
      preview?.supportCandidates?.some((candidate) => candidate.playerId === playerId),
    )
    if (!isAttacker && !isDefender && !isSupport) return
    if (pending.trigger === 'bombardment' && !isAttacker) return
    pushUnique({
      id: 'update-combat-prep',
      type: 'combat',
      description: 'Готовность к бою',
    })
    if (isAttacker && prep.siegeAvailable) {
      pushUnique({
        id: 'establish-siege',
        type: 'combat',
        description: 'Осадить центр власти вместо штурма',
      })
    }
    if (isAttacker && prep.siegeResponse) {
      pushUnique({
        id: 'cancel-combat-prep',
        type: 'combat',
        description: 'Не нападать на осаждающих',
      })
    }
    return
  }

  if (pending.phase === 'awaiting-continue') {
    const isAttacker = pending.attackerId === playerId
    const isDefender = pending.defenderIds.includes(playerId)
    if (!isAttacker && !isDefender) return
    pushUnique({
      id: 'continue-combat',
      type: 'combat',
      description: 'Продолжить бой',
    })
    pushUnique({
      id: 'stop-combat',
      type: 'combat',
      description: 'Отступить',
    })
  }
}

/**
 * Привести осады в соответствие доске и, если что-то изменилось, перепроверить победу:
 * гибель или уход гарнизона передаёт центр власти осаждающему.
 */
export function settleSieges(game: GameSnapshot, mapId: string): void {
  if (!game.sieges || game.gameOver) return
  const before = JSON.stringify(game.sieges)
  syncSieges(game)
  if (JSON.stringify(game.sieges ?? null) !== before) applyVictoryAndDefeatChecks(game, mapId)
}

export function applyGameActionOnSnapshot(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
): { errors: string[]; combatResult?: CombatResolutionResult } {
  const result = dispatchGameAction(game, map, playerId, actionId, params)
  settleSieges(game, map.id)
  return result
}

function dispatchGameAction(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
): { errors: string[]; combatResult?: CombatResolutionResult } {
  if (game.gameOver) return { errors: ['Игра завершена'] }

  if (actionId === 'surrender') {
    const errors = surrenderPlayer(game, map.id, playerId)
    if (!errors.length) syncEliminatedCombatAutomation(game)
    return { errors }
  }

  const isPrepAction =
    actionId === 'update-combat-prep'
    || actionId === 'cancel-combat-prep'
    || actionId === 'establish-siege'
  if (game.pendingCombat?.phase === 'prep' && !isPrepAction && actionId !== 'abort-combat') {
    return { errors: ['Ожидается подготовка к бою'] }
  }
  // Боевые решения может делать участник боя (победитель / attacker / defender),
  // а не только activePlayer текущей фазы.
  const isCombatDecisionAction =
    actionId === 'continue-combat'
    || actionId === 'stop-combat'
    || actionId === 'abort-combat'
  if (!isPrepAction && !isCombatDecisionAction && game.activePlayerId !== playerId) {
    return { errors: ['Сейчас ход другого игрока'] }
  }
  if (
    game.pendingCombat?.phase === 'awaiting-continue'
    && actionId !== 'continue-combat'
    && actionId !== 'stop-combat'
    && actionId !== 'abort-combat'
  ) {
    return { errors: ['Сначала завершите или продолжите текущий бой'] }
  }
  if (actionId === 'continue-combat') {
    const pending = game.pendingCombat
    const continuation = pending?.continuation
    const combatKey = pending?.cellKey
    const attackerId = pending?.attackerId
    const combatOptions = params?.combatOptions as CombatOptions | undefined
    const result = continuePendingCombat(game, playerId, combatOptions)
    if (
      result.errors.length === 0
      && (result.combatResult || result.combatVanished)
      && !game.pendingCombat
      && continuation
      && combatKey
      && attackerId
    ) {
      finishPendingMovementPlans(
        game,
        attackerId,
        continuation.movementFrom,
        continuation.movementPlans,
        result.combatResult ?? null,
        combatKey,
      )
    }
    applyVictoryAndDefeatChecks(game, map.id)
    return result
  }

  if (actionId === 'abort-combat') {
    const pending = game.pendingCombat
    const continuation = pending?.continuation
    const combatKey = pending?.cellKey
    const attackerId = pending?.attackerId
    const result = abortPendingCombat(game, playerId)
    // Прерывание тоже обязано дожать отложенное движение: иначе корабли
    // остаются на исходной клетке, а маркер действия — израсходованным.
    if (result.errors.length === 0 && continuation && combatKey && attackerId) {
      finishPendingMovementPlans(
        game,
        attackerId,
        continuation.movementFrom,
        continuation.movementPlans,
        { attackerWon: false },
        combatKey,
      )
    }
    applyVictoryAndDefeatChecks(game, map.id)
    return result
  }

  if (actionId === 'stop-combat') {
    const pending = game.pendingCombat
    const continuation = pending?.continuation
    const combatKey = pending?.cellKey
    const attackerRetreated = pending?.attackerId === playerId
    const retreatTo = params?.retreatTo as HexCoord | undefined
    const errors = stopPendingCombat(game, playerId, retreatTo)
    if (errors.length === 0 && continuation && combatKey) {
      finishPendingMovementPlans(
        game,
        pending!.attackerId,
        continuation.movementFrom,
        continuation.movementPlans,
        { attackerWon: !attackerRetreated },
        combatKey,
      )
    }
    applyVictoryAndDefeatChecks(game, map.id)
    return { errors }
  }

  if (actionId === 'establish-siege') {
    return { errors: establishSiege(game, map, playerId) }
  }

  if (actionId === 'update-combat-prep') {
    const ready = params?.ready
    const rawPriority = params?.targetPriority
    if (rawPriority != null && (!Array.isArray(rawPriority) || rawPriority.some((id) => typeof id !== 'string'))) {
      return { errors: ['Некорректный порядок целей'] }
    }
    const targetPriority = rawPriority as string[] | undefined
    const supportSide = params?.supportSide as 'attacker' | 'defender' | null | undefined
    if (typeof ready !== 'boolean') {
      return { errors: ['Некорректные параметры подготовки к бою'] }
    }
    if (supportSide != null && supportSide !== 'attacker' && supportSide !== 'defender') {
      return { errors: ['Некорректная сторона поддержки'] }
    }
    return updateCombatPrep(game, playerId, ready, targetPriority, supportSide)
  }

  if (actionId === 'cancel-combat-prep') {
    return cancelCombatPrep(game, playerId)
  }

  if (actionId === 'advance-phase') {
    return { errors: advanceGameSnapshot(game, map.id) }
  }

  if (actionId === 'resolve-event') {
    return { errors: completeEventsPhaseIfActive(game, map.id) }
  }

  if (actionId === 'execute-marker-movement') {
    const from = params?.from as HexCoord | undefined
    const moves = params?.moves as ShipMovePlan[] | undefined
    const combatOptions = params?.combatOptions as CombatOptions | undefined
    if (!from || !Array.isArray(moves)) return { errors: ['Некорректные параметры действия'] }
    const result = executeMarkerMovement(game, map, playerId, from, moves, combatOptions)
    return { errors: result.errors, combatResult: result.combatResult }
  }

  if (actionId === 'execute-marker-assault') {
    const from = params?.from as HexCoord | undefined
    const combatOptions = params?.combatOptions as CombatOptions | undefined
    if (!from) return { errors: ['Некорректные параметры действия'] }
    const result = executeMarkerAssault(game, map, playerId, from, combatOptions)
    return { errors: result.errors, combatResult: result.combatResult }
  }

  if (actionId === 'execute-siege-losses') {
    const shipIds = params?.shipIds
    if (shipIds == null) {
      autoResolveSiegeLosses(game, playerId)
      applyVictoryAndDefeatChecks(game, map.id)
      return { errors: [] }
    }
    if (!Array.isArray(shipIds) || shipIds.some((id) => typeof id !== 'string')) {
      return { errors: ['Некорректные параметры действия'] }
    }
    const errors = executeSiegeLosses(game, playerId, shipIds as string[])
    if (!errors.length) applyVictoryAndDefeatChecks(game, map.id)
    return { errors }
  }

  if (actionId === 'execute-marker-bombardment') {
    const from = params?.from as HexCoord | undefined
    const bombardments = params?.bombardments as BombardmentPlan[] | undefined
    const combatOptions = params?.combatOptions as CombatOptions | undefined
    if (!from || !Array.isArray(bombardments)) return { errors: ['Некорректные параметры действия'] }
    const result = executeMarkerBombardment(game, map, playerId, from, bombardments, combatOptions)
    return { errors: result.errors, combatResult: result.combatResult }
  }

  if (actionId === 'execute-production') {
    const markerId = params?.markerId as string | undefined
    const ships = (params?.ships as ShipPlacement[] | undefined) ?? []
    const spentTokens = params?.spentTokens as TokenSpendRef[] | undefined
    const buyActionMarkers = Math.max(0, Math.floor(Number(params?.buyActionMarkers ?? 0)))
    if (!markerId || !Array.isArray(ships)) {
      return { errors: ['Некорректные параметры действия'] }
    }
    if (buyActionMarkers > 0) {
      return { errors: ['Покупка маркеров действия отключена — лимит равен двум плюс число центров власти'] }
    }
    if (ships.length === 0) {
      return { errors: ['Некорректные параметры действия'] }
    }
    const plan: ProductionBatchPlan = { markerId, ships }
    return { errors: executeProductionBatch(game, map.id, playerId, plan, spentTokens) }
  }

  if (actionId === 'execute-buy-production-marker') {
    const spentTokens = params?.spentTokens as TokenSpendRef[] | undefined
    if (!Array.isArray(spentTokens) || spentTokens.length === 0) {
      return { errors: ['Некорректные параметры действия'] }
    }
    return { errors: executeBuyProductionMarker(game, map.id, playerId, spentTokens) }
  }

  if (actionId === 'execute-production-recharge') {
    const markerId = params?.markerId as string | undefined
    if (!markerId) return { errors: ['Некорректные параметры действия'] }
    return { errors: executeProductionRecharge(game, map.id, playerId, { markerId }) }
  }

  if (actionId === 'execute-claim-picks') {
    if (claimPicksRemaining(game, playerId) <= 0) {
      return { errors: [CLAIM_PICK_ERRORS.nothingOwed] }
    }
    const picks = params?.picks as HexCoord[] | undefined
    // Без списка клеток — законный пропуск выбора: движок берёт по приоритету,
    // центры власти и дорогие фишки первыми.
    if (picks === undefined || (Array.isArray(picks) && picks.length === 0)) {
      autoResolveClaimPicks(game, map.id, playerId)
      return { errors: [] }
    }
    if (!Array.isArray(picks)) return { errors: ['Некорректные параметры действия'] }
    return { errors: executeClaimPicks(game, map.id, playerId, picks) }
  }

  if (actionId === 'execute-recharge-picks') {
    if (rechargePicksRemaining(game, playerId) <= 0) {
      return { errors: [RECHARGE_PICK_ERRORS.nothingOwed] }
    }
    const picks = params?.picks as ResourceTokenRef[] | undefined
    // Без списка фишек — это пропуск выбора: движок поднимает самые крупные номиналы.
    // Так действие безопасно для ботов, таймаутов и простых клиентов.
    if (picks === undefined || (Array.isArray(picks) && picks.length === 0)) {
      autoResolveRechargePicks(game, playerId)
      return { errors: [] }
    }
    if (!Array.isArray(picks)) return { errors: ['Некорректные параметры действия'] }
    return { errors: executeRechargePicks(game, playerId, picks) }
  }

  if (actionId === 'toggle-marker') {
    const coord = params?.coord as HexCoord | undefined
    const kind = params?.kind as MarkerKind | undefined
    if (!coord || (kind !== 'action' && kind !== 'production')) {
      return { errors: ['Некорректные параметры действия'] }
    }
    return { errors: toggleMarkerAtCell(game, playerId, coord, map, kind) }
  }

  if (actionId === 'remove-marker') {
    const markerId = params?.markerId as string | undefined
    const kind = params?.kind as MarkerKind | undefined
    if (!markerId || (kind !== 'action' && kind !== 'production')) {
      return { errors: ['Некорректные параметры действия'] }
    }
    if (kind === 'action') return { errors: removeActionMarker(game, markerId, playerId) }
    return { errors: removeProductionMarker(game, markerId, playerId) }
  }

  return { errors: [`Неизвестное действие: ${actionId}`] }
}
