import { describe, expect, it } from 'vitest'
import type { GameSnapshot, RuntimeCellState } from './save-file.js'
import {
  autoResolveAllRechargePicks,
  autoResolveRechargePicks,
  computeRechargeBudget,
  countFaceDownTokens,
  executeRechargePicks,
  formatRechargeBudgetHint,
  RECHARGE_PICK_ERRORS,
  rechargePicksRemaining,
  refreshRechargeBudgets,
} from './resource-recharge.js'

interface CellSpec {
  q: number
  isPowerCenter?: boolean
  owner?: string | null
  /** Номиналы фишек лицом вниз. */
  faceDown?: number[]
  /** Номиналы фишек лицом вверх. */
  faceUp?: number[]
}

function cellOf(spec: CellSpec): RuntimeCellState {
  return {
    coord: { q: spec.q, r: 0 },
    isPowerCenter: !!spec.isPowerCenter,
    controlOwnerId: spec.owner === undefined ? 'player-1' : spec.owner,
    resourceTokens: [
      ...(spec.faceDown ?? []).map((value) => ({
        type: 'credits' as const,
        value: value as 1,
        faceUp: false,
      })),
      ...(spec.faceUp ?? []).map((value) => ({
        type: 'credits' as const,
        value: value as 1,
        faceUp: true,
      })),
    ],
    ships: [],
    actionMarkerId: null,
    productionMarkerId: null,
  }
}

function gameOf(cells: CellSpec[], victoryPowerCenters = 6): GameSnapshot {
  return {
    phase: 'planning',
    turnNumber: 1,
    activePlayerId: 'player-1',
    players: [
      { id: 'player-1', name: 'P1', color: '#111', isAi: false, eliminated: false },
      { id: 'player-2', name: 'P2', color: '#222', isAi: false, eliminated: false },
    ],
    cells: cells.map(cellOf),
    eventLog: [],
    pendingEvents: [],
    actionMarkers: [],
    productionMarkers: [],
    actionMarkerResolvedThisTurn: false,
    productionMarkerResolvedThisTurn: false,
    victoryPowerCenters,
  }
}

function faceUpValues(game: GameSnapshot, ownerId: string): number[] {
  return game.cells
    .filter((cell) => cell.controlOwnerId === ownerId)
    .flatMap((cell) => cell.resourceTokens.filter((t) => t.faceUp !== false).map((t) => t.value))
    .sort((a, b) => b - a)
}

describe('recharge budget', () => {
  it('falls one token per power center and bottoms out one step before victory', () => {
    const ladder = [1, 2, 3, 4, 5].map((powerCenters) => {
      const cells: CellSpec[] = []
      for (let i = 0; i < powerCenters; i += 1) cells.push({ q: i, isPowerCenter: true })
      return computeRechargeBudget(gameOf(cells, 6), 'player-1')
    })
    expect(ladder).toEqual([4, 3, 2, 1, 0])
  })

  it('never goes below zero', () => {
    const cells: CellSpec[] = []
    for (let i = 0; i < 9; i += 1) cells.push({ q: i, isPowerCenter: true })
    expect(computeRechargeBudget(gameOf(cells, 6), 'player-1')).toBe(0)
    expect(computeRechargeBudget(gameOf(cells, 6), 'player-1', -5)).toBe(0)
  })

  it('follows the map threshold, not half the power centers', () => {
    const cells: CellSpec[] = [{ q: 0, isPowerCenter: true }]
    expect(computeRechargeBudget(gameOf(cells, 6), 'player-1')).toBe(4)
    expect(computeRechargeBudget(gameOf(cells, 4), 'player-1')).toBe(2)
  })
})

