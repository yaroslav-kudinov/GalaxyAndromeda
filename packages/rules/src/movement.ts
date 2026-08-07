import { MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER, SHIP_LABELS } from './constants.js'
import { trimGameEventLog } from './event-log.js'
import { getCellKeys, hexDistance } from './map.js'
import {
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
  ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
  mustResolveActionMarkerBeforeAdvance,
  canExecuteActionMarkerThisTurn,
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
  removeProductionMarker,
  toggleMarkerAtCell,
  PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
  PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
  mustResolveProductionMarkerBeforeAdvance,
  type MarkerKind,
} from './markers.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import {
  executeProductionBatch,
  executeProductionRecharge,
  type ProductionBatchPlan,
  type ShipPlacement,
  type TokenSpendRef,
} from './production.js'
import {
  continueBombardmentQueueOrFinalize,
  executeMarkerBombardment,
  type BombardmentPlan,
} from './bombardment.js'
import {
  abortPendingCombat,
  applyCombatResultToSnapshot,
  beginOrAwaitCombatContinuation,
  buildCombatPreview,
  combatPrepOf,
  combatRoundStateOf,
  confirmCombatDestruction,
  continuePendingCombat,
  getCombatDestinationKeys,
  getCombatDestinationKeysFromMoves,
  isCombatDestination,
  resolveCombatAtCell,
  setupPendingCombatDestruction,
  setupCombatPrepForMovement,
  stopPendingCombat,
  updateCombatPrep,
  cancelCombatPrep,
  validateCombatOptions,
  validatePendingCombatPrepOptions,
  validateSingleCombatDestination,
  type CombatOptions,
  type CombatResolutionResult,
} from './combat.js'
import {
  ensureTurnEventForPhase,
  getEffectiveMoveRange,
  isMovementIntoCellBlocked,
  isTurnEventResolved,
  resolveTurnEvent,
} from './events.js'
import { getShipMoveRange } from './ships.js'
import { advanceGameSnapshot } from './turn.js'
import type { HexCoord, LegalAction, MapDefinition, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'
import { getLegalActions } from './game.js'
import { applyVictoryAndDefeatChecks } from './victory.js'

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
    if (move.declareControl) continue
    const ship = findShipOnBoard(game, move.shipId)
    if (!ship) continue
    total += 1
    if (ship.ownerId === playerId) player += 1
  }
  return { player, total }
}

export function getReachableHexKeys(
  map: MapDefinition,
  from: HexCoord,
  shipType: ShipType,
  game?: GameSnapshot,
): string[] {
  const range = game ? getEffectiveMoveRange(game, shipType) : getShipMoveRange(shipType)
  const fromKey = hexKey(from.q, from.r)
  const keys: string[] = []

  const candidateKeys = game?.cells.length
    ? game.cells.map((c) => hexKey(c.coord.q, c.coord.r))
    : [...getCellKeys(map)]

  for (const key of candidateKeys) {
    if (key === fromKey) continue
    const [q, r] = key.split(',').map(Number)
    const dist = hexDistance(from, { q, r })
    if (dist >= 1 && dist <= range) keys.push(key)
  }

  return keys
}

export function canDeclareControlForMove(
  game: GameSnapshot,
  ship: ShipUnit,
  dest: RuntimeCellState,
): boolean {
  return (
    ship.type === 'supply'
    && effectiveControlOwnerId(game, dest.controlOwnerId) === null
  )
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

  const dist = hexDistance(from, to)
  const range = game ? getEffectiveMoveRange(game, ship.type) : getShipMoveRange(ship.type)
  if (dist < 1) return ['Нужна соседняя или более дальняя клетка']
  if (dist > range) {
    return [`Дальность ${range}, расстояние ${dist}`]
  }

  if (game && isMovementIntoCellBlocked(game, dest, fromKey, toKey)) {
    return ['Местная самооборона: нельзя входить в клетку с ресурсами или энергоцентром']
  }

  if (effectiveControlOwnerId(game, dest.controlOwnerId) != null
    && effectiveControlOwnerId(game, dest.controlOwnerId) !== playerId) {
    if (!isCombatDestination(game, playerId, to)) {
      return ['Вражеская клетка — бой пока не реализован']
    }
    return errors
  }

  if (isCombatDestination(game, playerId, to)) {
    return errors
  }

  if (declareControl) {
    if (ship.type !== 'supply') errors.push('Контроль может объявить только корабль снабжения')
    if (effectiveControlOwnerId(game, dest.controlOwnerId) !== null) {
      errors.push('Клетка уже под контролем')
    }
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
      const rangeCandidates = getReachableHexKeys(map, from, ship.type, game)
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

  return errors
}

export interface MarkerActionExecution {
  errors: string[]
  combatResult?: CombatResolutionResult
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

    if (move.declareControl && canDeclareControlForMove(game, ship, destCell)) {
      destCell.controlOwnerId = playerId
      summaries.push(
        `${SHIP_LABELS[ship.type]} занял (${move.to.q},${move.to.r}), снят с карты`,
      )
    } else {
      destCell.ships.push(ship)
      summaries.push(`${SHIP_LABELS[ship.type]} → (${move.to.q},${move.to.r})`)
    }
  }

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (marker) removeActionMarker(game, marker.id, playerId)
  markActionMarkerResolvedThisTurn(game)

  return summaries
}

