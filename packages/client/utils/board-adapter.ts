import type {
  GameSnapshot,
  MapCellDefinition,
  PlayerState,
  RuntimeCellState,
} from '@galaxy/rules'
import { PLAYER_COLORS, hexKey } from '@galaxy/rules'
import type { HexOrientation } from '~/utils/hex-layout'

export interface BoardCellView extends MapCellDefinition {
  actionMarker?: boolean
  productionMarker?: boolean
}

export function boardMarkerKeys(cells: BoardCellView[]): {
  action: string[]
  production: string[]
} {
  const action: string[] = []
  const production: string[] = []
  for (const cell of cells) {
    const key = `${cell.q},${cell.r}`
    if (cell.actionMarker) action.push(key)
    if (cell.productionMarker) production.push(key)
  }
  return { action, production }
}

function playerSlotFromId(players: PlayerState[], ownerId: string | null): number | null {
  if (!ownerId) return null
  const idx = players.findIndex((p) => p.id === ownerId)
  return idx >= 0 ? idx + 1 : null
}

export function runtimeCellToBoardCell(
  cell: RuntimeCellState,
  players: PlayerState[],
): BoardCellView {
  const token = cell.resourceTokens[0]
  return {
    q: cell.coord.q,
    r: cell.coord.r,
    isPowerCenter: cell.isPowerCenter,
    startPlayer: playerSlotFromId(players, cell.controlOwnerId),
    resourceToken: token ? { ...token } : undefined,
    startingShips: cell.ships.map((ship) => ({
      type: ship.type,
      player: playerSlotFromId(players, ship.ownerId) ?? 1,
    })),
    actionMarker: !!cell.actionMarkerId,
    productionMarker: !!cell.productionMarkerId,
  }
}

export function snapshotToBoardCells(snapshot: GameSnapshot): BoardCellView[] {
  return snapshot.cells.map((cell) => runtimeCellToBoardCell(cell, snapshot.players))
}

export function mapCellsToBoardCells(cells: MapCellDefinition[]): BoardCellView[] {
  return cells.map((cell) => ({ ...cell }))
}
