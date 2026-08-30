import {
  MAX_FLEET_SIZE_PER_PLAYER,
  MAX_SHIPS_PER_CELL,
  MAX_SHIPS_PER_CELL_PER_PLAYER,
  SHIP_LABELS,
} from './constants.js'
import { trimGameEventLog } from './event-log.js'
import {
  getEffectiveTokenValue,
  isShipTypeBuildBlocked,
} from './events.js'
import {
  markActionMarkerResolvedThisTurn,
  removeActionMarker,
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
} from './markers.js'
import { buildSpatialSummary } from './observation/ascii-map.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import {
  canBuildShipInRegionSize,
  getShipProductionCost,
  getShipProductionRegionMin,
  SHIP_PRODUCTION_COST,
} from './ships.js'
import { applyVictoryAndDefeatChecks } from './victory.js'
import type { HexCoord, ResourceTokenDef, ShipType } from './types.js'
import { hexKey } from './types.js'

export interface TokenSpendRef {
  coord: HexCoord
  tokenIndex: number
}

export interface ShipPlacement {
  type: ShipType
  coord: HexCoord
}

export interface ProductionBatchPlan {
  markerId: string
  ships: ShipPlacement[]
  /** @deprecated Покупка AM отключена; если > 0 — ошибка. */
  buyActionMarkers?: number
}

export interface ProductionRechargePlan {
  markerId: string
}

/** @deprecated Use ProductionBatchPlan for new code */
export interface ProductionBuildPlan {
  markerId: string
  shipType: ShipType
  spentTokens: TokenSpendRef[]
}

export interface BuildableShipOption {
  type: ShipType
  cost: { credits: number; production: number }
  maxCount: number
  disabledReason?: string
  fleetCount: number
  fleetMax: number
  fleetRemaining: number
}

export interface RegionResourceSummary {
  faceUpCredits: number
  faceUpProduction: number
  faceDownCreditsCount: number
  faceDownProductionCount: number
}

export interface RegionTokenOption {
  coord: HexCoord
  tokenIndex: number
  token: ResourceTokenDef
  key: string
}

function cellAt(game: GameSnapshot, coord: HexCoord): RuntimeCellState | undefined {
  const key = hexKey(coord.q, coord.r)
  return game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
}

export interface ProductionAnchor {
  id: string
  ownerId: string
  coord: HexCoord
}

function findActionMarkerForProduction(
  game: GameSnapshot,
  markerId: string,
  playerId: string,
): ProductionAnchor | null {
  const marker = game.actionMarkers.find((m) => m.id === markerId && m.ownerId === playerId)
  return marker ?? null
}

export function getRegionForMarker(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
): { id: string; size: number; hexes: string[] } | null {
  const state = gameStateFromSnapshot(game, mapId)
  const summary = buildSpatialSummary(state)
  const markerKey = hexKey(marker.coord.q, marker.coord.r)
  const region = summary.regions.find(
    (r) => r.ownerId === marker.ownerId && r.hexes.includes(markerKey),
  )
  if (!region) return null
  return { id: region.id, size: region.size, hexes: region.hexes }
}

export function tokenSpendKey(coord: HexCoord, tokenIndex: number): string {
  return `${hexKey(coord.q, coord.r)}:${tokenIndex}`
}

export function parseTokenSpendKey(key: string): { coord: HexCoord; tokenIndex: number } | null {
  const match = /^(-?\d+),(-?\d+):(\d+)$/.exec(key)
  if (!match) return null
  return {
    coord: { q: Number(match[1]), r: Number(match[2]) },
    tokenIndex: Number(match[3]),
  }
}

function iterRegionCells(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
): RuntimeCellState[] {
  const region = getRegionForMarker(game, mapId, marker)
  if (!region) return []
  const cells: RuntimeCellState[] = []
  for (const hex of region.hexes) {
    const [q, r] = hex.split(',').map(Number)
    const cell = cellAt(game, { q, r })
    if (cell && cell.controlOwnerId === marker.ownerId) cells.push(cell)
  }
  return cells
}