export function completePendingCombatMovement(
  game: GameSnapshot,
  mapId: string,
): string[] {
  const pending = combatRoundStateOf(game.pendingCombat)
  if (!pending?.movementFrom || !pending.movementPlans?.length) return []

  const combatKey = game.pendingCombat!.cellKey
  const summaries = finishPendingMovementPlans(
    game,
    game.pendingCombat!.attackerId,
    pending.movementFrom,
    pending.movementPlans,
    null,
    combatKey,
  )

  const combatNote = pending.attackerWon ? 'атакующий победил' : 'защитник победил'
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'movement',
    message: `Движение с (${pending.movementFrom.q},${pending.movementFrom.r}): ${summaries.join('; ') || '—'}; бой: ${combatNote}`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
  applyVictoryAndDefeatChecks(game, mapId)
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

      if (combatResult.needsDestructionSelection) {
        const skipTypes = {
          attacker: (combatOptions?.attacker?.prioritySkips ?? []).map((p) => p.shipType),
          defender: (combatOptions?.defender?.prioritySkips ?? []).map((p) => p.shipType),
        }
        setupPendingCombatDestruction(
          game,
          combatCoord,
          playerId,
          preview.defenderId,
          combatResult,
          combatOptions ?? {},
          skipTypes,
          'movement',
          {
            incomingAttackerShipIds: incomingShips.map((s) => s.id),
            movementFrom: from,
            movementPlans: moves,
            shipsDestroyedInCombat: false,
          },
        )
        return { errors: [], combatResult }
      }

      applyCombatResultToSnapshot(
        game,
        combatResult,
        playerId,
        preview.defenderId,
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
      })
      if (followUp.errors.length) {
        return { errors: followUp.errors, combatResult: combatResult ?? undefined }
      }
      // Бой продолжается (awaiting-*) или сразу брошен следующий раунд.
      if (game.pendingCombat || followUp.combatResult || followUp.combatVanished) {
        return {
          errors: [],
          combatResult: followUp.combatResult ?? combatResult ?? undefined,
        }
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

    if (move.declareControl && canDeclareControlForMove(game, ship, destCell)) {
      destCell.controlOwnerId = playerId
      summaries.push(
        `${SHIP_LABELS[ship.type]} занял (${move.to.q},${move.to.r}), снят с карты`,
      )
    } else {
      destCell.ships.push(ship)
      summaries.push(`${SHIP_LABELS[ship.type]} → (${move.to.q},${move.to.r})`)
    }
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
  if (!isBombardment && !(movementFrom && movementPlans)) {
    return { errors: ['Некорректное состояние подготовки боя'] }
  }

  // Подготовку снимаем только после успешного исполнения: иначе отказ execute
  // оставил бы игроков без экрана боя и без возможности повторить.
  game.pendingCombat = undefined

  const result = isBombardment
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

  return result
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
  if (game.phase === 'events') {
    ensureTurnEventForPhase(game)
  }
  const state = gameStateFromSnapshot(game, mapId)
  const actions = getLegalActions(state, playerId)

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
    const ownMarkers = game.productionMarkers.filter((m) => m.ownerId === playerId)
    if (mustResolveProductionMarkerBeforeAdvance(game, playerId)) {
      return actions
        .filter((a) => a.id !== 'advance-phase')
        .concat({
          id: 'production-marker-unresolved',
          type: 'info',
          description: PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
        })
    }
    if (ownMarkers.length > 0 && game.productionMarkerResolvedThisTurn) {
      actions.push({
        id: 'production-marker-used',
        type: 'info',
        description: PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
      })
    }
  }

  return actions
}

