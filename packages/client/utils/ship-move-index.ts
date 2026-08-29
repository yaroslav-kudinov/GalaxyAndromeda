import type { ShipType } from '@galaxy/rules'

export const SHIP_MOVE_TWEEN_MS = 500

export interface IndexedBoardShip {
  id: string
  q: number
  r: number
  type: ShipType
  player: number
}

export interface BoardShipLike {
  id?: string
  type: ShipType
  player: number
}

export interface BoardCellLike {
  q: number
  r: number
  startingShips?: BoardShipLike[]
}

/** Корабли с устойчивым id → клетка. Без id (редактор карты) пропускаем. */
export function indexShipsById(cells: BoardCellLike[]): Map<string, IndexedBoardShip> {
  const index = new Map<string, IndexedBoardShip>()
  for (const cell of cells) {
    for (const ship of cell.startingShips ?? []) {
      if (!ship.id) continue
      index.set(ship.id, {
        id: ship.id,
        q: cell.q,
        r: cell.r,
        type: ship.type,
        player: ship.player,
      })
    }
  }
  return index
}

/**
 * Id кораблей, которые сменили клетку между двумя снимками.
 * Появление, исчезновение и тот же гекс (бой на исходной клетке) — не движение.
 */
export function detectHexMoves(
  prev: Map<string, Pick<IndexedBoardShip, 'q' | 'r'>>,
  next: Map<string, Pick<IndexedBoardShip, 'q' | 'r'>>,
): string[] {
  const moved: string[] = []
  for (const [id, n] of next) {
    const p = prev.get(id)
    if (p && (p.q !== n.q || p.r !== n.r)) moved.push(id)
  }
  return moved
}

/** Подпись расположения для watch: меняется только при смене клеток кораблей. */
export function shipLocationSignature(cells: BoardCellLike[]): string {
  return cells
    .map((cell) => {
      const ids = (cell.startingShips ?? [])
        .map((ship) => ship.id)
        .filter((id): id is string => !!id)
        .join(',')
      return `${cell.q},${cell.r}:${ids}`
    })
    .join('|')
}

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) ** 3
}