describe('recharge picks', () => {
  it('flips everything silently when there is nothing to choose between', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, faceDown: [3, 4] },
    ])
    refreshRechargeBudgets(game)

    // Две фишки лицом вниз при бюджете четыре — выбор не нужен, долга нет.
    expect(rechargePicksRemaining(game, 'player-1')).toBe(0)
    expect(countFaceDownTokens(game, 'player-1')).toBe(0)
    expect(faceUpValues(game, 'player-1')).toEqual([4, 3])
  })

  it('owes exactly the budget when there is more face-down than budget', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, isPowerCenter: true },
      { q: 2, faceDown: [9, 7, 5, 2, 1] },
    ])
    refreshRechargeBudgets(game)

    // Два центра власти → бюджет три, лицом вниз пять фишек.
    expect(rechargePicksRemaining(game, 'player-1')).toBe(3)
    expect(countFaceDownTokens(game, 'player-1')).toBe(5)
  })

  it('does not grant a budget at the top of the ladder', () => {
    const cells: CellSpec[] = [{ q: 9, faceDown: [5, 5] }]
    for (let i = 0; i < 5; i += 1) cells.push({ q: i, isPowerCenter: true })
    const game = gameOf(cells, 6)
    refreshRechargeBudgets(game)
    expect(rechargePicksRemaining(game, 'player-1')).toBe(0)
    expect(countFaceDownTokens(game, 'player-1')).toBe(2)
  })

  it('flips the chosen tokens and counts them against the debt', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, isPowerCenter: true },
      { q: 2, faceDown: [9, 7, 5, 2, 1] },
    ])
    refreshRechargeBudgets(game)

    expect(executeRechargePicks(game, 'player-1', [
      { coord: { q: 2, r: 0 }, tokenIndex: 0 },
      { coord: { q: 2, r: 0 }, tokenIndex: 1 },
    ])).toEqual([])
    expect(rechargePicksRemaining(game, 'player-1')).toBe(1)
    expect(faceUpValues(game, 'player-1')).toEqual([9, 7])
  })

  it('rejects picks that are not the player’s, not face-down, duplicated or over budget', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, isPowerCenter: true },
      { q: 2, faceDown: [9, 7, 5, 2, 1], faceUp: [6] },
      { q: 3, owner: 'player-2', faceDown: [8] },
    ])
    refreshRechargeBudgets(game)

    const pick = (q: number, tokenIndex: number) => ({ coord: { q, r: 0 }, tokenIndex })
    expect(executeRechargePicks(game, 'player-1', [pick(3, 0)])).toEqual([
      RECHARGE_PICK_ERRORS.notYours,
    ])
    expect(executeRechargePicks(game, 'player-1', [pick(2, 5)])).toEqual([
      RECHARGE_PICK_ERRORS.notFaceDown,
    ])
    expect(executeRechargePicks(game, 'player-1', [pick(2, 0), pick(2, 0)])).toEqual([
      RECHARGE_PICK_ERRORS.duplicate,
    ])
    expect(
      executeRechargePicks(game, 'player-1', [pick(2, 0), pick(2, 1), pick(2, 2), pick(2, 3)]),
    ).toEqual([RECHARGE_PICK_ERRORS.tooMany])

    // Ни одна неудачная попытка ничего не перевернула.
    expect(countFaceDownTokens(game, 'player-1')).toBe(5)
  })

  it('auto-resolve takes the biggest tokens and is deterministic', () => {
    const build = () => {
      const game = gameOf([
        { q: 0, isPowerCenter: true },
        { q: 1, isPowerCenter: true },
        { q: 2, faceDown: [2, 9, 5, 7, 1] },
      ])
      refreshRechargeBudgets(game)
      return game
    }

    const first = build()
    expect(autoResolveRechargePicks(first, 'player-1')).toBe(3)
    expect(faceUpValues(first, 'player-1')).toEqual([9, 7, 5])
    expect(rechargePicksRemaining(first, 'player-1')).toBe(0)

    const second = build()
    autoResolveRechargePicks(second, 'player-1')
    expect(faceUpValues(second, 'player-1')).toEqual(faceUpValues(first, 'player-1'))
  })

  it('closes every outstanding debt so a turn cannot hang', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, faceDown: [1, 2, 3, 4, 5, 6] },
    ])
    refreshRechargeBudgets(game)
    expect(rechargePicksRemaining(game, 'player-1')).toBe(4)

    autoResolveAllRechargePicks(game)
    expect(game.rechargePicksRemainingByPlayer).toEqual({})
    expect(countFaceDownTokens(game, 'player-1')).toBe(2)
  })

  it('budget caps the rate of return, not the amount a player may hold', () => {
    const game = gameOf([
      { q: 0, isPowerCenter: true },
      { q: 1, faceUp: [9, 9, 9], faceDown: [4] },
    ])
    refreshRechargeBudgets(game)

    // Уже поднятые фишки не сгорают: копить на дорогой корабль можно.
    expect(faceUpValues(game, 'player-1')).toEqual([9, 9, 9, 4])
  })

  it('hint tells the player what the budget is doing', () => {
    expect(formatRechargeBudgetHint(4, 0)).toBe('Перезарядка: до 4 фишек за ход')
    expect(formatRechargeBudgetHint(3, 2)).toBe('Перезарядка: выберите фишки, осталось 2')
    expect(formatRechargeBudgetHint(0, 0)).toContain('недоступна')
  })
})