export function applyGameActionOnSnapshot(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  actionId: string,
  params?: Record<string, unknown>,
): { errors: string[]; combatResult?: CombatResolutionResult } {
  if (game.gameOver) return { errors: ['Игра завершена'] }

  const isPrepAction = actionId === 'update-combat-prep' || actionId === 'cancel-combat-prep'
  if (game.pendingCombat?.phase === 'prep' && !isPrepAction && actionId !== 'abort-combat') {
    return { errors: ['Ожидается подготовка к бою'] }
  }
  // Боевые решения может делать участник боя (победитель / attacker / defender),
  // а не только activePlayer текущей фазы.
  const isCombatDecisionAction =
    actionId === 'continue-combat'
    || actionId === 'stop-combat'
    || actionId === 'confirm-combat-destruction'
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
  if (
    game.pendingCombat?.phase === 'awaiting-destruction'
    && actionId !== 'confirm-combat-destruction'
    && actionId !== 'abort-combat'
  ) {
    return { errors: ['Сначала подтвердите выбор уничтожения в бою'] }
  }

  if (actionId === 'confirm-combat-destruction') {
    const destructionSelection = params?.destructionSelection as string[] | undefined
    if (!Array.isArray(destructionSelection)) {
      return { errors: ['Некорректные параметры выбора уничтожения'] }
    }
    const priorRoundState = combatRoundStateOf(game.pendingCombat)
    const movementFrom = priorRoundState?.movementFrom
    const movementPlans = priorRoundState?.movementPlans
    const bombardmentFrom = priorRoundState?.bombardmentFrom
    const bombardmentPlans = priorRoundState?.bombardmentPlans
    const queuedBombardmentPlans = priorRoundState?.queuedBombardmentPlans
    const combatTrigger = priorRoundState?.trigger ?? game.pendingCombat?.trigger
    const combatKey = game.pendingCombat?.cellKey
    const attackerId = game.pendingCombat?.attackerId

    const result = confirmCombatDestruction(game, playerId, destructionSelection)
    if (result.errors.length) return result

    // Если бой испарился, результата нет, но отложенное движение всё равно нужно
    // дожать — иначе корабли залипают на исходной клетке вместе с маркером.
    const combatSettled = !!result.combatResult || !!result.combatVanished

    if (
      !game.pendingCombat
      && movementFrom
      && movementPlans?.length
      && attackerId
      && combatSettled
    ) {
      finishPendingMovementPlans(
        game,
        attackerId,
        movementFrom,
        movementPlans,
        result.combatResult ?? null,
        combatKey,
      )
      game.eventLog.push({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        turn: game.turnNumber,
        phase: game.phase,
        type: 'movement',
        message: `Движение с (${movementFrom.q},${movementFrom.r}) после боя`,
        timestamp: Date.now(),
      })
      trimGameEventLog(game)
    } else if (
      combatTrigger === 'bombardment'
      && bombardmentFrom
      && bombardmentPlans?.length
      && attackerId
      && combatSettled
    ) {
      const queueResult = continueBombardmentQueueOrFinalize(
        game,
        attackerId,
        bombardmentFrom,
        bombardmentPlans,
        queuedBombardmentPlans,
        result.combatResult,
      )
      if (queueResult.errors.length) return { errors: queueResult.errors, combatResult: result.combatResult }
    }

    applyVictoryAndDefeatChecks(game, map.id)
    return result
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

  if (actionId === 'update-combat-prep') {
    const ready = params?.ready
    const prioritySkips = params?.prioritySkips as import('./combat.js').CombatPrioritySkipPlan[] | undefined
    const supportSide = params?.supportSide as 'attacker' | 'defender' | null | undefined
    if (typeof ready !== 'boolean') {
      return { errors: ['Некорректные параметры подготовки к бою'] }
    }
    if (supportSide != null && supportSide !== 'attacker' && supportSide !== 'defender') {
      return { errors: ['Некорректная сторона поддержки'] }
    }
    return updateCombatPrep(game, playerId, ready, prioritySkips, supportSide)
  }

  if (actionId === 'cancel-combat-prep') {
    return cancelCombatPrep(game, playerId)
  }

  if (actionId === 'advance-phase') {
    if (game.phase === 'events') {
      ensureTurnEventForPhase(game)
      if (!isTurnEventResolved(game)) {
        return { errors: resolveTurnEvent(game) }
      }
    }
    return { errors: advanceGameSnapshot(game, map.id) }
  }

  if (actionId === 'resolve-event') {
    ensureTurnEventForPhase(game)
    return { errors: resolveTurnEvent(game) }
  }

  if (actionId === 'execute-marker-movement') {
    const from = params?.from as HexCoord | undefined
    const moves = params?.moves as ShipMovePlan[] | undefined
    const combatOptions = params?.combatOptions as CombatOptions | undefined
    if (!from || !Array.isArray(moves)) return { errors: ['Некорректные параметры действия'] }
    const result = executeMarkerMovement(game, map, playerId, from, moves, combatOptions)
    return { errors: result.errors, combatResult: result.combatResult }
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
    const ships = params?.ships as ShipPlacement[] | undefined
    const spentTokens = params?.spentTokens as TokenSpendRef[] | undefined
    if (!markerId || !Array.isArray(ships) || ships.length === 0) {
      return { errors: ['Некорректные параметры действия'] }
    }
    const plan: ProductionBatchPlan = { markerId, ships }
    return { errors: executeProductionBatch(game, map.id, playerId, plan, spentTokens) }
  }

  if (actionId === 'execute-production-recharge') {
    const markerId = params?.markerId as string | undefined
    if (!markerId) return { errors: ['Некорректные параметры действия'] }
    return { errors: executeProductionRecharge(game, map.id, playerId, { markerId }) }
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