export function getRegionResourceSummary(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
): RegionResourceSummary {
  const region = getRegionForMarker(game, mapId, marker)
  if (!region) {
    return {
      faceUpCredits: 0,
      faceUpProduction: 0,
      faceDownCreditsCount: 0,
      faceDownProductionCount: 0,
    }
  }

  let faceUpCredits = 0
  let faceUpProduction = 0
  let faceDownCreditsCount = 0
  let faceDownProductionCount = 0

  for (const cell of iterRegionCells(game, mapId, marker)) {
    for (const token of cell.resourceTokens) {
      const effective = getEffectiveTokenValue(game, token.value)
      if (token.type === 'credits') {
        if (token.faceUp === false) faceDownCreditsCount += 1
        else faceUpCredits += effective
      } else if (token.type === 'production') {
        if (token.faceUp === false) faceDownProductionCount += 1
        else faceUpProduction += effective
      }
    }
  }

  return {
    faceUpCredits,
    faceUpProduction,
    faceDownCreditsCount,
    faceDownProductionCount,
  }
}

export function needsProductionTokenChoice(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
): boolean {
  const summary = getRegionResourceSummary(game, mapId, marker)
  return (
    summary.faceUpProduction > 0
    && (summary.faceDownCreditsCount > 0 || summary.faceDownProductionCount > 0)
  )
}

export function getRegionTokensForMarker(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
): RegionTokenOption[] {
  const region = getRegionForMarker(game, mapId, marker)
  if (!region) return []

  const options: RegionTokenOption[] = []
  for (const cell of iterRegionCells(game, mapId, marker)) {
    cell.resourceTokens.forEach((token, tokenIndex) => {
      if (token.faceUp === false) return
      options.push({
        coord: cell.coord,
        tokenIndex,
        token: { ...token },
        key: tokenSpendKey(cell.coord, tokenIndex),
      })
    })
  }
  return options
}

function countPlayerShipsAt(cell: RuntimeCellState, playerId: string): number {
  return cell.ships.filter((s) => s.ownerId === playerId).length
}

/** Count player's ships on the map, optionally filtered by ship type */
export function countShipsForPlayer(
  game: GameSnapshot,
  ownerId: string,
  type?: ShipType,
): number {
  let total = 0
  for (const cell of game.cells) {
    for (const ship of cell.ships) {
      if (ship.ownerId !== ownerId) continue
      if (type != null && ship.type !== type) continue
      total += 1
    }
  }
  return total
}

export function getFleetLimitWarnings(game: GameSnapshot): string[] {
  const warnings: string[] = []
  const players = new Set(game.players.map((p) => p.id))

  for (const playerId of players) {
    for (const type of Object.keys(MAX_FLEET_SIZE_PER_PLAYER) as ShipType[]) {
      const count = countShipsForPlayer(game, playerId, type)
      const max = MAX_FLEET_SIZE_PER_PLAYER[type]
      if (count > max) {
        warnings.push(
          `Игрок ${playerId}: ${count} ${SHIP_LABELS[type]} на карте (лимит ${max})`,
        )
      }
    }
  }

  return warnings
}

function countIncomingPlacements(
  placements: ShipPlacement[],
  destKey: string,
  _playerId: string,
  _game: GameSnapshot,
): { player: number; total: number } {
  let player = 0
  let total = 0
  for (const placement of placements) {
    if (hexKey(placement.coord.q, placement.coord.r) !== destKey) continue
    total += 1
    player += 1
  }
  return { player, total }
}

export function regionPlacementCapacity(
  game: GameSnapshot,
  _mapId: string,
  marker: ProductionAnchor,
  pendingPlacements: ShipPlacement[] = [],
): number {
  const cell = cellAt(game, marker.coord)
  if (!cell || cell.controlOwnerId !== marker.ownerId) return 0

  const key = hexKey(marker.coord.q, marker.coord.r)
  const incoming = countIncomingPlacements(pendingPlacements, key, marker.ownerId, game)
  const playerShips = countPlayerShipsAt(cell, marker.ownerId) + incoming.player
  const allShips = cell.ships.length + incoming.total
  const playerSlots = MAX_SHIPS_PER_CELL_PER_PLAYER - playerShips
  const cellSlots = MAX_SHIPS_PER_CELL - allShips
  return Math.max(0, Math.min(playerSlots, cellSlots))
}

