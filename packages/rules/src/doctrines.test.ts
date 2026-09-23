import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap, type GameSnapshot } from './save-file.js'
import { beginMatchForParticipants } from './match-start.js'
import {
  activeDoctrineId,
  doctrineShotModifier,
  doctrineWindowStart,
  effectiveMoveRange,
  maskDoctrineChoice,
} from './doctrines.js'
import { applyGameActionOnSnapshot, getLegalActionsForSnapshot } from './movement.js'
import { computeClaimLimit } from './claim.js'
import { computeRechargeBudget, rechargePicksRemaining } from './resource-recharge.js'
import { advanceGameSnapshot } from './turn.js'
import { establishSiegeRecord } from './siege.js'

/** Дуэль на двух центрах власти: у каждого по центру и по эсминцу. */
function duel(options: { doctrineWindow?: number | null } = {}) {
  const map = createEmptyMap('doctrines', 'Doctrines')
  map.victoryPowerCenters = 6
  map.cells = [
    { q: 0, r: 0, isPowerCenter: true, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
    { q: 1, r: 0, isPowerCenter: true, startPlayer: 2, startingShips: [{ type: 'destroyer', player: 2 }] },
    { q: 2, r: 0 },
  ]
  const game = gameSnapshotFromMap(map)
  beginMatchForParticipants(game, map.id, ['player-1', 'player-2'], {
    matchSeed: 1,
    doctrineWindow: options.doctrineWindow,
  })
  return { map, game }
}

function spendAllTokens(game: GameSnapshot, ownerId: string, count: number) {
  const cell = game.cells.find((c) => c.controlOwnerId === ownerId)!
  cell.resourceTokens = Array.from({ length: count }, () => ({ type: 'credits' as const, value: 3, faceUp: false }))
}

describe('доктрины: окна и выбор', () => {
  it('окна по три хода: 1–3, 4–6, …, 13–15', () => {
    const { game } = duel()
    expect([1, 3, 4, 6, 7, 13, 15].map((turn) => doctrineWindowStart(game, turn))).toEqual([1, 1, 4, 4, 7, 13, 13])
  })

  it('старт партии открывает выбор, бюджет перезарядки ждёт вскрытия', () => {
    const { map, game } = duel()
    expect(game.doctrineChoice).toEqual({ windowStart: 1, picks: {} })
    expect(getLegalActionsForSnapshot(game, map.id, 'player-2').map((a) => a.id)).toContain('choose-doctrine')
  })

  it('выбор скрыт до вскрытия, выбирать можно вне своей очереди', () => {
    const { map, game } = duel()
    const outOfTurn = game.activePlayerId === 'player-1' ? 'player-2' : 'player-1'
    expect(
      applyGameActionOnSnapshot(game, map, outOfTurn, 'choose-doctrine', { doctrineId: 'attack' }).errors,
    ).toEqual([])
    expect(activeDoctrineId(game, outOfTurn)).toBe('none')

    const other = outOfTurn === 'player-1' ? 'player-2' : 'player-1'
    expect(maskDoctrineChoice(game.doctrineChoice, other)).toEqual({
      windowStart: 1,
      picks: {},
      pickedBy: [outOfTurn],
    })
    expect(maskDoctrineChoice(game.doctrineChoice, outOfTurn)?.picks).toEqual({ [outOfTurn]: 'attack' })

    expect(
      applyGameActionOnSnapshot(game, map, outOfTurn, 'choose-doctrine', { doctrineId: 'defense' }).errors[0],
    ).toMatch(/уже выбрана/)
    expect(
      applyGameActionOnSnapshot(game, map, other, 'choose-doctrine', { doctrineId: 'bogus' }).errors[0],
    ).toMatch(/нет/)
  })

  it('когда выбрали все, доктрины вскрываются и выдаётся бюджет по ним', () => {
    const { map, game } = duel()
    spendAllTokens(game, 'player-1', 5)
    spendAllTokens(game, 'player-2', 5)

    applyGameActionOnSnapshot(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'production' })
    applyGameActionOnSnapshot(game, map, 'player-2', 'choose-doctrine', { doctrineId: 'attack' })

    expect(game.doctrineChoice).toBeUndefined()
    expect(activeDoctrineId(game, 'player-1')).toBe('production')
    expect(activeDoctrineId(game, 'player-2')).toBe('attack')
    // Порог 6, один центр: базовый бюджет 4. «Производство» +2, «Атака» −1.
    expect(computeRechargeBudget(game, 'player-1')).toBe(6)
    expect(computeRechargeBudget(game, 'player-2')).toBe(3)
    expect(rechargePicksRemaining(game, 'player-1')).toBe(0)
    expect(rechargePicksRemaining(game, 'player-2')).toBe(3)
    expect(game.eventLog.at(-1)?.message).toMatch(/Доктрины вскрыты/)
  })

  it('не выбравший к концу планирования остаётся без доктрины', () => {
    const { map, game } = duel()
    applyGameActionOnSnapshot(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'expansion' })
    for (let guard = 0; guard < 6 && game.phase === 'planning'; guard++) {
      advanceGameSnapshot(game, map.id)
    }
    expect(game.phase).toBe('actions')
    expect(activeDoctrineId(game, 'player-1')).toBe('expansion')
    expect(activeDoctrineId(game, 'player-2')).toBe('none')
    expect(game.doctrineChoice).toBeUndefined()
  })

  it('в первый ход нового окна выбор открывается снова, прежняя доктрина больше не действует', () => {
    const { game } = duel()
    game.doctrineByPlayer = {
      'player-1': { doctrineId: 'maneuvers', fromTurn: 1 },
      'player-2': { doctrineId: 'defense', fromTurn: 1 },
    }
    delete game.doctrineChoice
    game.turnNumber = 3
    expect(activeDoctrineId(game, 'player-1')).toBe('maneuvers')
    game.turnNumber = 4
    expect(activeDoctrineId(game, 'player-1')).toBe('none')
  })

  it('без окна доктрин (обучение) выбора нет', () => {
    const { map, game } = duel({ doctrineWindow: null })
    expect(game.doctrineChoice).toBeUndefined()
    expect(getLegalActionsForSnapshot(game, map.id, 'player-1').map((a) => a.id)).not.toContain('choose-doctrine')
  })
})

