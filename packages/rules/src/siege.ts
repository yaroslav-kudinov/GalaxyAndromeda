import { trimGameEventLog } from './event-log.js'
import { removeStaleProductionMarkerAt } from './markers.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { SHIP_PRODUCTION_COST } from './ships.js'
import type { HexCoord, ShipUnit } from './types.js'
import { hexKey } from './types.js'

/**
 * Осада центров власти (ADR 019).
 *
 * Осада — состояние клетки, а не фаза. Игрок, вошедший на чужой защищённый центр власти, может
 * не штурмовать его, а осадить: его флот встаёт на клетку рядом с гарнизоном, боя нет. В начале
 * каждого хода осаждённый теряет один корабль гарнизона по своему выбору; когда гибнет последний,
 * центр переходит осаждающему. Осаждающий потерь не несёт — его цена в том, что флот связан.
 *
 * Осаждённый отвечает маркером действия: вылазкой (бой с осаждающими на своей клетке) или
 * отступлением всем гарнизоном на соседние свободные клетки — тогда центр теряется сразу.
 */
export interface SiegeState {
  besiegerId: string
  besiegedId: string
  /** Ход, в котором осада установлена. Первый тик — в начале следующего хода. */
  sinceTurn: number
}

function cellByKey(game: GameSnapshot, key: string): RuntimeCellState | undefined {
  return game.cells.find((cell) => hexKey(cell.coord.q, cell.coord.r) === key)
}

function keyOf(coord: HexCoord | string): string {
  return typeof coord === 'string' ? coord : hexKey(coord.q, coord.r)
}

export function siegeAt(game: GameSnapshot, coord: HexCoord | string): SiegeState | undefined {
  return game.sieges?.[keyOf(coord)]
}

export function isCellBesieged(game: GameSnapshot, coord: HexCoord | string): boolean {
  return !!siegeAt(game, coord)
}

/** Корабли гарнизона: корабли осаждённого на осаждённой клетке. */
export function garrisonShips(game: GameSnapshot, coord: HexCoord | string): ShipUnit[] {
  const siege = siegeAt(game, coord)
  if (!siege) return []
  return cellByKey(game, keyOf(coord))?.ships.filter((ship) => ship.ownerId === siege.besiegedId) ?? []
}

/** Осаждённые клетки игрока — чтобы доктрина «Атака» знала, когда не действовать. */
export function besiegedCellKeysOf(game: GameSnapshot, playerId: string): string[] {
  return Object.entries(game.sieges ?? {})
    .filter(([, siege]) => siege.besiegedId === playerId)
    .map(([key]) => key)
}

/**
 * Можно ли осадить клетку: это чужой центр власти под защитой кораблей владельца, и осады на
 * нём ещё нет. Незащищённый центр осаждать незачем: его занимают в конце хода захватом.
 */
export function canBesiegeCell(game: GameSnapshot, attackerId: string, coord: HexCoord): boolean {
  const cell = cellByKey(game, keyOf(coord))
  if (!cell?.isPowerCenter) return false
  const owner = cell.controlOwnerId
  if (!owner || owner === attackerId) return false
  if (siegeAt(game, coord)) return false
  if (!cell.ships.some((ship) => ship.ownerId === owner)) return false
  // Посторонние корабли на клетке превращают осаду в общий бой — такого случая правила не
  // разбирают, поэтому осаду тогда не предлагаем.
  return cell.ships.every((ship) => ship.ownerId === owner)
}

function appendSiegeEvent(game: GameSnapshot, message: string): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type: 'siege',
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

export function establishSiegeRecord(
  game: GameSnapshot,
  coord: HexCoord,
  besiegerId: string,
  besiegedId: string,
): void {
  game.sieges ??= {}
  game.sieges[keyOf(coord)] = { besiegerId, besiegedId, sinceTurn: game.turnNumber }
  appendSiegeEvent(game, `Осада центра власти на (${coord.q},${coord.r})`)
}

function transferToBesieger(game: GameSnapshot, key: string, siege: SiegeState, reason: string): void {
  const cell = cellByKey(game, key)
  if (cell) {
    cell.controlOwnerId = siege.besiegerId
    removeStaleProductionMarkerAt(game, cell.coord)
  }
  delete game.sieges![key]
  if (siegeLossesOwedBy(game, siege.besiegedId).includes(key)) {
    setSiegeLossesOwed(game, siege.besiegedId, siegeLossesOwedBy(game, siege.besiegedId).filter((k) => k !== key))
  }
  appendSiegeEvent(game, `Центр власти на (${cell?.coord.q},${cell?.coord.r}) пал: ${reason}`)
}

