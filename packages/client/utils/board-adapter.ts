import type {
  GameSnapshot,
  MapCellDefinition,
  PlayerState,
  RuntimeCellState,
  StartingShipDef,
} from '@galaxy/rules'
import { PLAYER_COLORS, hexKey } from '@galaxy/rules'
import type { HexOrientation } from '~/utils/hex-layout'

/** Runtime ship on board — preserves id for UI (arrow anchors, etc.) */
export interface BoardShipView extends StartingShipDef {
  id?: string
}

export interface BoardCellView extends Omit<MapCellDefinition, 'startingShips'> {
  startingShips?: BoardShipView[]
  actionMarker?: boolean
  /** Слоты игроков, чьи маркеры действия стоят на клетке (на осаждённой их может быть два). */
  actionMarkerPlayers?: number[]
  /** Центр власти в осаде: слот осаждающего игрока. */
  besiegedBy?: number | null
}

export function boardMarkerKeys(cells: BoardCellView[]): string[] {
  const action: string[] = []
  for (const cell of cells) {
    const key = `${cell.q},${cell.r}`
    if (cell.actionMarker) action.push(key)
  }
  return action
}

export function playerSlotFromId(players: PlayerState[], ownerId: string | null): number | null {
  if (!ownerId) return null
  const idx = players.findIndex((p) => p.id === ownerId)
  return idx >= 0 ? idx + 1 : null
}

export function runtimeCellToBoardCell(
  cell: RuntimeCellState,
  players: PlayerState[],
  besiegerId?: string | null,
  markerOwnerIds: readonly string[] = [],
): BoardCellView {
  const token = cell.resourceTokens[0]
  return {
    ...(besiegerId ? { besiegedBy: playerSlotFromId(players, besiegerId) } : {}),
    q: cell.coord.q,
    r: cell.coord.r,
    isPowerCenter: cell.isPowerCenter,
    startPlayer: playerSlotFromId(players, cell.controlOwnerId),
    resourceToken: token ? { ...token } : undefined,
    startingShips: cell.ships.map((ship) => ({
      id: ship.id,
      type: ship.type,
      player: playerSlotFromId(players, ship.ownerId) ?? 1,
    })),
    actionMarker: !!cell.actionMarkerId,
    actionMarkerPlayers: markerOwnerIds
      .map((ownerId) => playerSlotFromId(players, ownerId))
      .filter((slot): slot is number => slot != null),
  }
}

export function snapshotToBoardCells(snapshot: GameSnapshot): BoardCellView[] {
  const markerOwners = new Map<string, string[]>()
  for (const marker of snapshot.actionMarkers) {
    const key = `${marker.coord.q},${marker.coord.r}`
    markerOwners.set(key, [...(markerOwners.get(key) ?? []), marker.ownerId])
  }
  return snapshot.cells.map((cell) => {
    const key = `${cell.coord.q},${cell.coord.r}`
    return runtimeCellToBoardCell(
      cell,
      snapshot.players,
      snapshot.sieges?.[key]?.besiegerId,
      markerOwners.get(key) ?? [],
    )
  })
}

export function mapCellsToBoardCells(cells: MapCellDefinition[]): BoardCellView[] {
  return cells.map((cell) => ({ ...cell }))
}
