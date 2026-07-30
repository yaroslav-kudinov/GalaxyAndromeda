import type { MapCellDefinition } from '@galaxy/rules'

export interface TerritoryLabelPlayer {
  slot: number
  name: string
  color: string
}

export interface TerritoryLabelPosition extends TerritoryLabelPlayer {
  key: string
  x: number
  y: number
}

interface Point {
  x: number
  y: number
}

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

function boundsAt(point: Point, width: number, height: number): Bounds {
  return {
    left: point.x - width / 2,
    top: point.y - height / 2,
    right: point.x + width / 2,
    bottom: point.y + height / 2,
  }
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Находит ближайшую свободную позицию за границей территории. Полные bounds
 * гекса закрывают также корабли, маркеры и внутренние оверлеи клетки.
 */
export function usePlayerTerritoryLabels(
  cells: MapCellDefinition[],
  players: TerritoryLabelPlayer[],
  center: (q: number, r: number) => Point,
  hexSize: number,
): TerritoryLabelPosition[] {
  const allCenters = cells.map((cell) => center(cell.q, cell.r))
  if (!allCenters.length) return []

  const mapCenter = allCenters.reduce(
    (sum, point) => ({ x: sum.x + point.x / allCenters.length, y: sum.y + point.y / allCenters.length }),
    { x: 0, y: 0 },
  )
  const obstacleBounds = allCenters.map((point) => boundsAt(point, hexSize * 2.1, hexSize * 2.1))
  const occupied: Bounds[] = []
  const labels: TerritoryLabelPosition[] = []

  for (const player of players) {
    const territory = cells.filter((cell) => cell.startPlayer === player.slot)
    if (!territory.length || !player.name.trim()) continue

    const territoryCenter = territory.reduce(
      (sum, cell) => {
        const point = center(cell.q, cell.r)
        return { x: sum.x + point.x / territory.length, y: sum.y + point.y / territory.length }
      },
      { x: 0, y: 0 },
    )
    const outwardAngle = Math.atan2(territoryCenter.y - mapCenter.y, territoryCenter.x - mapCenter.x)
    const width = 180
    const height = 24
    let chosen: Point | null = null

    for (const distance of [hexSize * 1.45, hexSize * 2.1, hexSize * 2.8, hexSize * 3.5]) {
      for (const angleOffset of [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const candidate = {
          x: territoryCenter.x + Math.cos(outwardAngle + angleOffset) * distance,
          y: territoryCenter.y + Math.sin(outwardAngle + angleOffset) * distance,
        }
        const candidateBounds = boundsAt(candidate, width, height)
        if (!obstacleBounds.some((obstacle) => overlaps(candidateBounds, obstacle)) && !occupied.some((other) => overlaps(candidateBounds, other))) {
          chosen = candidate
          occupied.push(candidateBounds)
          break
        }
      }
      if (chosen) break
    }

    if (chosen) {
      labels.push({ ...player, key: `territory-label-${player.slot}`, ...chosen })
    }
  }

  return labels
}
