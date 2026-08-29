import type { MapCellDefinition, PlayerState, ResourceTokenDef, ShipType } from '@galaxy/rules'
import {
  PLAYER_LABELS,
  SHIP_ABBREV,
  SHIP_LABELS,
  SHIP_TYPES,
  getCellResourceToken,
} from '@galaxy/rules'
import type { BoardCellView } from '~/utils/board-adapter'

export const OVERVIEW_ZOOM_THRESHOLD = 0.75

export interface ShipGroupLine {
  player: number
  entries: { type: ShipType; count: number }[]
  total: number
}

export function resourceTokenShortLabel(token: ResourceTokenDef): string {
  const prefix = token.type === 'credits' ? '₡' : '⚙'
  return `${prefix}${token.value}`
}

export function resourceTokenLongLabel(token: ResourceTokenDef): string {
  const kind = token.type === 'credits' ? 'Кредиты' : 'Производство'
  const spent = token.faceUp === false ? ' · использовано' : ''
  return `${kind} · ${token.value}${spent}`
}

export function ownerLabel(
  slot: number | null | undefined,
  players?: PlayerState[],
): string {
  if (slot == null) return 'Нейтральная'
  const fromPlayers = players?.[slot - 1]
  if (fromPlayers?.name) return fromPlayers.name
  return `${slot}. ${PLAYER_LABELS[slot] ?? `Игрок ${slot}`}`
}

export function groupShipsByPlayer(ships: MapCellDefinition['startingShips']): ShipGroupLine[] {
  if (!ships?.length) return []
  const byPlayer = new Map<number, Map<ShipType, number>>()

  for (const ship of ships) {
    const types = byPlayer.get(ship.player) ?? new Map<ShipType, number>()
    types.set(ship.type, (types.get(ship.type) ?? 0) + 1)
    byPlayer.set(ship.player, types)
  }

  return [...byPlayer.entries()]
    .sort(([a], [b]) => a - b)
    .map(([player, types]) => {
      const entries = [...types.entries()]
        .sort(([a], [b]) => SHIP_TYPES.indexOf(a) - SHIP_TYPES.indexOf(b))
        .map(([type, count]) => ({ type, count }))
      return {
        player,
        entries,
        total: entries.reduce((sum, e) => sum + e.count, 0),
      }
    })
}

/** Laconic overview: only total fleet size (details live in the side panel). */
export function shipsOverviewLine(ships: MapCellDefinition['startingShips']): string {
  const total = shipsTotalCount(ships)
  return total > 0 ? String(total) : ''
}

export function shipsTotalCount(ships: MapCellDefinition['startingShips']): number {
  return ships?.length ?? 0
}

export interface CellOverviewLines {
  isPowerCenter: boolean
  resource: string | null
  ships: string | null
  shipTotal: number
}

export function cellOverviewLines(cell: MapCellDefinition): CellOverviewLines {
  const token = getCellResourceToken(cell)
  const total = shipsTotalCount(cell.startingShips)
  return {
    isPowerCenter: !!cell.isPowerCenter,
    resource: token ? resourceTokenShortLabel(token) : null,
    ships: total ? shipsOverviewLine(cell.startingShips) : null,
    shipTotal: total,
  }
}

export function cellHasMarkers(cell: BoardCellView): boolean {
  return !!(cell.actionMarker || cell.productionMarker)
}

export function markerSummary(cell: BoardCellView): string | null {
  if (cell.actionMarker && cell.productionMarker) return 'Действие + производство'
  if (cell.actionMarker) return 'Маркер действия'
  if (cell.productionMarker) return 'Маркер производства'
  return null
}

const SHIP_LABELS_PLURAL: Record<ShipType, string> = {
  destroyer: 'Эсминцы',
  cruiser: 'Крейсеры',
  battleship: 'Линкоры',
  shield: 'Щитоносцы',
  hyper: 'Гиперпространственные орудия',
}

/** Singular for 1; plural name + « × N» for N > 1. */
export function shipTypeCountLabel(type: ShipType, count: number): string {
  if (count <= 1) return SHIP_LABELS[type]
  return `${SHIP_LABELS_PLURAL[type]} × ${count}`
}

export { SHIP_LABELS, SHIP_ABBREV }