export function getBuildableShipsForMarker(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  markerId: string,
): BuildableShipOption[] {
  const marker = findActionMarkerForProduction(game, markerId, playerId)
  if (!marker) return []

  const region = getRegionForMarker(game, mapId, marker)
  const summary = getRegionResourceSummary(game, mapId, marker)
  const placementCap = regionPlacementCapacity(game, mapId, marker)

  return (Object.keys(SHIP_PRODUCTION_COST) as ShipType[]).map((type) => {
    const cost = getShipProductionCost(type)
    const fleetMax = MAX_FLEET_SIZE_PER_PLAYER[type]
    const fleetCount = countShipsForPlayer(game, playerId, type)
    const fleetRemaining = Math.max(0, fleetMax - fleetCount)
    let disabledReason: string | undefined
    let maxCount = 0

    if (!region) {
      disabledReason = 'Регион маркера не найден'
    } else if (isShipTypeBuildBlocked(game, type)) {
      disabledReason = 'Событие хода запрещает постройку этого класса'
    } else if (fleetRemaining < 1) {
      disabledReason = `Лимит флота: ${fleetMax} ${SHIP_LABELS[type]} (на карте ${fleetCount})`
    } else if (!canBuildShipInRegionSize(type, region.size)) {
      const min = getShipProductionRegionMin(type)
      disabledReason = `Нужен регион от ${min} клеток (сейчас ${region.size})`
    } else if (summary.faceUpCredits < cost.credits || summary.faceUpProduction < cost.production) {
      if (summary.faceUpCredits < cost.credits) {
        disabledReason = `Не хватает кредитов (нужно ${cost.credits})`
      } else {
        disabledReason = `Не хватает производства (нужно ${cost.production})`
      }
    } else if (placementCap < 1) {
      disabledReason = 'В регионе нет свободных слотов для кораблей'
    } else {
      const byCredits = Math.floor(summary.faceUpCredits / cost.credits)
      const byProduction = Math.floor(summary.faceUpProduction / cost.production)
      maxCount = Math.min(byCredits, byProduction, placementCap, fleetRemaining)
      if (maxCount < 1) {
        disabledReason = 'Недостаточно ресурсов или места для постройки'
        maxCount = 0
      }
    }

    return { type, cost, maxCount, disabledReason, fleetCount, fleetMax, fleetRemaining }
  })
}

function tokenAt(game: GameSnapshot, ref: TokenSpendRef): ResourceTokenDef | null {
  const cell = cellAt(game, ref.coord)
  const token = cell?.resourceTokens[ref.tokenIndex]
  if (!token || token.faceUp === false) return null
  return token
}

function validateMarkerResolutionPreconditions(
  game: GameSnapshot,
  playerId: string,
  markerId: string,
): { marker: ProductionAnchor } | string[] {
  if (game.phase !== 'actions') return ['Постройка только в фазе «Действия»']
  if (game.activePlayerId !== playerId) return ['Сейчас ход другого игрока']
  if (game.actionMarkerResolvedThisTurn) return [ACTION_MARKER_ALREADY_RESOLVED_MSG]

  const marker = findActionMarkerForProduction(game, markerId, playerId)
  if (!marker) return ['Маркер действия не найден']

  const cell = cellAt(game, marker.coord)
  if (!cell?.actionMarkerId || cell.actionMarkerId !== marker.id) {
    return ['На клетке нет этого маркера действия']
  }

  return { marker }
}