describe('доктрины: эффекты', () => {
  function withDoctrines(p1: string, p2: string) {
    const { map, game } = duel()
    applyGameActionOnSnapshot(game, map, 'player-1', 'choose-doctrine', { doctrineId: p1 })
    applyGameActionOnSnapshot(game, map, 'player-2', 'choose-doctrine', { doctrineId: p2 })
    return { map, game }
  }

  it('Экспансия и Производство меняют лимит захвата и бюджет навстречу друг другу', () => {
    const { game } = withDoctrines('expansion', 'production')
    expect(computeClaimLimit(game, 'player-1')).toBe(3)
    expect(computeRechargeBudget(game, 'player-1')).toBe(3)
    expect(computeClaimLimit(game, 'player-2')).toBe(2)
    expect(computeRechargeBudget(game, 'player-2')).toBe(6)
  })

  it('Манёвры ускоряют только тяжёлые корабли, Оборона скорость не трогает', () => {
    const { game } = withDoctrines('maneuvers', 'defense')
    expect(effectiveMoveRange(game, 'battleship', 'player-1')).toBe(2)
    expect(effectiveMoveRange(game, 'hyper', 'player-1')).toBe(2)
    expect(effectiveMoveRange(game, 'cruiser', 'player-1')).toBe(2)
    expect(effectiveMoveRange(game, 'destroyer', 'player-1')).toBe(3)
    expect(computeClaimLimit(game, 'player-1')).toBe(1)
    expect(computeRechargeBudget(game, 'player-1')).toBe(3)
    expect(effectiveMoveRange(game, 'cruiser', 'player-2')).toBe(2)
    expect(computeClaimLimit(game, 'player-2')).toBe(1)
  })

  it('Атака облегчает свои выстрелы, Оборона затрудняет вражеские — только на своих клетках', () => {
    const { game } = withDoctrines('attack', 'defense')
    // Бой на клетке обороняющегося: Атака и Оборона гасят друг друга.
    expect(doctrineShotModifier(game, 'player-1', 'player-2', { q: 1, r: 0 })).toBe(0)
    // На чужой для обороняющегося клетке Оборона не действует.
    expect(doctrineShotModifier(game, 'player-1', 'player-2', { q: 0, r: 0 })).toBe(-1)
    expect(doctrineShotModifier(game, 'player-1', 'player-2', { q: 2, r: 0 })).toBe(-1)
    // Защищающийся стреляет по атакующему без поправок.
    expect(doctrineShotModifier(game, 'player-2', 'player-1')).toBe(0)

    const { game: game2 } = withDoctrines('attack', 'none')
    expect(doctrineShotModifier(game2, 'player-1', 'player-2')).toBe(-1)
  })

  it('Атака не действует, пока осаждают центр самого атакующего', () => {
    const { game } = withDoctrines('attack', 'none')
    establishSiegeRecord(game, { q: 0, r: 0 }, 'player-2', 'player-1')
    expect(doctrineShotModifier(game, 'player-1', 'player-2')).toBe(0)
  })
})
