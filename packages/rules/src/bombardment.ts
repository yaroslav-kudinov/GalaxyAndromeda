import {
  applyCombatResultToSnapshot,
  buildCombatPreview,
  collectSupportShips,
  getEffectiveFireRangeBounds,
  isBombardmentDestination,
  resolveCombatAtCell,
  setupCombatPrepForBombardment,
  validateCombatOptions,
  type CombatOptions,
  type CombatPreview,
} from './combat.js'
import { canShipFireFromDistance, hitProbability, SHIP_HULL } from './combat-hits.js'
import { hexDistance } from './map.js'
import {
  canExecuteActionMarkerThisTurn,
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
} from './markers.js'
import { SHIP_LABELS } from './constants.js'
import { trimGameEventLog } from './event-log.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import type { HexCoord, MapDefinition, ShipType, ShipUnit } from './types.js'
import { hexKey } from './types.js'

export interface BombardmentExecution {
  errors: string[]
  combatResult?: import('./combat.js').CombatResolutionResult
}

export interface BombardmentPlan {
  shipId: string
  target: HexCoord
}

export interface BombardableShipOption {
  ship: ShipUnit
  fireRange: number
  /** Оспариваемые клетки в пределах fireRange */
  targetKeys: string[]
  disabledReason?: string
}

/** Обстреливать может тот, кто достаёт дальше своей клетки: эсминцу нужна шестёрка уже в упор. */
export function canShipBombard(type: ShipType): boolean {
  return canShipFireFromDistance(type)
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

export function getBombardmentTargetKeys(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  shipType: ShipType,
): string[] {
  const bounds = getEffectiveFireRangeBounds(game, shipType, playerId)
  if (bounds.max <= 0 || !canShipBombard(shipType)) return []
  const min = Math.max(1, bounds.min)
  const keys: string[] = []
  for (const cell of game.cells) {
    const dist = hexDistance(from, cell.coord)
    if (dist < min || dist > bounds.max) continue
    if (!isBombardmentDestination(game, playerId, cell.coord)) continue
    keys.push(hexKey(cell.coord.q, cell.coord.r))
  }
  return keys
}

export function getBombardableShipsAtMarker(
  game: GameSnapshot,
  _map: MapDefinition,
  playerId: string,
  from: HexCoord,
): BombardableShipOption[] {
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
      const fireRange = getEffectiveFireRangeBounds(game, ship.type, playerId).max
      const targetKeys = canShipBombard(ship.type)
        ? getBombardmentTargetKeys(game, playerId, from, ship.type)
        : []

      let disabledReason: string | undefined
      if (!canShipBombard(ship.type)) {
        disabledReason = 'Этот корабль не может обстреливать'
      } else if (targetKeys.length === 0) {
        disabledReason = 'Нет целей обстрела в радиусе'
      }

      return { ship, fireRange, targetKeys, disabledReason }
    })
}

export function validateBombardmentTarget(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  ship: ShipUnit,
  target: HexCoord,
): string[] {
  const errors: string[] = []
  const fromKey = hexKey(from.q, from.r)
  const toKey = hexKey(target.q, target.r)

  if (!canShipBombard(ship.type)) {
    errors.push(`${SHIP_LABELS[ship.type]} не может обстреливать`)
    return errors
  }

  const dest = cellAt(game, target)
  if (!dest) errors.push(`Клетка ${toKey} вне карты`)

  const dist = hexDistance(from, target)
  const bounds = getEffectiveFireRangeBounds(game, ship.type, playerId)
  if (dist < Math.max(1, bounds.min)) {
    errors.push(
      bounds.min > 1
        ? `${SHIP_LABELS[ship.type]} не может обстреливать на расстоянии ${dist} (минимум ${bounds.min})`
        : 'Нельзя обстреливать свою клетку',
    )
  }
  if (dist > bounds.max) {
    errors.push(`Дальность обстрела ${bounds.max}, расстояние ${dist}`)
  }

  if (!isBombardmentDestination(game, playerId, target)) {
    errors.push('Обстрел только по оспариваемой клетке')
  }

  const shipInfo = findShipOnBoard(game, ship.id)
  if (!shipInfo) {
    errors.push(`Корабль ${ship.id} не найден`)
  } else if (shipInfo.cellKey !== fromKey) {
    errors.push(`Корабль ${ship.id} не на исходной клетке`)
  }

  return errors
}

