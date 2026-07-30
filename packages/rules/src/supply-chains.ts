import type { GameSnapshot } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import type { GameState, HexCoord, SpatialRegion } from './types.js'
import { hexKey } from './types.js'

export interface SupplyChainComponent {
  playerId: string
  chainId: string
  hexes: string[]
  regionIds: string[]
}

const NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

function cellMap(state: GameState): Map<string, (typeof state.cells)[0]> {
  return new Map(state.cells.map((c) => [hexKey(c.coord.q, c.coord.r), c]))
}

function regionIdsForHexes(regions: SpatialRegion[], playerId: string, hexes: string[]): string[] {
  const hexSet = new Set(hexes)
  return regions
    .filter((r) => r.ownerId === playerId && r.hexes.some((h) => hexSet.has(h)))
    .map((r) => r.id)
}

/** BFS connected components of face-adjacent controlled cells per player. */
export function buildSupplyChainsForPlayer(
  state: GameState,
  playerId: string,
  regions: SpatialRegion[] = [],
): SupplyChainComponent[] {
  const cells = cellMap(state)
  const visited = new Set<string>()
  const components: SupplyChainComponent[] = []

  for (const cell of state.cells) {
    if (cell.controlOwnerId !== playerId) continue
    const startKey = hexKey(cell.coord.q, cell.coord.r)
    if (visited.has(startKey)) continue

    const stack = [cell.coord]
    const hexes: string[] = []

    while (stack.length) {
      const cur = stack.pop()!
      const key = hexKey(cur.q, cur.r)
      if (visited.has(key)) continue
      const curCell = cells.get(key)
      if (!curCell || curCell.controlOwnerId !== playerId) continue
      visited.add(key)
      hexes.push(key)
      for (const d of NEIGHBORS) {
        stack.push({ q: cur.q + d.q, r: cur.r + d.r })
      }
    }

    if (hexes.length === 0) continue
    const anchor = [...hexes].sort()[0]!
    components.push({
      playerId,
      chainId: `chain-${playerId}-${anchor}`,
      hexes,
      regionIds: regionIdsForHexes(regions, playerId, hexes),
    })
  }

  return components
}

export function buildAllSupplyChains(state: GameState, regions: SpatialRegion[] = []): SupplyChainComponent[] {
  const playerIds = [...new Set(state.cells.map((c) => c.controlOwnerId).filter(Boolean))] as string[]
  return playerIds.flatMap((id) => buildSupplyChainsForPlayer(state, id, regions))
}

export function supplyChainsFromRegions(
  state: GameState,
  regions: SpatialRegion[],
): { playerId: string; path: string[] }[] {
  return buildAllSupplyChains(state, regions).map((c) => ({
    playerId: c.playerId,
    path: [...c.hexes].sort(),
  }))
}

/** @deprecated Use supplyChainsFromRegions inside buildSpatialSummary */
export function supplyChainsForSummary(state: GameState): { playerId: string; path: string[] }[] {
  return buildAllSupplyChains(state, []).map((c) => ({
    playerId: c.playerId,
    path: [...c.hexes].sort(),
  }))
}

export function findSupplyChainForHex(
  state: GameState,
  playerId: string,
  coord: HexCoord,
  regions: SpatialRegion[] = [],
): SupplyChainComponent | null {
  const key = hexKey(coord.q, coord.r)
  return buildSupplyChainsForPlayer(state, playerId, regions).find((c) => c.hexes.includes(key)) ?? null
}

export function findSupplyChainForRegion(
  state: GameState,
  playerId: string,
  regionId: string,
  regions: SpatialRegion[] = [],
): SupplyChainComponent | null {
  return buildSupplyChainsForPlayer(state, playerId, regions).find((c) => c.regionIds.includes(regionId)) ?? null
}

export function isHexInSameSupplyChainAsRegion(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  coord: HexCoord,
  regionId: string,
): boolean {
  const state = gameStateFromSnapshot(game, mapId)
  const chain = findSupplyChainForRegion(state, playerId, regionId)
  if (!chain) return false
  return chain.hexes.includes(hexKey(coord.q, coord.r))
}

export function getSupplyChainHexSetForRegion(
  game: GameSnapshot,
  mapId: string,
  playerId: string,
  regionId: string,
): Set<string> | null {
  const state = gameStateFromSnapshot(game, mapId)
  const chain = findSupplyChainForRegion(state, playerId, regionId)
  if (!chain) return null
  return new Set(chain.hexes)
}
