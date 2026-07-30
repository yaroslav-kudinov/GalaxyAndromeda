import { describe, expect, it } from 'vitest'
import {
  PRIORITY_SKIP_DESTROY_SURCHARGE,
  applyShieldAbsorption,
  buildBombardmentPreview,
  computeRoundDamage,
  getBombardmentTargetKeys,
  getDestroyCost,
  getDestroyCostWithPrioritySkip,
  getEffectiveFireRangeBounds,
  getFireRangeBounds,
  groupBombardmentPlansByTarget,
  rollCombatRound,
  selectShipsToDestroy,
  SHIELD_ABSORB_NEIGHBOR,
  SHIELD_ABSORB_SELF,
  validateBombardmentTarget,
  validateMarkerBombardment,
} from './index.js'
import { createEmptyMap } from './map.js'
import { addActionMarker } from './markers.js'
import { gameSnapshotFromMap } from './save-file.js'
import type { ShipType } from './types.js'

function addShip(
  game: ReturnType<typeof gameSnapshotFromMap>,
  q: number,
  r: number,
  ownerId: string,
  type: ShipType,
  id: string,
) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error('cell missing')
  cell.ships.push({ id, type, ownerId })
  if (!cell.controlOwnerId) cell.controlOwnerId = ownerId
}

describe('По правилам (PDF / rulebook compliance)', () => {
  it('щиты поглощают 4 на клетке + 2 с соседа', () => {
    expect(
      applyShieldAbsorption(8, [
        {
          shipId: 'sh-self',
          ownerId: 'p2',
          absorbCapacity: SHIELD_ABSORB_SELF,
          scope: 'self',
          fromCoord: { q: 1, r: 0 },
        },
        {
          shipId: 'sh-nei',
          ownerId: 'p2',
          absorbCapacity: SHIELD_ABSORB_NEIGHBOR,
          scope: 'neighbor',
          fromCoord: { q: 0, r: 0 },
        },
      ]),
    ).toEqual({ remainingDamage: 2, absorbed: 6 })
  })

  it('очки уничтожения = |разница сумм|, не полная сумма победителя', () => {
    expect(
      computeRoundDamage({ attackerTotal: 15, defenderTotal: 7, winner: 'attacker' }),
    ).toBe(8)
  })

  it('priority skip: destroyCost +1 (линкор 9→10), без фишек', () => {
    expect(PRIORITY_SKIP_DESTROY_SURCHARGE).toBe(1)
    expect(getDestroyCost('battleship')).toBe(9)
    expect(getDestroyCostWithPrioritySkip('battleship', new Set(['battleship']))).toBe(10)
    expect(getDestroyCostWithPrioritySkip('battleship', new Set())).toBe(9)

    const ships = [
      { id: 'bb', type: 'battleship' as ShipType, ownerId: 'p2' },
      { id: 'dd', type: 'destroyer' as ShipType, ownerId: 'p2' },
    ]
    // Бюджет 10: без skip хватает на dd(3)+bb(9)=12 → только dd; со skip bb=10 → только dd
    expect(selectShipsToDestroy(ships, 10, new Set(['battleship']))).toEqual(['dd'])
    // Бюджет 10 без skip: dd(3) затем bb(9) — после dd остаётся 7 < 9 → только dd
    expect(selectShipsToDestroy(ships, 10, new Set())).toEqual(['dd'])
    // Бюджет 12 со skip bb: dd(3)+bb(10)=13 → только dd; бюджет 13 → оба
    expect(selectShipsToDestroy(ships, 13, new Set(['battleship']))).toEqual(['dd', 'bb'])
  })

  it('Г.О. fireRange 2–3: соседняя клетка запрещена', () => {
    expect(getFireRangeBounds('hyper')).toEqual({ min: 2, max: 3 })

    const map = createEmptyMap('hyper-range', 'Hyper')
    for (const c of [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ]) {
      map.cells.push(c)
    }
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1', 'hyper', 'att-hy')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-near')
    addShip(game, 2, 0, 'player-2', 'destroyer', 'def-mid')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const keys = getBombardmentTargetKeys(game, 'player-1', { q: 0, r: 0 }, 'hyper')
    expect(keys).not.toContain('1,0')
    expect(keys).toContain('2,0')

    const nearErrors = validateBombardmentTarget(
      game,
      'player-1',
      { q: 0, r: 0 },
      { id: 'att-hy', type: 'hyper', ownerId: 'player-1' },
      { q: 1, r: 0 },
    )
    expect(nearErrors.some((e) => /минимум 2/i.test(e))).toBe(true)

    const boundsGap = getEffectiveFireRangeBounds(game, 'hyper')
    expect(boundsGap.max).toBe(3)
  })

  it('обстрел: защитник не бросает; урон = сумма обстрела', () => {
    const map = createEmptyMap('bomb-dice', 'Bomb')
    map.cells.push({ q: 0, r: 0 }, { q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildBombardmentPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-cr', type: 'cruiser', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )
    expect(preview).not.toBeNull()
    expect(preview!.defender.combatDiceTotal).toBe(0)
    expect(preview!.defender.supportingShips).toEqual([])

    const round = rollCombatRound(preview!, () => 0.99)
    expect(round.defenderTotal).toBe(0)
    expect(round.shipRolls.every((r) => r.side === 'attacker')).toBe(true)
    expect(round.winner).toBe('attacker')
    expect(computeRoundDamage(round)).toBe(round.attackerTotal)
  })

  it('несколько целей обстрела за маркер — группировка и валидация', () => {
    const map = createEmptyMap('multi-bomb', 'Multi')
    map.cells.push({ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr1')
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 0, 1, 'player-2', 'destroyer', 'def-b')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.controlOwnerId = 'player-2'
    expect(addActionMarker(game, 'player-1', { q: 0, r: 0 })).toEqual([])
    game.phase = 'actions'

    const plans = [
      { shipId: 'att-cr1', target: { q: 1, r: 0 } },
      { shipId: 'att-cr2', target: { q: 0, r: 1 } },
    ]
    expect(validateMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, plans)).toEqual([])
    expect(groupBombardmentPlansByTarget(plans)).toHaveLength(2)
  })
})