export function validateMarkerBombardment(
  game: GameSnapshot,
  _map: MapDefinition,
  playerId: string,
  from: HexCoord,
  plans: BombardmentPlan[],
): string[] {
  if (game.phase !== 'actions') return ['Обстрел только в фазе «Действия»']
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (game.actionMarkerResolvedThisTurn) {
    return ['За этот ход в фазе «Действия» можно исполнить только один маркер действия']
  }

  const fromCell = cellAt(game, from)
  if (!fromCell) return [`Клетка ${hexKey(from.q, from.r)} не найдена`]

  const marker = game.actionMarkers.find(
    (m) =>
      m.ownerId === playerId && hexKey(m.coord.q, m.coord.r) === hexKey(from.q, from.r),
  )
  if (!marker) return ['На клетке нет вашего маркера действия']
  if (plans.length === 0) return ['Выберите хотя бы один корабль для обстрела']

  const errors: string[] = []
  const seenShipIds = new Set<string>()

  for (const plan of plans) {
    if (seenShipIds.has(plan.shipId)) {
      errors.push(`Корабль ${plan.shipId} указан дважды`)
      continue
    }
    seenShipIds.add(plan.shipId)

    const shipInfo = findShipOnBoard(game, plan.shipId)
    if (!shipInfo) {
      errors.push(`Корабль ${plan.shipId} не найден`)
      continue
    }
    if (shipInfo.ownerId !== playerId) {
      errors.push(`Корабль ${plan.shipId} не ваш`)
      continue
    }

    errors.push(
      ...validateBombardmentTarget(game, playerId, from, shipInfo, plan.target),
    )
  }

  return errors
}

export function groupBombardmentPlansByTarget(
  plans: BombardmentPlan[],
): BombardmentPlan[][] {
  const groups = new Map<string, BombardmentPlan[]>()
  for (const plan of plans) {
    const key = hexKey(plan.target.q, plan.target.r)
    const list = groups.get(key) ?? []
    list.push({ shipId: plan.shipId, target: { ...plan.target } })
    groups.set(key, list)
  }
  return [...groups.values()]
}

/**
 * Превью обстрела: корабли не входят в клетку и стреляют с расстояния — каждая клетка
 * прибавляет 1 к нужному значению. Защитник не отвечает. Бой из одного залпа.
 */
export function buildBombardmentPreview(
  game: GameSnapshot,
  target: HexCoord,
  attackerId: string,
  bombardingShips: ShipUnit[],
  fromCoord: HexCoord,
): CombatPreview | null {
  const base = buildCombatPreview(game, target, attackerId, [], { forBombardment: true })
  if (!base) return null

  const selected = new Set(
    bombardingShips.filter((s) => s.ownerId === attackerId && canShipBombard(s.type)).map((s) => s.id),
  )
  const supportingShips = collectSupportShips(
    game,
    target,
    attackerId,
    new Set(),
    undefined,
    base.defenderId,
  ).filter((s) => selected.has(s.shipId))
  const diceTotal = supportingShips.reduce((sum, s) => sum + s.dice, 0)
  const expectedHits = supportingShips.reduce(
    (sum, s) => sum + s.dice * hitProbability(s.threshold),
    0,
  )

  return {
    ...base,
    trigger: 'bombardment',
    attacker: {
      ...base.attacker,
      ships: [],
      supportingShips,
      diceTotal,
      expectedHits,
    },
    defender: {
      ...base.defender,
      // Под обстрелом корабль держит обычную прочность: слабость гиперорудия — только в бою.
      ships: base.defender.ships.map((ship) => ({ ...ship, hull: SHIP_HULL[ship.type] ?? ship.hull })),
      supportingShips: [],
      diceTotal: 0,
      expectedHits: 0,
    },
    notes: [
      'Обстрел: корабли не входят в клетку и стреляют с расстояния.',
      'Каждая клетка расстояния прибавляет 1 к нужному на кубике значению.',
      'Защитник не отвечает; один залп.',
      `Кубиков обстрела: ${diceTotal} с (${fromCoord.q}, ${fromCoord.r}).`,
    ],
  }
}

