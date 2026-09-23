import { describe, expect, it } from 'vitest'
import {
  buildBombardmentPreview,
  getBombardmentTargetKeys,
  getEffectiveFireRangeBounds,
  getFireRangeBounds,
  groupBombardmentPlansByTarget,
  rollCombatRound,
  SHIP_DICE,
  SHIP_HIT_THRESHOLD,
  SHIP_HULL,
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

describe('По правилам (ADR 018: бой на попаданиях)', () => {
  it('таблица классов: кубики, попадание, прочность', () => {
    expect(SHIP_DICE).toEqual({ destroyer: 1, cruiser: 2, battleship: 3, carrier: 0, hyper: 3 })
    expect(SHIP_HIT_THRESHOLD).toEqual({ destroyer: 6, cruiser: 5, battleship: 4, hyper: 3 })
    expect(SHIP_HULL).toEqual({ destroyer: 1, cruiser: 2, battleship: 3, carrier: 2, hyper: 2 })
  })

  it('дальность = 6 − порог: эсминец 0, крейсер 1, линкор 2, гиперорудие 3', () => {
    expect(getFireRangeBounds('destroyer').max).toBe(0)
    expect(getFireRangeBounds('cruiser').max).toBe(1)
    expect(getFireRangeBounds('battleship').max).toBe(2)
    expect(getFireRangeBounds('hyper').max).toBe(3)
  })

  it('гиперорудие: дальность 2–3, соседняя клетка запрещена', () => {
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

  it('обстрел: защитник не отвечает; крейсер с соседней клетки бьёт на 6+', () => {
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
    expect(preview!.defender.diceTotal).toBe(0)
    expect(preview!.attacker.supportingShips[0]?.threshold).toBe(6)

    const round = rollCombatRound(preview!, {}, {}, () => 0.99)
    expect(round.defenderHits).toBe(0)
    expect(round.shipRolls.every((r) => r.side === 'attacker')).toBe(true)
    expect(round.destroyedShipIds).toEqual(['def-dd'])
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
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.isPowerCenter = true
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.controlOwnerId = 'player-1'
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
