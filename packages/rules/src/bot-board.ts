/**
 * Быстрый взгляд бота на доску: индекс клеток, соседи, досягаемость кораблей, регионы.
 *
 * Бот лобби планирует действие каждые ~200 мс на каждую комнату, поэтому движковые помощники,
 * которые на каждый вызов пересобирают сводку карты (`getMovableShipsAtMarker`,
 * `getBuildableShipsForMarker`), для оценки десятков вариантов слишком дороги. Здесь те же
 * правила посчитаны один раз на вызов бота. Окончательную проверку всё равно делает движок:
 * если оценка разойдётся с правилами, действие будет отклонено и бот возьмёт запасной вариант.
 */

import { effectiveMoveRange } from './doctrines.js'
import { HEX_DIRECTIONS } from './map.js'
import { MAX_SHIPS_PER_CELL, MAX_SHIPS_PER_CELL_PER_PLAYER } from './constants.js'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import { hexKey, type HexCoord, type ShipType } from './types.js'

export interface BoardIndex {
  game: GameSnapshot
  cells: Map<string, RuntimeCellState>
  keys: readonly string[]
  neighbors: Map<string, readonly string[]>
  /** Кэш досягаемости: `клетка|игрок|дальность` → клетка → длина пути. */
  reachCache: Map<string, Map<string, number>>
  /** Кэш полей расстояний от клетки до всех клеток (без учёта кораблей). */
  distanceCache: Map<string, Map<string, number>>
  regionCache: Map<string, PlayerRegions>
}

export function coordOfKey(key: string): HexCoord {
  const comma = key.indexOf(',')
  return { q: Number(key.slice(0, comma)), r: Number(key.slice(comma + 1)) }
}

export function indexBoard(game: GameSnapshot): BoardIndex {
  const cells = new Map<string, RuntimeCellState>()
  for (const cell of game.cells) cells.set(hexKey(cell.coord.q, cell.coord.r), cell)
  const neighbors = new Map<string, readonly string[]>()
  for (const [key, cell] of cells) {
    const list: string[] = []
    for (const dir of HEX_DIRECTIONS) {
      const next = hexKey(cell.coord.q + dir.q, cell.coord.r + dir.r)
      if (cells.has(next)) list.push(next)
    }
    neighbors.set(key, list)
  }
  return {
    game,
    cells,
    keys: [...cells.keys()],
    neighbors,
    reachCache: new Map(),
    distanceCache: new Map(),
    regionCache: new Map(),
  }
}

/**
 * Клетка — место боя для игрока: на ней чужие корабли. Исключение — осада, которую ведёт сам
 * игрок: его подкрепление входит туда без боя. То же правило, что `isCombatDestination`.
 */
export function isCombatCellFor(board: BoardIndex, playerId: string, key: string): boolean {
  const cell = board.cells.get(key)
  if (!cell) return false
  if (board.game.sieges?.[key]?.besiegerId === playerId) return false
  return cell.ships.some((ship) => ship.ownerId !== playerId)
}

/**
 * Куда долетит корабль игрока с клетки `from` за один ход дальности `range`: путь по
 * существующим клеткам, сквозь клетку боя пути нет, но закончить ход на ней можно.
 */
export function reachFrom(
  board: BoardIndex,
  from: string,
  playerId: string,
  range: number,
): Map<string, number> {
  const cacheKey = `${from}|${playerId}|${range}`
  const cached = board.reachCache.get(cacheKey)
  if (cached) return cached
  const dist = new Map<string, number>([[from, 0]])
  const queue: string[] = [from]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!
    const d = dist.get(current)!
    if (d >= range) continue
    for (const next of board.neighbors.get(current) ?? []) {
      if (dist.has(next)) continue
      dist.set(next, d + 1)
      if (isCombatCellFor(board, playerId, next)) continue
      queue.push(next)
    }
  }
  dist.delete(from)
  board.reachCache.set(cacheKey, dist)
  return dist
}

/** Досягаемость корабля конкретного класса с учётом доктрины владельца. */
export function reachForShip(
  board: BoardIndex,
  from: string,
  playerId: string,
  type: ShipType,
): Map<string, number> {
  return reachFrom(board, from, playerId, effectiveMoveRange(board.game, type, playerId))
}

/** Расстояние по клеткам карты от `from` до всех клеток; корабли не учитываются. */
export function distancesFrom(board: BoardIndex, from: string): Map<string, number> {
  const cached = board.distanceCache.get(from)
  if (cached) return cached
  const dist = new Map<string, number>([[from, 0]])
  const queue: string[] = [from]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!
    const d = dist.get(current)!
    for (const next of board.neighbors.get(current) ?? []) {
      if (dist.has(next)) continue
      dist.set(next, d + 1)
      queue.push(next)
    }
  }
  board.distanceCache.set(from, dist)
  return dist
}

/** Можно ли поставить ещё один свой корабль на клетку (лимиты клетки из правил). */
export function hasRoomFor(cell: RuntimeCellState, playerId: string, incoming = 0): boolean {
  const own = cell.ships.filter((ship) => ship.ownerId === playerId).length + incoming
  return own < MAX_SHIPS_PER_CELL_PER_PLAYER && cell.ships.length + incoming < MAX_SHIPS_PER_CELL
}

export interface RegionInfo {
  id: number
  keys: string[]
  size: number
  /** Номинал фишек лицом вверх в регионе — кошелёк постройки. */
  credits: number
  production: number
  /** Сколько фишек региона лежат лицом вниз — их поднимет перезарядка. */
  faceDown: number
  powerCenters: number
}

export interface PlayerRegions {
  regionOf: Map<string, number>
  regions: RegionInfo[]
  largest: RegionInfo | null
}

/** Регионы игрока — связные группы его клеток; от размера зависит, что можно строить. */
export function regionsOf(board: BoardIndex, playerId: string): PlayerRegions {
  const cached = board.regionCache.get(playerId)
  if (cached) return cached
  const regionOf = new Map<string, number>()
  const regions: RegionInfo[] = []
  for (const [start, cell] of board.cells) {
    if (cell.controlOwnerId !== playerId || regionOf.has(start)) continue
    const region: RegionInfo = {
      id: regions.length,
      keys: [],
      size: 0,
      credits: 0,
      production: 0,
      faceDown: 0,
      powerCenters: 0,
    }
    const stack = [start]
    regionOf.set(start, region.id)
    while (stack.length) {
      const key = stack.pop()!
      const current = board.cells.get(key)!
      region.keys.push(key)
      region.size += 1
      if (current.isPowerCenter) region.powerCenters += 1
      for (const token of current.resourceTokens) {
        if (token.faceUp === false) region.faceDown += 1
        else if (token.type === 'credits') region.credits += token.value
        else if (token.type === 'production') region.production += token.value
      }
      for (const next of board.neighbors.get(key) ?? []) {
        if (regionOf.has(next)) continue
        if (board.cells.get(next)?.controlOwnerId !== playerId) continue
        regionOf.set(next, region.id)
        stack.push(next)
      }
    }
    regions.push(region)
  }
  let largest: RegionInfo | null = null
  for (const region of regions) if (!largest || region.size > largest.size) largest = region
  const result = { regionOf, regions, largest }
  board.regionCache.set(playerId, result)
  return result
}