export function validateTokenPayment(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  marker: ProductionAnchor,
  creditsNeeded: number,
  productionNeeded: number,
  spentTokens: TokenSpendRef[],
): string[] {
  const errors: string[] = []
  const region = getRegionForMarker(game, mapId, marker)
  if (!region) return ['Регион маркера не найден']

  const regionHexSet = new Set(region.hexes)
  const seen = new Set<string>()
  let credits = 0
  let production = 0

  for (const ref of spentTokens) {
    const key = tokenSpendKey(ref.coord, ref.tokenIndex)
    if (seen.has(key)) {
      errors.push('Одна фишка указана дважды')
      continue
    }
    seen.add(key)

    const hex = hexKey(ref.coord.q, ref.coord.r)
    if (!regionHexSet.has(hex)) {
      errors.push(`Фишка вне региона маркера (${ref.coord.q}, ${ref.coord.r})`)
      continue
    }

    const cell = cellAt(game, ref.coord)
    if (!cell || cell.controlOwnerId !== playerId) {
      errors.push(`Нет доступа к фишке (${ref.coord.q}, ${ref.coord.r})`)
      continue
    }

    const token = tokenAt(game, ref)
    if (!token) {
      errors.push(`Фишка (${ref.coord.q}, ${ref.coord.r}) недоступна`)
      continue
    }

    if (token.type === 'credits') credits += getEffectiveTokenValue(game, token.value)
    else production += getEffectiveTokenValue(game, token.value)
  }

  if (credits < creditsNeeded) {
    errors.push(`Не хватает кредитов: ${credits}/${creditsNeeded}`)
  }
  if (production < productionNeeded) {
    errors.push(`Не хватает производства: ${production}/${productionNeeded}`)
  }

  return errors
}

function batchResourceTotals(
  ships: ShipPlacement[],
): { credits: number; production: number } {
  let credits = 0
  let production = 0
  for (const ship of ships) {
    const cost = getShipProductionCost(ship.type)
    credits += cost.credits
    production += cost.production
  }
  return { credits, production }
}

export function autoAllocateTokens(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
  creditsNeeded: number,
  productionNeeded: number,
): TokenSpendRef[] | null {
  const tokens = getRegionTokensForMarker(game, mapId, marker)
  const creditTokens = tokens
    .filter((t) => t.token.type === 'credits')
    .sort((a, b) => b.token.value - a.token.value)
  const productionTokens = tokens
    .filter((t) => t.token.type === 'production')
    .sort((a, b) => b.token.value - a.token.value)

  const selected: TokenSpendRef[] = []
  let credits = 0
  let production = 0

  for (const t of creditTokens) {
    if (credits >= creditsNeeded) break
    selected.push({ coord: t.coord, tokenIndex: t.tokenIndex })
    credits += getEffectiveTokenValue(game, t.token.value)
  }
  for (const t of productionTokens) {
    if (production >= productionNeeded) break
    selected.push({ coord: t.coord, tokenIndex: t.tokenIndex })
    production += getEffectiveTokenValue(game, t.token.value)
  }

  if (credits < creditsNeeded || production < productionNeeded) return null
  return selected
}

