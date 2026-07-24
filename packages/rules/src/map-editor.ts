import {
  MAX_SHIPS_PER_CELL,
  MAX_SHIPS_PER_CELL_PER_PLAYER,
} from './constants.js'
import type { MapCellDefinition, MapDefinition, ResourceTokenDef, StartingShipDef } from './types.js'
import { hexKey } from './types.js'

export {
  MAX_SHIPS_PER_CELL,
  MAX_SHIPS_PER_CELL_PER_PLAYER,
  PLAYER_COLORS,
  PLAYER_LABELS,
  SHIP_ABBREV,
  SHIP_LABELS,
  SHIP_TYPES,
} from './constants.js'

export function getCellResourceToken(cell: MapCellDefinition): ResourceTokenDef | undefined {
  if (cell.resourceToken) return cell.resourceToken
  const legacy = cell.resourceTokens
  if (legacy?.length) return legacy[0]
  return undefined
}

export function setCellResourceToken(
  cell: MapCellDefinition,
  token: ResourceTokenDef | undefined,
): void {
  cell.resourceToken = token
  delete cell.resourceTokens
}

/** Cell payload without coordinates — for copy/paste in the map editor */
export interface MapCellContent {
  isPowerCenter: boolean
  startPlayer: number | null
  resourceToken?: ResourceTokenDef
  startingShips?: StartingShipDef[]
}

function cloneResourceToken(token: ResourceTokenDef): ResourceTokenDef {
  return {
    type: token.type,
    value: token.value,
    ...(token.faceUp != null ? { faceUp: token.faceUp } : {}),
  }
}

function cloneStartingShips(ships: StartingShipDef[]): StartingShipDef[] {
  return ships.map((ship) => ({ type: ship.type, player: ship.player }))
}

export function extractCellContent(cell: MapCellDefinition): MapCellContent {
  const token = getCellResourceToken(cell)
  return {
    isPowerCenter: !!cell.isPowerCenter,
    startPlayer: cell.startPlayer ?? null,
    resourceToken: token ? cloneResourceToken(token) : undefined,
    startingShips: cell.startingShips?.length
      ? cloneStartingShips(cell.startingShips)
      : undefined,
  }
}

export function applyCellContent(cell: MapCellDefinition, content: MapCellContent): void {
  if (content.isPowerCenter) cell.isPowerCenter = true
  else delete cell.isPowerCenter

  cell.startPlayer = content.startPlayer

  setCellResourceToken(
    cell,
    content.resourceToken ? cloneResourceToken(content.resourceToken) : undefined,
  )

  const ships = content.startingShips?.length
    ? trimStartingShips(cloneStartingShips(content.startingShips))
    : undefined
  if (ships?.length) cell.startingShips = ships
  else delete cell.startingShips
}

function trimStartingShips(ships: MapCellDefinition['startingShips']): MapCellDefinition['startingShips'] {
  if (!ships?.length) return ships
  const perPlayer = new Map<number, number>()
  const trimmed = []
  for (const ship of ships) {
    const count = perPlayer.get(ship.player) ?? 0
    if (count >= MAX_SHIPS_PER_CELL_PER_PLAYER) continue
    if (trimmed.length >= MAX_SHIPS_PER_CELL) break
    perPlayer.set(ship.player, count + 1)
    trimmed.push(ship)
  }
  return trimmed
}

export function normalizeMapDefinition(map: MapDefinition): MapDefinition {
  return {
    ...map,
    cells: map.cells.map((cell) => {
      const normalized = { ...cell }
      if (!normalized.resourceToken && normalized.resourceTokens?.length) {
        normalized.resourceToken = normalized.resourceTokens[0]
      }
      delete normalized.resourceTokens
      if (normalized.startingShips?.length) {
        normalized.startingShips = trimStartingShips(normalized.startingShips)
      }
      return normalized
    }),
  }
}

export function countCellShips(cell: MapCellDefinition): number {
  return cell.startingShips?.length ?? 0
}

export function countCellShipsForPlayer(cell: MapCellDefinition, player: number): number {
  return (cell.startingShips ?? []).filter((ship) => ship.player === player).length
}

export function canAddShipToCell(cell: MapCellDefinition, player: number): boolean {
  if (countCellShips(cell) >= MAX_SHIPS_PER_CELL) return false
  if (countCellShipsForPlayer(cell, player) >= MAX_SHIPS_PER_CELL_PER_PLAYER) return false
  return true
}

export function validateMapDefinition(map: MapDefinition): string[] {
  const errors: string[] = []
  if (!map.id?.trim()) errors.push('Укажите id карты')
  if (!map.name?.trim()) errors.push('Укажите название карты')

  const keys = new Set<string>()
  for (const cell of map.cells) {
    const key = hexKey(cell.q, cell.r)
    if (keys.has(key)) errors.push(`Дублирующаяся клетка ${key}`)
    keys.add(key)

    const token = getCellResourceToken(cell)
    if (cell.resourceTokens && cell.resourceTokens.length > 1) {
      errors.push(`${key}: только один ресурсный токен на клетку`)
    }
    if (token && (token.value < 1 || token.value > 9)) {
      errors.push(`${key}: значение токена 1–9`)
    }

    if (cell.startPlayer != null && (cell.startPlayer < 1 || cell.startPlayer > 6)) {
      errors.push(`${key}: игрок 1–6`)
    }

    const ships = cell.startingShips ?? []
    if (ships.length > MAX_SHIPS_PER_CELL) {
      errors.push(`${key}: максимум ${MAX_SHIPS_PER_CELL} кораблей в клетке`)
    }

    const perPlayer = new Map<number, number>()
    for (const ship of ships) {
      if (ship.player < 1 || ship.player > 6) {
        errors.push(`${key}: корабль — игрок 1–6`)
      }
      perPlayer.set(ship.player, (perPlayer.get(ship.player) ?? 0) + 1)
    }
    for (const [player, count] of perPlayer) {
      if (count > MAX_SHIPS_PER_CELL_PER_PLAYER) {
        errors.push(`${key}: игрок ${player} — максимум ${MAX_SHIPS_PER_CELL_PER_PLAYER} корабля`)
      }
    }
  }
  return errors
}
