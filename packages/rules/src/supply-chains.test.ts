import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import { gameStateFromSnapshot } from './save-file.js'
import { buildSupplyChainsForPlayer } from './supply-chains.js'
import { buildSpatialSummary } from './observation/ascii-map.js'

describe('supply chains', () => {
  it('connects face-adjacent controlled cells into one component', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 0, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    const state = gameStateFromSnapshot(game, map.id)
    const chains = buildSupplyChainsForPlayer(state, 'player-1')
    expect(chains).toHaveLength(1)
    expect(chains[0]!.hexes).toHaveLength(2)
  })

  it('spatialSummary includes supply chains', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 0, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    const summary = buildSpatialSummary(gameStateFromSnapshot(game, map.id))
    expect(summary.supplyChains.length).toBeGreaterThan(0)
  })

  it('isHexInSameSupplyChainAsRegion validates payment scope', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 0, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    const chains = buildSupplyChainsForPlayer(gameStateFromSnapshot(game, map.id), 'player-1')
    expect(chains[0]?.hexes).toContain('1,0')
  })
})