export function finalizeMarkerBombardment(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  plans: BombardmentPlan[],
  combatResult?: import('./combat.js').CombatResolutionResult,
): void {
  const summaries: string[] = []
  for (const plan of plans) {
    const ship = findShipOnBoard(game, plan.shipId)
    if (!ship) continue
    summaries.push(
      `${SHIP_LABELS[ship.type]} обстреливает (${plan.target.q},${plan.target.r})`,
    )
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
    message: `Обстрел с (${from.q},${from.r}): ${summaries.join('; ')}${combatNote}`,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

/** После одной цели: следующий prep из очереди или финализация маркера */
export function continueBombardmentQueueOrFinalize(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  completedPlans: BombardmentPlan[],
  queued: BombardmentPlan[] | undefined,
  combatResult?: import('./combat.js').CombatResolutionResult,
): BombardmentExecution {
  if (queued?.length) {
    const groups = groupBombardmentPlansByTarget(queued)
    const next = groups[0]!
    const rest = groups.slice(1).flat()
    const errors = setupCombatPrepForBombardment(
      game,
      from,
      next,
      playerId,
      next[0]!.target,
      rest,
    )
    return { errors, combatResult }
  }
  finalizeMarkerBombardment(game, playerId, from, completedPlans, combatResult)
  return { errors: [], combatResult }
}

export function executeMarkerBombardment(
  game: GameSnapshot,
  map: MapDefinition,
  playerId: string,
  from: HexCoord,
  plans: BombardmentPlan[],
  combatOptions?: CombatOptions,
  queuedBombardmentPlans: BombardmentPlan[] = [],
): BombardmentExecution {
  const errors = validateMarkerBombardment(game, map, playerId, from, plans)
  if (errors.length) return { errors }

  const groups = groupBombardmentPlansByTarget(plans)
  const currentPlans = groups[0]!
  const queuedFromPlans = groups.slice(1).flat()
  const queued = [...queuedFromPlans, ...queuedBombardmentPlans]
  const target = currentPlans[0]!.target
  const fromCell = cellAt(game, from)!
  const bombardingShips = currentPlans
    .map((p) => fromCell.ships.find((s) => s.id === p.shipId))
    .filter((s): s is ShipUnit => !!s)

  let combatResult: import('./combat.js').CombatResolutionResult | null = null
  const preview = buildBombardmentPreview(game, target, playerId, bombardingShips, from)
  if (preview) {
    if (!combatOptions) {
      const prepErrors = setupCombatPrepForBombardment(
        game,
        from,
        currentPlans,
        playerId,
        target,
        queued,
      )
      return { errors: prepErrors }
    }

    const optionErrors = validateCombatOptions(game, preview, [], combatOptions)
    if (optionErrors.length) return { errors: optionErrors }

    combatResult = resolveCombatAtCell(
      game,
      target,
      playerId,
      [],
      combatOptions,
      Math.random,
      preview,
    )

    applyCombatResultToSnapshot(game, combatResult, playerId, preview.defenderId, {
      transferControl: false,
    })
  }

  return continueBombardmentQueueOrFinalize(
    game,
    playerId,
    from,
    currentPlans,
    queued,
    combatResult ?? undefined,
  )
}
