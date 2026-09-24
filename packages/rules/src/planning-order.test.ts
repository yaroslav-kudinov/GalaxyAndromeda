import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap, type GameSnapshot } from './save-file.js'
import { beginMatchForParticipants } from './match-start.js'
import { applyGameActionOnSnapshot, getLegalActionsForSnapshot } from './movement.js'
import { claimPicksRemaining } from './claim.js'
import { rechargePicksRemaining } from './resource-recharge.js'
import { beginTurnPlanning } from './turn.js'
import { planningStepFor, PLANNING_ORDER_ERRORS } from './planning-order.js'
import type { MapDefinition } from './types.js'
import { establishSiegeRecord, powerCentersCapturedNextTurn } from './siege.js'

/**
 * Дуэль: у первого игрока центр власти и эсминцы на `neutral` нейтральных клетках — захватывать
 * есть что. Партия подведена к началу хода `turn` в фазе планирования.
 */
function startOfTurn(turn: number, neutral: number) {
  const map = createEmptyMap('planning-order', 'Planning order')
  map.victoryPowerCenters = 6
  map.cells = [
    { q: 0, r: 0, isPowerCenter: true, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
    { q: 0, r: 4, isPowerCenter: true, startPlayer: 2, startingShips: [{ type: 'destroyer', player: 2 }] },
    ...Array.from({ length: neutral }, (_, i) => ({ q: i + 1, r: 0 })),
  ]
  const game = gameSnapshotFromMap(map)
  beginMatchForParticipants(game, map.id, ['player-1', 'player-2'], { matchSeed: 1 })
  for (let i = 1; i <= neutral; i++) {
    game.cells.find((c) => c.coord.q === i && c.coord.r === 0)!.ships.push({
      id: `dd-${i}`,
      type: 'destroyer',
      ownerId: 'player-1',
    })
  }
  // Доктрины прошлого окна и переход к новому ходу.
  delete game.doctrineChoice
  game.doctrineByPlayer = {
    'player-1': { doctrineId: 'none', fromTurn: 1 },
    'player-2': { doctrineId: 'none', fromTurn: 1 },
  }
  game.turnNumber = turn
  game.phase = 'planning'
  game.activePlayerId = 'player-1'
  beginTurnPlanning(game, map.id)
  return { map, game }
}

const neutralOwners = (game: GameSnapshot) =>
  game.cells.filter((c) => c.coord.r === 0 && c.coord.q > 0).map((c) => c.controlOwnerId ?? null)

const act = (game: GameSnapshot, map: MapDefinition, playerId: string, actionId: string, params?: Record<string, unknown>) =>
  applyGameActionOnSnapshot(game, map, playerId, actionId, params).errors

describe('порядок решений в начале хода', () => {
  it('«Экспансия», выбранная в первый ход окна, прибавляет клетку захвата уже в этом ходу', () => {
    // Центр власти один: без доктрины можно занять две клетки из трёх.
    const { map, game } = startOfTurn(4, 3)
    expect(game.doctrineChoice?.windowStart).toBe(4)
    // Захват ждёт доктрин: ничего не занято и не предложено.
    expect(neutralOwners(game)).toEqual([null, null, null])
    expect(claimPicksRemaining(game, 'player-1')).toBe(0)

    expect(act(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'expansion' })).toEqual([])
    expect(planningStepFor(game, 'player-1')).toBe('doctrine-wait')
    expect(neutralOwners(game)).toEqual([null, null, null])

    expect(act(game, map, 'player-2', 'choose-doctrine', { doctrineId: 'none' })).toEqual([])
    // Лимит 1 + 1 центр + 1 за «Экспансию» = 3: все три клетки заняты.
    expect(neutralOwners(game)).toEqual(['player-1', 'player-1', 'player-1'])
  })

  it('доктрина с платой захватом — клеток больше лимита, игрок выбирает', () => {
    const { map, game } = startOfTurn(4, 3)
    act(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'defense' })
    act(game, map, 'player-2', 'choose-doctrine', { doctrineId: 'none' })
    // «Оборона» отнимает клетку захвата: 1 + 1 − 1 = 1.
    expect(claimPicksRemaining(game, 'player-1')).toBe(1)
    expect(planningStepFor(game, 'player-1')).toBe('claims')
  })

  it('маркеры и передача хода — только после доктрины, захвата и перезарядки', () => {
    const { map, game } = startOfTurn(4, 3)
    const home = { q: 0, r: 0 }
    game.cells[0]!.resourceTokens = Array.from({ length: 6 }, () => ({ type: 'credits' as const, value: 2, faceUp: false }))

    // Доктрина.
    expect(act(game, map, 'player-1', 'toggle-marker', { coord: home, kind: 'action' })).toEqual([PLANNING_ORDER_ERRORS.doctrine])
    expect(getLegalActionsForSnapshot(game, map.id, 'player-1').map((a) => a.id)).not.toContain('advance-phase')
    act(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'none' })

    // Ждём соперника.
    expect(act(game, map, 'player-1', 'advance-phase')).toEqual([PLANNING_ORDER_ERRORS['doctrine-wait']])
    act(game, map, 'player-2', 'choose-doctrine', { doctrineId: 'none' })

    // Захват: две клетки из трёх; перезарядка раньше захвата не принимается.
    expect(planningStepFor(game, 'player-1')).toBe('claims')
    expect(rechargePicksRemaining(game, 'player-1')).toBe(0)
    expect(act(game, map, 'player-1', 'toggle-marker', { coord: home, kind: 'action' })).toEqual([PLANNING_ORDER_ERRORS.claims])
    expect(act(game, map, 'player-1', 'execute-claim-picks', { picks: [{ q: 1, r: 0 }, { q: 2, r: 0 }] })).toEqual([])

    // Перезарядка: бюджет 6 − 1 − 1 центр = 4 из шести перевёрнутых фишек.
    expect(planningStepFor(game, 'player-1')).toBe('recharge')
    expect(rechargePicksRemaining(game, 'player-1')).toBe(4)
    expect(act(game, map, 'player-1', 'advance-phase')).toEqual([PLANNING_ORDER_ERRORS.recharge])
    expect(act(game, map, 'player-1', 'execute-recharge-picks')).toEqual([])

    expect(planningStepFor(game, 'player-1')).toBe('markers')
    expect(act(game, map, 'player-1', 'toggle-marker', { coord: home, kind: 'action' })).toEqual([])
    expect(getLegalActionsForSnapshot(game, map.id, 'player-1').map((a) => a.id)).toContain('advance-phase')
  })

  it('потери в осаде — раньше доктрины', () => {
    const { map, game } = startOfTurn(4, 1)
    game.siegeLossesOwedByPlayer = { 'player-1': ['0,0'] }
    expect(planningStepFor(game, 'player-1')).toBe('siege-losses')
    expect(act(game, map, 'player-1', 'choose-doctrine', { doctrineId: 'expansion' })).toEqual([
      PLANNING_ORDER_ERRORS['siege-losses'],
    ])
  })

  it('вне первого хода окна захват считается сразу, по действующей доктрине', () => {
    const { game } = startOfTurn(5, 3)
    expect(game.doctrineChoice).toBeUndefined()
    expect(claimPicksRemaining(game, 'player-1')).toBe(2)
  })

  it('ход сверх лимита: окно доктрин не открывается, захват последнего хода засчитан', () => {
    const { game } = startOfTurn(16, 3)
    expect(game.turnLimit).toBe(15)
    expect(game.doctrineChoice).toBeUndefined()
    expect(claimPicksRemaining(game, 'player-1')).toBe(0)
    expect(neutralOwners(game).filter((owner) => owner === 'player-1')).toHaveLength(2)
  })
})