export function validateShipPlacements(
  game: GameSnapshot,
  mapId: string,
  marker: ProductionAnchor,
  ships: ShipPlacement[],
): string[] {
  const errors: string[] = []
  const region = getRegionForMarker(game, mapId, marker)
  if (!region) return ['Регион маркера не найден']

  const regionHexSet = new Set(region.hexes)
  const buildable = getBuildableShipsForMarker(game, mapId, marker.ownerId, marker.id)
  const countsByType = new Map<ShipType, number>()

  for (const ship of ships) {
    countsByType.set(ship.type, (countsByType.get(ship.type) ?? 0) + 1)
  }

  for (const [type, count] of countsByType) {
    const option = buildable.find((o) => o.type === type)
    if (!option) {
      errors.push(`Неизвестный тип корабля: ${type}`)
      continue
    }
    const fleetMax = MAX_FLEET_SIZE_PER_PLAYER[type]
    const fleetCount = countShipsForPlayer(game, marker.ownerId, type)
    if (fleetCount + count > fleetMax) {
      errors.push(
        `${SHIP_LABELS[type]}: лимит флота ${fleetMax} (на карте ${fleetCount}, в заявке ${count})`,
      )
      continue
    }
    if (option.disabledReason) {
      errors.push(`${SHIP_LABELS[type]}: ${option.disabledReason}`)
      continue
    }
    if (count > option.maxCount) {
      errors.push(`${SHIP_LABELS[type]}: максимум ${option.maxCount}, выбрано ${count}`)
    }
  }

  if (ships.length > regionPlacementCapacity(game, mapId, marker)) {
    errors.push('Недостаточно свободных слотов в регионе для всех кораблей')
  }

  const prior: ShipPlacement[] = []
  const markerKey = hexKey(marker.coord.q, marker.coord.r)
  for (const ship of ships) {
    const hex = hexKey(ship.coord.q, ship.coord.r)
    if (hex !== markerKey) {
      errors.push(
        `Корабль можно поставить только на клетку маркера (${marker.coord.q}, ${marker.coord.r})`,
      )
      continue
    }
    if (!regionHexSet.has(hex)) {
      errors.push(`Клетка (${ship.coord.q}, ${ship.coord.r}) вне региона маркера`)
      continue
    }

    const cell = cellAt(game, ship.coord)
    if (!cell || cell.controlOwnerId !== marker.ownerId) {
      errors.push(`Нет контроля над клеткой (${ship.coord.q}, ${ship.coord.r})`)
      continue
    }

    const destKey = hexKey(ship.coord.q, ship.coord.r)
    const incoming = countIncomingPlacements(prior, destKey, marker.ownerId, game)
    const playerShips = countPlayerShipsAt(cell, marker.ownerId) + incoming.player
    const allShips = cell.ships.length + incoming.total

    if (playerShips >= MAX_SHIPS_PER_CELL_PER_PLAYER) {
      errors.push(
        `Не более ${MAX_SHIPS_PER_CELL_PER_PLAYER} ваших кораблей на (${ship.coord.q}, ${ship.coord.r})`,
      )
    } else if (allShips >= MAX_SHIPS_PER_CELL) {
      errors.push(`Не более ${MAX_SHIPS_PER_CELL} кораблей на (${ship.coord.q}, ${ship.coord.r})`)
    }

    if (!canBuildShipInRegionSize(ship.type, region.size)) {
      const min = getShipProductionRegionMin(ship.type)
      errors.push(`${SHIP_LABELS[ship.type]} требует регион от ${min} клеток`)
    }

    prior.push(ship)
  }

  return errors
}

const ACTION_MARKER_BUY_DISABLED_MSG =
  'Покупка маркеров действия отключена — лимит равен три плюс число центров власти'

export function validateProductionBatch(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  plan: ProductionBatchPlan,
  spentTokens?: TokenSpendRef[],
): string[] {
  const pre = validateMarkerResolutionPreconditions(game, playerId, plan.markerId)
  if (Array.isArray(pre)) return pre
  const { marker } = pre

  const buyCount = Math.max(0, Math.floor(plan.buyActionMarkers ?? 0))
  if (buyCount > 0) return [ACTION_MARKER_BUY_DISABLED_MSG]
  if (!plan.ships.length) {
    return ['Не выбрано ни одного корабля']
  }

  const placementErrors = validateShipPlacements(game, mapId, marker, plan.ships)
  if (placementErrors.length) return placementErrors

  const totals = batchResourceTotals(plan.ships)
  const tokens =
    spentTokens ??
    autoAllocateTokens(game, mapId, marker, totals.credits, totals.production)
  if (!tokens) return ['Не удалось автоматически распределить фишки оплаты']

  return validateTokenPayment(
    game,
    mapId,
    playerId,
    marker,
    totals.credits,
    totals.production,
    tokens,
  )
}