/**
 * Привести осады в соответствие доске. Вызывается после каждого действия (`settleSieges`) и
 * после тика осады:
 *
 * - гарнизона не осталось (погиб или ушёл) — центр переходит осаждающему;
 * - у осаждающего не осталось кораблей на клетке, но есть корабли третьего игрока — осада
 *   переходит к нему (он выиграл бой за клетку);
 * - иначе, если осаждающих нет — осада снята;
 * - контроль сменился иным путём — осада снята.
 */
export function syncSieges(game: GameSnapshot): void {
  if (!game.sieges) return
  for (const [key, siege] of Object.entries(game.sieges)) {
    const cell = cellByKey(game, key)
    if (!cell || cell.controlOwnerId !== siege.besiegedId) {
      delete game.sieges[key]
      continue
    }
    const garrison = cell.ships.filter((ship) => ship.ownerId === siege.besiegedId)
    const besiegers = cell.ships.filter((ship) => ship.ownerId === siege.besiegerId)
    if (garrison.length === 0) {
      if (besiegers.length > 0) {
        transferToBesieger(game, key, siege, 'гарнизон истощён')
      } else {
        const successor = cell.ships.find((ship) => ship.ownerId !== siege.besiegedId)
        if (successor) {
          transferToBesieger(game, key, { ...siege, besiegerId: successor.ownerId }, 'гарнизон истощён')
        } else {
          delete game.sieges[key]
        }
      }
      continue
    }
    if (besiegers.length === 0) {
      const successor = cell.ships.find((ship) => ship.ownerId !== siege.besiegedId)
      if (successor) {
        game.sieges[key] = { ...siege, besiegerId: successor.ownerId }
        appendSiegeEvent(game, `Осаду на (${cell.coord.q},${cell.coord.r}) продолжает новый осаждающий`)
      } else {
        delete game.sieges[key]
        appendSiegeEvent(game, `Осада с (${cell.coord.q},${cell.coord.r}) снята`)
      }
    }
  }
  if (Object.keys(game.sieges).length === 0) delete game.sieges
}

export function siegeLossesOwedBy(game: GameSnapshot, playerId: string): string[] {
  return game.siegeLossesOwedByPlayer?.[playerId] ?? []
}

function setSiegeLossesOwed(game: GameSnapshot, playerId: string, keys: string[]): void {
  game.siegeLossesOwedByPlayer ??= {}
  if (keys.length) game.siegeLossesOwedByPlayer[playerId] = keys
  else delete game.siegeLossesOwedByPlayer[playerId]
}

function shipCost(ship: ShipUnit): number {
  const cost = SHIP_PRODUCTION_COST[ship.type]
  return cost ? cost.credits + cost.production : 0
}

/** Какой корабль гарнизон теряет, если игрок не выбрал сам: самый дешёвый. */
function cheapestShip(ships: readonly ShipUnit[]): ShipUnit | undefined {
  return [...ships].sort((a, b) => shipCost(a) - shipCost(b) || a.id.localeCompare(b.id))[0]
}

function removeShip(game: GameSnapshot, key: string, shipId: string): void {
  const cell = cellByKey(game, key)
  if (!cell) return
  cell.ships = cell.ships.filter((ship) => ship.id !== shipId)
}

/**
 * Тик осады — в самом начале хода, в планировании. Выбирать осаждённому есть что, только если
 * в гарнизоне корабли разных классов; иначе потеря снимается сразу. Последний корабль гибнет
 * тоже сразу — центр переходит осаждающему до расчёта бюджета перезарядки.
 *
 * Идемпотентен в пределах хода: повторный вызов ничего не делает.
 */
