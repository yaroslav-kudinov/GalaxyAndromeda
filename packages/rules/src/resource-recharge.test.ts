import { describe, expect, it, vi } from 'vitest'
import type { GameSnapshot } from './save-file.js'
import {
  formatResourceRechargeBannerText,
  formatResourceRechargePlayerHint,
  migrateResourceRechargeSchedule,
  maybeApplyAutomaticResourceRecharge,
  rollNewResourceRechargeSchedule,
  rollResourceRechargeTurns,
} from './resource-recharge.js'

function emptyGame(): GameSnapshot {
  return {
    phase: 'actions',
    turnNumber: 1,
    activePlayerId: 'player-1',
    players: [],
    cells: [
      {
        coord: { q: 0, r: 0 },
        isPowerCenter: false,
        controlOwnerId: 'player-1',
        resourceTokens: [{ type: 'credits', value: 3, faceUp: false }],
        ships: [],
        actionMarkerId: null,
        productionMarkerId: null,
      },
    ],
    eventLog: [],
    pendingEvents: [],
    actionMarkers: [],
    productionMarkers: [],
    actionMarkerResolvedThisTurn: false,
    productionMarkerResolvedThisTurn: false,
  }
}

describe('resource-recharge', () => {
  it('rollResourceRechargeTurns returns 1, 2 or 3', () => {
    expect(rollResourceRechargeTurns(() => 0)).toBe(1)
    expect(rollResourceRechargeTurns(() => 0.34)).toBe(2)
    expect(rollResourceRechargeTurns(() => 0.67)).toBe(3)
  })

  it('formatResourceRechargePlayerHint uses Russian plural', () => {
    expect(formatResourceRechargePlayerHint(1)).toContain('конце этого хода')
    expect(formatResourceRechargePlayerHint(2)).toContain('2 хода')
    expect(formatResourceRechargePlayerHint(3)).toContain('3 хода')
  })

  it('formatResourceRechargeBannerText uses prominent countdown wording', () => {
    expect(formatResourceRechargeBannerText(1)).toBe('До перезарядки ресурсов — 1 ход')
    expect(formatResourceRechargeBannerText(2)).toBe('До перезарядки ресурсов — 2 хода')
    expect(formatResourceRechargeBannerText(3)).toBe('До перезарядки ресурсов — 3 хода')
  })

  it('maybeApplyAutomaticResourceRecharge decrements countdown', () => {
    const game = emptyGame()
    game.resourceRechargeTurnsRemaining = 3
    maybeApplyAutomaticResourceRecharge(game, () => 0)
    expect(game.resourceRechargeTurnsRemaining).toBe(2)
    expect(game.cells[0]!.resourceTokens[0]!.faceUp).toBe(false)
  })

  it('maybeApplyAutomaticResourceRecharge flips tokens and rolls next interval', () => {
    const game = emptyGame()
    game.resourceRechargeTurnsRemaining = 1
    maybeApplyAutomaticResourceRecharge(game, () => 0)
    expect(game.cells[0]!.resourceTokens[0]!.faceUp).toBe(true)
    expect(game.resourceRechargeTurnsRemaining).toBe(1)
    expect(game.eventLog.some((e) => e.message.includes('Автоперезарядка'))).toBe(true)
  })

  it('migrateResourceRechargeSchedule migrates legacy interval without rolling', () => {
    const game = emptyGame() as GameSnapshot & { resourceRechargeInterval?: number }
    game.resourceRechargeInterval = 2
    expect(migrateResourceRechargeSchedule(game)).toBe(2)
    expect(game.resourceRechargeTurnsRemaining).toBe(2)
  })

  it('migrateResourceRechargeSchedule does not roll when schedule is missing', () => {
    const game = emptyGame()
    const rng = vi.fn(() => 0)
    expect(migrateResourceRechargeSchedule(game)).toBeUndefined()
    expect(game.resourceRechargeTurnsRemaining).toBeUndefined()
    expect(rng).not.toHaveBeenCalled()
  })

  it('maybeApplyAutomaticResourceRecharge is a no-op before match start schedule', () => {
    const game = emptyGame()
    maybeApplyAutomaticResourceRecharge(game, () => 0)
    expect(game.resourceRechargeTurnsRemaining).toBeUndefined()
  })

  it('rollNewResourceRechargeSchedule sets explicit interval', () => {
    const game = emptyGame()
    expect(rollNewResourceRechargeSchedule(game, () => 0)).toBe(1)
    expect(game.resourceRechargeTurnsRemaining).toBe(1)
  })
})
