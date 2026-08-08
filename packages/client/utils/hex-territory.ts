import type { MapCellDefinition } from '@galaxy/rules'
import { hexKey } from '@galaxy/rules'
import type { HexOrientation } from '~/utils/hex-layout'
import { hexCenter } from '~/utils/hex-layout'

export interface HexNeighbor {
  q: number
  r: number
}

/**
 * Neighbor for edge `i` (vertices i → i+1), matching `hexPoints` angles.
 * Flat: midpoints at 30°+60°·i; pointy: midpoints at −60°+60°·i.
 */
export const EDGE_NEIGHBORS: Record<HexOrientation, HexNeighbor[]> = {
  flat: [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
  ],
  pointy: [
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ],
}

export interface TerritoryEdgeBand {
  key: string
  player: number
  /** Quad: edge → inset toward cell center (for soft border fill) */
  points: string
  /** Outer edge segment for perimeter stroke */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Inset corners matching v0 / v1 (for concave corner fills) */
  i0x: number
  i0y: number
  i1x: number
  i1y: number
  /** Gradient vector: edge midpoint → inset */
  gx1: number
  gy1: number
  gx2: number
  gy2: number
  gradientId: string
}

/** Soft fill wedge at a concave (inward) perimeter corner */
export interface TerritoryCornerFill {
  key: string
  player: number
  points: string
  gx1: number
  gy1: number
  gx2: number
  gy2: number
  gradientId: string
}

/** Continuous perimeter stroke path (round joins at corners) */
export interface TerritoryPerimeterPath {
  key: string
  player: number
  d: string
}

export interface TerritoryOverlay {
  bands: TerritoryEdgeBand[]
  corners: TerritoryCornerFill[]
  paths: TerritoryPerimeterPath[]
}

function hexVertex(
  cx: number,
  cy: number,
  size: number,
  orientation: HexOrientation,
  index: number,
): { x: number; y: number } {
  const deg = orientation === 'pointy' ? 60 * index - 90 : 60 * index
  const angle = (Math.PI / 180) * deg
  return {
    x: cx + size * Math.cos(angle),
    y: cy + size * Math.sin(angle),
  }
}

function vertKey(x: number, y: number): string {
  return `${Math.round(x * 100)}_${Math.round(y * 100)}`
}

/**
 * External edges of player-owned territories (classic hex outline).
 * Soft band + stroke only where neighbor is missing or owned by another player.
 */
export function buildTerritoryEdgeBands(
  cells: MapCellDefinition[],
  size: number,
  orientation: HexOrientation,
  /** How far the soft fill reaches toward cell center (0–1 of radius) */
  insetFactor = 0.32,
  excludePlayers: ReadonlySet<number> | readonly number[] = [],
): TerritoryEdgeBand[] {
  return buildTerritoryOverlay(cells, size, orientation, insetFactor, excludePlayers).bands
}

/**
 * Soft edge bands, concave-corner wedges, and continuous perimeter paths.
 */
export function buildTerritoryOverlay(
  cells: MapCellDefinition[],
  size: number,
  orientation: HexOrientation,
  insetFactor = 0.32,
  /** Слоты игроков (1–6), чьи территории не рисуем (обычно — локальный игрок) */
  excludePlayers: ReadonlySet<number> | readonly number[] = [],
): TerritoryOverlay {
  const excluded = excludePlayers instanceof Set ? excludePlayers : new Set(excludePlayers)
  const ownerByKey = new Map<string, number>()
  for (const cell of cells) {
    if (cell.startPlayer != null) {
      ownerByKey.set(hexKey(cell.q, cell.r), cell.startPlayer)
    }
  }

  const neighbors = EDGE_NEIGHBORS[orientation]
  const bands: TerritoryEdgeBand[] = []

  for (const cell of cells) {
    if (cell.startPlayer == null) continue
    const owner = cell.startPlayer
    if (excluded.has(owner)) continue
    const c = hexCenter(cell.q, cell.r, size, orientation)

    for (let i = 0; i < 6; i++) {
      const n = neighbors[i]!
      const nKey = hexKey(cell.q + n.q, cell.r + n.r)
      if (ownerByKey.get(nKey) === owner) continue

      const v0 = hexVertex(c.x, c.y, size, orientation, i)
      const v1 = hexVertex(c.x, c.y, size, orientation, (i + 1) % 6)
      const i0 = {
        x: c.x + (v0.x - c.x) * (1 - insetFactor),
        y: c.y + (v0.y - c.y) * (1 - insetFactor),
      }
      const i1 = {
        x: c.x + (v1.x - c.x) * (1 - insetFactor),
        y: c.y + (v1.y - c.y) * (1 - insetFactor),
      }
      const edgeMid = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 }
      const insetMid = { x: (i0.x + i1.x) / 2, y: (i0.y + i1.y) / 2 }
      // SVG id must not contain commas from axial hexKey
      const idSafe = `${cell.q}_${cell.r}`
      const gradientId = `terr-grad-${idSafe}-e${i}-p${owner}`

      bands.push({
        key: `terr-edge-${idSafe}-${i}`,
        player: owner,
        points: `${v0.x},${v0.y} ${v1.x},${v1.y} ${i1.x},${i1.y} ${i0.x},${i0.y}`,
        x1: v0.x,
        y1: v0.y,
        x2: v1.x,
        y2: v1.y,
        i0x: i0.x,
        i0y: i0.y,
        i1x: i1.x,
        i1y: i1.y,
        gx1: edgeMid.x,
        gy1: edgeMid.y,
        gx2: insetMid.x,
        gy2: insetMid.y,
        gradientId,
      })
    }
  }

  const { corners, paths } = buildCornersAndPaths(bands)
  return { bands, corners, paths }
}

