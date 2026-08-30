import { describe, expect, it } from 'vitest'
import { beginMatchForParticipants, isPristineMatchSnapshot } from './match-start.js'
import { normalizeMapDefinition } from './map-editor.js'
import { gameSnapshotFromMap } from './save-file.js'
import type { MapDefinition } from './types.js'

function twoStartMap(): MapDefinition {
  return normalizeMapDefinition({
    id: 'lobby-start-test',
    name: 'Lobby start',
    cells: [
      { q: 0, r: 0, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
      { q: 1, r: 0, startPlayer: 2, startingShips: [{ type: 'destroyer', player: 2 }] },
      { q: 2, r: 0, startPlayer: 3, startingShips: [{ type: 'destroyer', player: 3 }] },
    ],
  })
}

describe('beginMatchForParticipants', () => {
  it('strips unused slots and sets planning among joiners', () => {
    const map = twoStartMap()
    const game = gameSnapshotFromMap(map)
    expect(isPristineMatchSnapshot(game)).toBe(true)
    expect(game.cells.some((cell) => cell.ships.some((ship) => ship.ownerId === 'player-3'))).toBe(true)

    beginMatchForParticipants(game, map.id, ['player-2', 'player-1'])

    expect(game.participatingPlayerIds).toEqual(['player-2', 'player-1'])
    expect(game.phase).toBe('planning')
    expect(game.turnNumber).toBe(1)
    expect(game.cells.some((cell) => cell.ships.some((ship) => ship.ownerId === 'player-3'))).toBe(false)
    expect(game.cells.some((cell) => cell.controlOwnerId === 'player-3')).toBe(false)
    expect(['player-1', 'player-2']).toContain(game.activePlayerId)
    expect(game.resourceRechargeTurnsRemaining).toBeGreaterThanOrEqual(1)
    expect(game.resourceRechargeTurnsRemaining).toBeLessThanOrEqual(3)
  })

  it('does not set recharge schedule before match start', () => {
    const map = twoStartMap()
    const game = gameSnapshotFromMap(map)
    expect(game.resourceRechargeTurnsRemaining).toBeUndefined()
  })

  it('isPristineMatchSnapshot is false after a marker is placed', () => {
    const map = twoStartMap()
    const game = gameSnapshotFromMap(map)
    game.actionMarkers = [
      { id: 'am-1', ownerId: 'player-1', coord: { q: 0, r: 0 }, placedInPhase: 'planning' },
    ]
    expect(isPristineMatchSnapshot(game)).toBe(false)
  })
})
