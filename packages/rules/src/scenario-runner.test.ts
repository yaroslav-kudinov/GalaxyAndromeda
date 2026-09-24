import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { gameSnapshotFromMap } from './save-file.js'
import {
  advanceScenarioProgress,
  canPerformScenarioAction,
  filterScenarioLegalActions,
  initScenarioProgress,
  shouldAdvanceScenario,
} from './scenario-runner.js'
import { parseScenarioScript, type ScenarioScript, type ScenarioStep } from './scenario.js'

const manualStep: ScenarioStep = {
  id: 'read',
  title: 'Прочитайте',
  body: 'Текст',
  allowedActions: [],
  advanceWhen: { type: 'manual' },
}

function script(step = manualStep): ScenarioScript {
  return parseScenarioScript({
    id: 'test-tutorial',
    name: 'Тест',
    mapId: 'test-map',
    solo: true,
    botPolicy: 'passive',
    bots: [
      { playerId: 'player-2', name: 'Защитник' },
      { playerId: 'player-3', name: 'Поддержка' },
    ],
    steps: [step, manualStep],
  })
}

describe('scenario runner', () => {
  it('запрещает игровые действия на информационном шаге', () => {
    expect(canPerformScenarioAction(manualStep, 'advance-phase')).toBe(false)
    expect(filterScenarioLegalActions(manualStep, [
      { id: 'advance-phase', type: 'phase', description: 'Далее' },
      { id: 'hint', type: 'info', description: 'Подсказка' },
    ])).toEqual([{ id: 'hint', type: 'info', description: 'Подсказка' }])
  })

  it('обязательные решения партии обучение не ограничивает — иначе шаг стал бы тупиком', () => {
    const markerStep: ScenarioStep = { ...manualStep, id: 'marker', allowedActions: ['toggle-marker'] }
    for (const actionId of ['execute-recharge-picks', 'execute-claim-picks', 'execute-siege-losses', 'choose-doctrine']) {
      expect(canPerformScenarioAction(markerStep, actionId)).toBe(true)
      expect(canPerformScenarioAction(manualStep, actionId)).toBe(true)
    }
    expect(canPerformScenarioAction(markerStep, 'advance-phase')).toBe(false)
    expect(filterScenarioLegalActions(manualStep, [
      { id: 'execute-recharge-picks', type: 'rechargePicks', description: 'Фишки' },
      { id: 'advance-phase', type: 'phase', description: 'Далее' },
    ]).map((action) => action.id)).toEqual(['execute-recharge-picks'])
  })

  it('сверяет только важную часть вложенных параметров действия', () => {
    const step: ScenarioStep = {
      ...manualStep,
      allowedActions: [{
        actionId: 'execute-marker-movement',
        params: {
          from: { q: -5, r: 0 },
          moves: [{ to: { q: -3, r: 0 } }],
        },
      }],
    }
    expect(canPerformScenarioAction(step, 'execute-marker-movement', {
      from: { q: -5, r: 0 },
      moves: [
        { shipId: 'ship-a', to: { q: -3, r: 0 } },
        { shipId: 'ship-b', to: { q: -3, r: 0 } },
      ],
    })).toBe(true)
    expect(canPerformScenarioAction(step, 'execute-marker-movement', {
      from: { q: -5, r: 0 },
      moves: [{ shipId: 'ship-a', to: { q: -4, r: 0 } }],
    })).toBe(false)
  })

  it('не принимает действие учебного бота за действие ученика', () => {
    const step: ScenarioStep = {
      ...manualStep,
      advanceWhen: { type: 'action', actionId: 'advance-phase', playerId: 'player-1' },
    }
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    expect(shouldAdvanceScenario(step, game, { actionId: 'advance-phase' }, 'player-2')).toBe(false)
    expect(shouldAdvanceScenario(step, game, { actionId: 'advance-phase' }, 'player-1')).toBe(true)
  })

  it('проверяет контроль и корабли на целевой клетке', () => {
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    game.cells[0]!.controlOwnerId = 'player-1'
    game.cells[0]!.ships.push({
      id: 'ship-1',
      type: 'cruiser',
      ownerId: 'player-1',
    })
    const step: ScenarioStep = {
      ...manualStep,
      advanceWhen: {
        type: 'cell',
        coord: { q: 0, r: 0 },
        controlOwnerId: 'player-1',
        ship: { ownerId: 'player-1', type: 'cruiser' },
      },
    }
    expect(shouldAdvanceScenario(step, game)).toBe(true)
  })

  it('продвигает прогресс только после совпавшего действия', () => {
    const step: ScenarioStep = {
      ...manualStep,
      advanceWhen: {
        type: 'action',
        actionId: 'toggle-marker',
        playerId: 'player-1',
        params: { coord: { q: -5, r: 0 }, kind: 'action' },
      },
    }
    const scenario = script(step)
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    const initial = initScenarioProgress(scenario.id)
    expect(advanceScenarioProgress(
      scenario,
      initial,
      game,
      { actionId: 'toggle-marker', params: { coord: { q: 0, r: 0 }, kind: 'action' } },
      'player-1',
    )).toEqual(initial)
    expect(advanceScenarioProgress(
      scenario,
      initial,
      game,
      { actionId: 'toggle-marker', params: { coord: { q: -5, r: 0 }, kind: 'action' } },
      'player-1',
    ).stepIndex).toBe(1)
  })

  it('продвигает шаг боя только когда есть итог для показа', () => {
    const step: ScenarioStep = {
      ...manualStep,
      advanceWhen: { type: 'combat', status: 'resolved' },
    }
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    expect(shouldAdvanceScenario(step, game)).toBe(false)
    expect(shouldAdvanceScenario(step, game, undefined, undefined, { hasCombatResult: false })).toBe(false)
    expect(shouldAdvanceScenario(step, game, undefined, undefined, { hasCombatResult: true })).toBe(true)

    const activeStep: ScenarioStep = {
      ...manualStep,
      advanceWhen: { type: 'combat', status: 'active' },
    }
    expect(shouldAdvanceScenario(activeStep, game)).toBe(false)
  })

  it('нормализует два учебных флота', () => {
    const scenario = script()
    expect(scenario.bots?.map((bot) => bot.playerId)).toEqual(['player-2', 'player-3'])
    expect(scenario.botPlayerId).toBe('player-2')
  })
})