function buildCornersAndPaths(bands: TerritoryEdgeBand[]): {
  corners: TerritoryCornerFill[]
  paths: TerritoryPerimeterPath[]
} {
  const corners: TerritoryCornerFill[] = []
  const paths: TerritoryPerimeterPath[] = []
  const byPlayer = new Map<number, TerritoryEdgeBand[]>()

  for (const band of bands) {
    const list = byPlayer.get(band.player)
    if (list) list.push(band)
    else byPlayer.set(band.player, [band])
  }

  for (const [player, playerBands] of byPlayer) {
    const unused = new Set(playerBands)
    const startByKey = new Map<string, TerritoryEdgeBand[]>()

    for (const band of playerBands) {
      const k = vertKey(band.x1, band.y1)
      const list = startByKey.get(k)
      if (list) list.push(band)
      else startByKey.set(k, [band])
    }

    let pathIdx = 0
    while (unused.size) {
      const seed = unused.values().next().value as TerritoryEdgeBand
      const chain: TerritoryEdgeBand[] = [seed]
      unused.delete(seed)

      // Extend forward
      let guard = 0
      while (guard++ < playerBands.length) {
        const last = chain[chain.length - 1]!
        const nextList = startByKey.get(vertKey(last.x2, last.y2))
        const next = nextList?.find((b) => unused.has(b))
        if (!next) break
        chain.push(next)
        unused.delete(next)
      }

      // Extend backward
      guard = 0
      while (guard++ < playerBands.length) {
        const first = chain[0]!
        let prev: TerritoryEdgeBand | undefined
        for (const candidate of unused) {
          if (vertKey(candidate.x2, candidate.y2) === vertKey(first.x1, first.y1)) {
            prev = candidate
            break
          }
        }
        if (!prev) break
        chain.unshift(prev)
        unused.delete(prev)
      }

      const closed =
        chain.length > 2 &&
        vertKey(chain[0]!.x1, chain[0]!.y1) === vertKey(chain[chain.length - 1]!.x2, chain[chain.length - 1]!.y2)

      let d = `M${chain[0]!.x1} ${chain[0]!.y1}`
      for (const seg of chain) {
        d += ` L${seg.x2} ${seg.y2}`
      }
      if (closed) d += ' Z'

      paths.push({
        key: `terr-path-p${player}-${pathIdx}`,
        player,
        d,
      })

      const jointCount = closed ? chain.length : chain.length - 1
      for (let i = 0; i < jointCount; i++) {
        const a = chain[i]!
        const b = chain[(i + 1) % chain.length]!
        if (!closed && i + 1 >= chain.length) break

        // Incoming A→V, outgoing V→B; for CCW perimeter, right turn (cross < 0) = concave
        const ix = a.x2 - a.x1
        const iy = a.y2 - a.y1
        const ox = b.x2 - b.x1
        const oy = b.y2 - b.y1
        const cross = ix * oy - iy * ox
        if (cross >= -1e-6) continue

        const vx = a.x2
        const vy = a.y2
        const midIx = (a.i1x + b.i0x) / 2
        const midIy = (a.i1y + b.i0y) / 2
        const gradientId = `terr-corner-p${player}-${pathIdx}-${i}`

        corners.push({
          key: `terr-corner-p${player}-${pathIdx}-${i}`,
          player,
          points: `${vx},${vy} ${a.i1x},${a.i1y} ${b.i0x},${b.i0y}`,
          gx1: vx,
          gy1: vy,
          gx2: midIx,
          gy2: midIy,
          gradientId,
        })
      }

      pathIdx++
    }
  }

  return { corners, paths }
}