describe('победа по центрам власти — после захватов всех игроков', () => {
  /**
   * У первого пять центров из шести нужных и корабль на нейтральном центре. У второго корабль
   * на беззащитном центре первого. Оба выбирают клетки захвата.
   */
  function simultaneousClaims() {
    const map = createEmptyMap('claims-victory', 'Claims victory')
    map.victoryPowerCenters = 6
    map.cells = [
      { q: 0, r: 0, isPowerCenter: true, startPlayer: 1, startingShips: [{ type: 'destroyer', player: 1 }] },
      { q: 0, r: 6, isPowerCenter: true, startPlayer: 2, startingShips: [{ type: 'destroyer', player: 2 }] },
      ...[1, 2, 3, 4].map((q) => ({ q, r: 0, isPowerCenter: true })),
      { q: 5, r: 0, isPowerCenter: true },
      { q: 6, r: 0 },
      { q: 0, r: 5 },
    ]
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'], { matchSeed: 1 })
    delete game.doctrineChoice
    const cell = (q: number, r: number) => game.cells.find((c) => c.coord.q === q && c.coord.r === r)!
    for (const q of [1, 2, 3, 4]) cell(q, 0).controlOwnerId = 'player-1'
    const ship = (q: number, r: number, ownerId: string, id: string) =>
      cell(q, r).ships.push({ id, type: 'destroyer', ownerId })
    // Первый: корабли на нейтральном центре (5,0) и простой клетке (6,0).
    ship(5, 0, 'player-1', 'p1-a')
    ship(6, 0, 'player-1', 'p1-b')
    // Второй: корабль на беззащитном центре первого (4,0) и на простой клетке (0,5).
    ship(4, 0, 'player-2', 'p2-a')
    ship(0, 5, 'player-2', 'p2-b')
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.claimPicksRemainingByPlayer = { 'player-1': 1, 'player-2': 1 }
    return { map, game, cell }
  }

  it('центр, отобранный в тот же ход, победы не даёт', () => {
    const { map, game, cell } = simultaneousClaims()
    expect(act(game, map, 'player-1', 'execute-claim-picks', { picks: [{ q: 5, r: 0 }] })).toEqual([])
    // Шесть центров у первого, но второй ещё выбирает — победы пока нет.
    expect(game.gameOver).toBeUndefined()
    expect(act(game, map, 'player-2', 'execute-claim-picks', { picks: [{ q: 4, r: 0 }] })).toEqual([])
    expect(cell(4, 0).controlOwnerId).toBe('player-2')
    expect(game.gameOver).toBeUndefined()
  })

  it('если центр не отобран, победа — как только захваты выбрали все', () => {
    const { map, game } = simultaneousClaims()
    act(game, map, 'player-1', 'execute-claim-picks', { picks: [{ q: 5, r: 0 }] })
    expect(game.gameOver).toBeUndefined()
    expect(act(game, map, 'player-2', 'execute-claim-picks', { picks: [{ q: 0, r: 5 }] })).toEqual([])
    expect(game.gameOver).toEqual({ winnerId: 'player-1', reason: 'power_centers' })
  })
  it('центр, павший в осаде, считается раньше захвата — победы нет', () => {
    const { map, game, cell } = simultaneousClaims()
    game.claimPicksRemainingByPlayer = {}
    game.doctrineByPlayer = {
      'player-1': { doctrineId: 'none', fromTurn: 4 },
      'player-2': { doctrineId: 'none', fromTurn: 4 },
    }
    game.turnNumber = 4
    // Последний корабль гарнизона первого на (4,0) осаждён вторым.
    cell(4, 0).ships.push({ id: 'p1-garrison', type: 'destroyer', ownerId: 'player-1' })
    establishSiegeRecord(game, { q: 4, r: 0 }, 'player-2', 'player-1')

    const ahead = powerCentersCapturedNextTurn(game)
    expect(ahead).toContainEqual({ coord: { q: 4, r: 0 }, capturerId: 'player-2', ownerId: 'player-1', by: 'siege' })
    expect(ahead).toContainEqual({ coord: { q: 5, r: 0 }, capturerId: 'player-1', ownerId: null, by: 'claim' })

    game.turnNumber = 5
    beginTurnPlanning(game, map.id)
    // Тик осады забрал (4,0), захват дал (5,0): у первого снова пять центров.
    expect(cell(4, 0).controlOwnerId).toBe('player-2')
    expect(cell(5, 0).controlOwnerId).toBe('player-1')
    expect(game.gameOver).toBeUndefined()
  })
})
