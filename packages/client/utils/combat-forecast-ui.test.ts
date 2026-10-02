import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BattleOutcomeOdds, CombatDiceReport, RoundDamageForecast } from '@galaxy/rules'
import {
  diceBreakdownLines,
  formatShips,
  outcomeHeading,
  outcomeRows,
  roundDamageLine,
  roundDamageStats,
} from './combat-forecast-ui.js'

const round: RoundDamageForecast = {
  attackerHits: 0.5,
  defenderHits: 1.5,
  defenderLosses: 1.24,
  attackerLosses: 0.72,
  defenderAnyLoss: 0.8,
  attackerAnyLoss: 0.6,
}

const odds: BattleOutcomeOdds = { win: 0.57, draw: 0.08, defeat: 0.35 }

describe('числа прогноза по-русски', () => {
  it('дробное число берёт родительный падеж, целое — своё согласование', () => {
    assert.equal(formatShips(1.24), '1,2 корабля')
    assert.equal(formatShips(0.72), '0,7 корабля')
    assert.equal(formatShips(1), '1 корабль')
    assert.equal(formatShips(2), '2 корабля')
    assert.equal(formatShips(5), '5 кораблей')
    assert.equal(formatShips(0), '0 кораблей')
  })

  it('урон за раунд повёрнут к смотрящему', () => {
    const attacker = roundDamageStats(round, 'attacker')
    assert.deepEqual(attacker.map((s) => [s.label, s.value]), [
      ['Выбьете за раунд', '1,2 корабля'],
      ['Потеряете за раунд', '0,7 корабля'],
    ])

    const defender = roundDamageStats(round, 'defender')
    assert.deepEqual(defender.map((s) => [s.label, s.value]), [
      ['Выбьете за раунд', '0,7 корабля'],
      ['Потеряете за раунд', '1,2 корабля'],
    ])

    const observer = roundDamageStats(round, null)
    assert.deepEqual(observer.map((s) => s.label), [
      'Атакующий выбьет за раунд',
      'Защитник выбьет за раунд',
    ])
  })

  it('одной строкой — для свёрнутой панели', () => {
    assert.equal(
      roundDamageLine(round, 'attacker'),
      'выбьете за раунд 1,2 корабля, потеряете за раунд 0,7 корабля',
    )
  })
})

describe('исход боя до конца', () => {
  it('слова «взаимно» больше нет — есть «размен» с пояснением', () => {
    const rows = outcomeRows(odds, 'attacker')
    assert.deepEqual(rows.map((r) => r.label), ['Победа', 'Размен', 'Поражение'])
    assert.equal(rows[1]?.hint, 'оба флота уничтожены')
    assert.ok(!rows.some((r) => r.label.toLowerCase().includes('взаимно')))
  })

  it('защитнику победа и поражение меняются местами', () => {
    const rows = outcomeRows(odds, 'defender')
    assert.equal(rows[0]?.value, odds.defeat)
    assert.equal(rows[2]?.value, odds.win)
  })

  it('наблюдателю стороны названы прямо', () => {
    assert.deepEqual(outcomeRows(odds, null).map((r) => r.label), [
      'Победа атакующего',
      'Размен',
      'Победа защитника',
    ])
  })

  it('заголовок честно говорит, точный расчёт или оценка', () => {
    assert.equal(outcomeHeading(true), 'Если драться до конца')
    assert.equal(outcomeHeading(false), 'Если драться до конца (оценка)')
  })
})

describe('расшифровка кубиков', () => {
  it('называет корабль, клетку поддержки и итог — ровно случай из баг-репорта', () => {
    const report: CombatDiceReport = {
      role: 'defender',
      sources: [
        { shipId: 'def-dd', type: 'destroyer', ownerId: 'p-2', distance: 0, dice: 1, bonusDice: 0, threshold: 6 },
        {
          shipId: 'sup-cr',
          type: 'cruiser',
          ownerId: 'p-2',
          distance: 1,
          fromCoord: { q: -2, r: -1 },
          dice: 2,
          bonusDice: 0,
          threshold: 6,
        },
      ],
      silent: [],
      total: 3,
    }
    assert.deepEqual(diceBreakdownLines(report), [
      'Эсминец — 1 кубик, нужно 6+',
      'Крейсер с (-2, -1) — 2 кубика поддержки, нужно 6+',
      'Итого 3 кубика',
    ])
  })

  it('прибавку авианосца и безоружные корабли проговаривает отдельно', () => {
    const report: CombatDiceReport = {
      role: 'attacker',
      sources: [
        { shipId: 'att-cr', type: 'cruiser', ownerId: 'p-1', distance: 0, dice: 4, bonusDice: 2, threshold: 5 },
      ],
      silent: [{ shipId: 'att-cv', type: 'carrier', ownerId: 'p-1', reason: 'no-weapon' }],
      total: 4,
    }
    assert.deepEqual(diceBreakdownLines(report), [
      'Крейсер — 4 кубика, из них 2 кубика от авианосца, нужно 5+',
      'Авианосец — не стреляет: нет орудий',
      'Итого 4 кубика',
    ])
  })
})
