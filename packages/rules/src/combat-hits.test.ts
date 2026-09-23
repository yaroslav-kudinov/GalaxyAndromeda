import { describe, expect, it } from 'vitest'
import {
  allocateDice,
  canShipFireFromDistance,
  carrierBonusAtDistance,
  defaultTargetOrder,
  hitProbability,
  shipFireRange,
  shipHitThreshold,
  shipHullInBattle,
  type CombatTargetState,
} from './combat-hits.js'

describe('бой на попаданиях: порог, дальность, прочность', () => {
  it('порог попадания в своей клетке задан классом', () => {
    expect(shipHitThreshold('destroyer')).toBe(6)
    expect(shipHitThreshold('cruiser')).toBe(5)
    expect(shipHitThreshold('battleship')).toBe(4)
    expect(shipHitThreshold('hyper', 2)).toBe(5)
    expect(shipHitThreshold('carrier')).toBeNull()
  })

  it('каждая клетка расстояния прибавляет 1, семь и больше — выстрел невозможен', () => {
    expect(shipHitThreshold('destroyer', 1)).toBeNull()
    expect(shipHitThreshold('cruiser', 1)).toBe(6)
    expect(shipHitThreshold('cruiser', 2)).toBeNull()
    expect(shipHitThreshold('battleship', 2)).toBe(6)
    expect(shipHitThreshold('battleship', 3)).toBeNull()
    expect(shipHitThreshold('hyper', 3)).toBe(6)
    expect(shipHitThreshold('hyper', 4)).toBeNull()
  })

  it('дальность выводится из точности; у гиперорудия сохранён минимум 2', () => {
    expect(shipFireRange('destroyer')).toEqual({ min: 0, max: 0 })
    expect(shipFireRange('cruiser')).toEqual({ min: 0, max: 1 })
    expect(shipFireRange('battleship')).toEqual({ min: 0, max: 2 })
    expect(shipFireRange('hyper')).toEqual({ min: 2, max: 3 })
    expect(shipFireRange('carrier')).toBeNull()

    // Гиперорудие не бьёт ни по своей, ни по соседней клетке.
    expect(shipHitThreshold('hyper', 0)).toBeNull()
    expect(shipHitThreshold('hyper', 1)).toBeNull()

    expect(canShipFireFromDistance('destroyer')).toBe(false)
    expect(canShipFireFromDistance('cruiser')).toBe(true)
    expect(canShipFireFromDistance('carrier')).toBe(false)
  })

  it('поправка к броску сдвигает и дальность: −1 даёт крейсеру вторую клетку', () => {
    expect(shipHitThreshold('cruiser', 2, -1)).toBe(6)
    expect(shipFireRange('cruiser', -1)).toEqual({ min: 0, max: 2 })
    expect(shipFireRange('cruiser', 1)).toEqual({ min: 0, max: 0 })
    // Единица на кубике — промах при любых поправках.
    expect(shipHitThreshold('hyper', 2, -4)).toBe(2)
  })

  it('гиперорудие в бою на своей клетке держит одно попадание', () => {
    expect(shipHullInBattle('hyper')).toBe(1)
    expect(shipHullInBattle('battleship')).toBe(3)
  })

  it('вероятности попадания по порогу', () => {
    expect(hitProbability(6)).toBeCloseTo(1 / 6)
    expect(hitProbability(5)).toBeCloseTo(1 / 3)
    expect(hitProbability(4)).toBeCloseTo(1 / 2)
    expect(hitProbability(3)).toBeCloseTo(2 / 3)
    expect(hitProbability(null)).toBe(0)
  })

  it('авианосец: +2 на своей клетке, +1 на соседней, дальше ничего', () => {
    expect(carrierBonusAtDistance(0)).toBe(2)
    expect(carrierBonusAtDistance(1)).toBe(1)
    expect(carrierBonusAtDistance(2)).toBe(0)
  })
})

describe('распределение кубиков по целям', () => {
  const destroyer: CombatTargetState = { shipId: 'dd', type: 'destroyer', hull: 1, damage: 0, threat: 1 / 6 }
  const cruiser: CombatTargetState = { shipId: 'cr', type: 'cruiser', hull: 2, damage: 0, threat: 2 / 3 }
  const damagedBattleship: CombatTargetState = { shipId: 'bb', type: 'battleship', hull: 3, damage: 2, threat: 1.5 }

  it('по умолчанию первым идёт подбитый дорогой корабль', () => {
    expect(defaultTargetOrder([destroyer, cruiser, damagedBattleship]).map((t) => t.shipId))
      .toEqual(['bb', 'cr', 'dd'])
  })

  it('кубики идут на цель, пока ожидаемых попаданий не хватит, затем на следующую', () => {
    // 4 кубика на 4+: ожидаемо по 0,5. Добитому линкору (1 прочность) хватает двух.
    const dice = Array.from({ length: 4 }, () => ({ shooterShipId: 'my-bb', threshold: 4 }))
    expect(allocateDice(dice, [damagedBattleship, cruiser])).toEqual(['bb', 'bb', 'cr', 'cr'])
  })

  it('лишние кубики после покрытия всех целей идут по кругу', () => {
    const dice = Array.from({ length: 5 }, () => ({ shooterShipId: 'hy', threshold: 2 }))
    expect(allocateDice(dice, [destroyer])).toEqual(['dd', 'dd', 'dd', 'dd', 'dd'])
  })

  it('порядок целей игрока важнее порядка по умолчанию', () => {
    const dice = [{ shooterShipId: 'cr', threshold: 5 }]
    expect(allocateDice(dice, [cruiser, destroyer], { targetPriority: ['dd'] })).toEqual(['dd'])
  })

  it('явные назначения выполняются, устаревшие цели отбрасываются', () => {
    const dice = [
      { shooterShipId: 'a', threshold: 5 },
      { shooterShipId: 'a', threshold: 5 },
      { shooterShipId: 'b', threshold: 6 },
    ]
    const out = allocateDice(dice, [destroyer, cruiser], {
      explicit: { a: ['dd', 'gone'], b: ['cr'] },
    })
    expect(out[0]).toBe('dd')
    expect(out[2]).toBe('cr')
    // Второй кубик «a» целился в уничтоженный корабль — достаётся автоматике.
    expect(out[1]).not.toBeNull()
  })

  it('без целей кубикам некуда стрелять', () => {
    expect(allocateDice([{ shooterShipId: 'a', threshold: 5 }], [])).toEqual([null])
  })
})