export function executeProductionBatch(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  plan: ProductionBatchPlan,
  spentTokens?: TokenSpendRef[],
): string[] {
  const buyCount = Math.max(0, Math.floor(plan.buyActionMarkers ?? 0))
  if (buyCount > 0) return [ACTION_MARKER_BUY_DISABLED_MSG]
  const totals = batchResourceTotals(plan.ships)
  const pre = validateMarkerResolutionPreconditions(game, playerId, plan.markerId)
  if (Array.isArray(pre)) return pre
  const { marker } = pre

  const tokens =
    spentTokens ??
    autoAllocateTokens(game, mapId, marker, totals.credits, totals.production)
  if (!tokens) return ['Не удалось автоматически распределить фишки оплаты']

  const errors = validateProductionBatch(game, mapId, playerId, plan, tokens)
  if (errors.length) return errors

  for (const ref of tokens) {
    const cell = cellAt(game, ref.coord)
    const token = cell?.resourceTokens[ref.tokenIndex]
    if (token) token.faceUp = false
  }

  const labels: string[] = []
  for (const ship of plan.ships) {
    const destCell = cellAt(game, ship.coord)!
    destCell.ships.push({
      id: `ship-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: ship.type,
      ownerId: playerId,
    })
    labels.push(`${SHIP_LABELS[ship.type]}@(${ship.coord.q},${ship.coord.r})`)
  }

  removeActionMarker(game, marker.id, playerId)
  markActionMarkerResolvedThisTurn(game)

  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'production',
    message: labels.length ? `Построено: ${labels.join(', ')}` : 'Постройка по маркеру действия',
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
  applyVictoryAndDefeatChecks(game, mapId)

  return []
}

export function validateProductionRecharge(
  _game: GameSnapshot,
  _mapId: string,
  _playerId: string,
  _plan: ProductionRechargePlan,
): string[] {
  return ['Перезарядка фишек выполняется автоматически через случайный интервал один, два или три полных хода']
}

export function executeProductionRecharge(
  _game: GameSnapshot,
  _mapId: string,
  _playerId: string,
  _plan: ProductionRechargePlan,
): string[] {
  return ['Перезарядка фишек выполняется автоматически через случайный интервал один, два или три полных хода']
}

export function validateProductionBuild(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  plan: ProductionBuildPlan,
): string[] {
  const pre = validateMarkerResolutionPreconditions(game, playerId, plan.markerId)
  if (Array.isArray(pre)) return pre
  const { marker } = pre

  return validateProductionBatch(
    game,
    mapId,
    playerId,
    {
      markerId: plan.markerId,
      ships: [{ type: plan.shipType, coord: marker.coord }],
    },
    plan.spentTokens,
  )
}

export function executeProductionBuild(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  plan: ProductionBuildPlan,
): string[] {
  const pre = validateMarkerResolutionPreconditions(game, playerId, plan.markerId)
  if (Array.isArray(pre)) return pre
  const { marker } = pre

  return executeProductionBatch(
    game,
    mapId,
    playerId,
    {
      markerId: plan.markerId,
      ships: [{ type: plan.shipType, coord: marker.coord }],
    },
    plan.spentTokens,
  )
}

export function getOwnedFaceUpTokenOptions(
  game: GameSnapshot,
  playerId: string,
): RegionTokenOption[] {
  const options: RegionTokenOption[] = []
  for (const cell of game.cells) {
    if (cell.controlOwnerId !== playerId) continue
    cell.resourceTokens.forEach((token, tokenIndex) => {
      if (token.faceUp === false) return
      options.push({
        coord: cell.coord,
        tokenIndex,
        token: { ...token },
        key: tokenSpendKey(cell.coord, tokenIndex),
      })
    })
  }
  return options
}


export function validateBuyProductionMarker(
  _game: GameSnapshot,
  _playerId: string,
  _spentTokens: TokenSpendRef[],
): string[] {
  return ['Маркеры производства отключены']
}

export function executeBuyProductionMarker(
  _game: GameSnapshot,
  _mapId: string,
  _playerId: string,
  _spentTokens: TokenSpendRef[],
): string[] {
  return ['Маркеры производства отключены']
}