export function applySiegeTick(game: GameSnapshot): void {
  if (!game.sieges) return
  if (game.siegeTickTurn === game.turnNumber) return
  game.siegeTickTurn = game.turnNumber

  const owed = new Map<string, string[]>()
  for (const [key, siege] of Object.entries(game.sieges)) {
    if (siege.sinceTurn >= game.turnNumber) continue
    const garrison = cellByKey(game, key)?.ships.filter((ship) => ship.ownerId === siege.besiegedId) ?? []
    if (garrison.length === 0) continue
    const types = new Set(garrison.map((ship) => ship.type))
    const besiegedOut = game.players.find((player) => player.id === siege.besiegedId)?.eliminated
    if (garrison.length === 1 || types.size === 1 || besiegedOut) {
      const victim = cheapestShip(garrison)!
      removeShip(game, key, victim.id)
      appendSiegeEvent(game, `Осада: гарнизон на ${key} теряет корабль`)
      continue
    }
    owed.set(siege.besiegedId, [...(owed.get(siege.besiegedId) ?? []), key])
  }
  game.siegeLossesOwedByPlayer = {}
  for (const [playerId, keys] of owed) setSiegeLossesOwed(game, playerId, keys)
  syncSieges(game)
}

export const SIEGE_LOSS_ERRORS = {
  nothingOwed: 'Сейчас терять корабли в осаде не нужно',
  wrongCount: 'Нужно выбрать по одному кораблю на каждую осаждённую клетку',
  notGarrison: 'Этот корабль не из гарнизона осаждённой клетки',
  duplicateCell: 'Для одной клетки выбрано два корабля',
} as const

/** Осаждённый выбирает, какие корабли гарнизонов потерять: по одному на клетку. */
export function executeSiegeLosses(game: GameSnapshot, playerId: string, shipIds: readonly string[]): string[] {
  const owed = siegeLossesOwedBy(game, playerId)
  if (!owed.length) return [SIEGE_LOSS_ERRORS.nothingOwed]
  if (shipIds.length !== owed.length) return [SIEGE_LOSS_ERRORS.wrongCount]

  const chosen = new Map<string, string>()
  for (const shipId of shipIds) {
    const key = owed.find((cellKey) =>
      cellByKey(game, cellKey)?.ships.some((ship) => ship.id === shipId && ship.ownerId === playerId),
    )
    if (!key) return [SIEGE_LOSS_ERRORS.notGarrison]
    if (chosen.has(key)) return [SIEGE_LOSS_ERRORS.duplicateCell]
    chosen.set(key, shipId)
  }
  for (const [key, shipId] of chosen) removeShip(game, key, shipId)
  setSiegeLossesOwed(game, playerId, [])
  appendSiegeEvent(game, `Осада: гарнизон теряет кораблей ${chosen.size}`)
  syncSieges(game)
  return []
}

/** Закрыть выбор за игрока: самый дешёвый корабль каждого гарнизона. */
export function autoResolveSiegeLosses(game: GameSnapshot, playerId: string): void {
  const owed = siegeLossesOwedBy(game, playerId)
  if (!owed.length) return
  const picks = owed
    .map((key) => cheapestShip(cellByKey(game, key)?.ships.filter((ship) => ship.ownerId === playerId) ?? []))
    .filter((ship): ship is ShipUnit => !!ship)
    .map((ship) => ship.id)
  if (picks.length === owed.length) executeSiegeLosses(game, playerId, picks)
  else setSiegeLossesOwed(game, playerId, [])
}

export function autoResolveAllSiegeLosses(game: GameSnapshot): void {
  for (const playerId of Object.keys(game.siegeLossesOwedByPlayer ?? {})) {
    autoResolveSiegeLosses(game, playerId)
  }
}

/**
 * Отступление из осады — только всем гарнизоном и только на соседние клетки без вражеских
 * кораблей. Частичный уход не разрешён: иначе на центре остались бы корабли без контроля.
 */
export function validateGarrisonDeparture(
  game: GameSnapshot,
  playerId: string,
  from: HexCoord,
  moves: readonly { shipId: string; to: HexCoord }[],
  distance: (a: HexCoord, b: HexCoord) => number,
): string[] {
  const siege = siegeAt(game, from)
  if (!siege || siege.besiegedId !== playerId) return []
  const garrison = garrisonShips(game, from)
  const moving = new Set(moves.map((move) => move.shipId))
  if (!garrison.every((ship) => moving.has(ship.id))) {
    return ['Из осады можно только отступить всем гарнизоном']
  }
  for (const move of moves) {
    if (distance(from, move.to) !== 1) {
      return ['Отступить из осады можно только на соседнюю клетку']
    }
    const dest = cellByKey(game, keyOf(move.to))
    if (dest?.ships.some((ship) => ship.ownerId !== playerId)) {
      return ['Отступить из осады можно только на клетку без вражеских кораблей']
    }
  }
  return []
}
