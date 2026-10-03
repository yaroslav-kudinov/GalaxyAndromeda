import { describe, expect, it } from 'vitest'
import { createEmptyMap, normalizeMapDefinition } from './map.js'
import { hexKey } from './types.js'
import { gameSnapshotFromMap } from './save-file.js'
import {
  advanceScenarioProgress,
  canPerformScenarioAction,
  dismissScenarioProgress,
  getCurrentStep,
  getVisibleStep,
  manualAdvanceProgress,
  restoreScenarioProgress,
  scenarioRestrictsActions,
  filterScenarioLegalActions,
  initScenarioProgress,
  scenarioActionError,
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

  it('«сдаться» в обучении не разрешено — ни на шаге, ни после прохождения сценария', () => {
    const surrender = { id: 'surrender', type: 'surrender' as const, description: 'Сдаться' }
    const marker = { id: 'toggle-marker', type: 'marker' as const, description: 'Маркер' }
    const markerStep: ScenarioStep = { ...manualStep, id: 'marker', allowedActions: ['toggle-marker'] }

    expect(canPerformScenarioAction(markerStep, 'surrender')).toBe(false)
    // Шага нет: сценарий пройден, полигон свободный — но сдаваться на нём всё равно нельзя.
    expect(canPerformScenarioAction(null, 'surrender')).toBe(false)
    expect(canPerformScenarioAction(null, 'toggle-marker')).toBe(true)

    expect(filterScenarioLegalActions(markerStep, [surrender, marker]).map((a) => a.id))
      .toEqual(['toggle-marker'])
    expect(filterScenarioLegalActions(null, [surrender, marker]).map((a) => a.id))
      .toEqual(['toggle-marker'])

    expect(scenarioActionError(null, 'surrender')).toMatch(/сдаться нельзя/)
    expect(scenarioActionError(null, 'toggle-marker')).toBeNull()
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

describe('подсказчик обычной партии', () => {
  function coachScript(steps: ScenarioStep[]): ScenarioScript {
    return parseScenarioScript({
      id: 'test-coach',
      kind: 'coach',
      name: 'Подсказки',
      solo: false,
      botPolicy: 'passive',
      steps,
    })
  }

  const tip: ScenarioStep = {
    id: 'tip',
    title: 'Подсказка',
    body: 'Текст',
    advanceWhen: { type: 'manual' },
  }

  it('подсказчику карта не нужна, полигону без карты — отказ', () => {
    expect(coachScript([tip, tip]).mapId).toBeUndefined()
    expect(() => parseScenarioScript({
      id: 'broken',
      name: 'Полигон без карты',
      solo: true,
      botPolicy: 'passive',
      steps: [tip],
    })).toThrow('Неполный сценарий')
  })

  it('подсказчик ничего не запрещает: ограничения снимаются при разборе', () => {
    const restricted: ScenarioStep = { ...tip, allowedActions: ['toggle-marker'] }
    const parsed = coachScript([restricted])
    expect(parsed.steps[0]!.allowedActions).toBeUndefined()
    expect(canPerformScenarioAction(parsed.steps[0]!, 'advance-phase')).toBe(true)
    expect(scenarioRestrictsActions(parsed)).toBe(false)
  })

  it('«@me» подставляется получателем подсказки', () => {
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    game.cells[0]!.controlOwnerId = 'player-2'
    const step: ScenarioStep = {
      ...tip,
      advanceWhen: { type: 'controlled-cells', playerId: '@me', atLeast: 1 },
    }
    expect(shouldAdvanceScenario(step, game, undefined, undefined, { selfPlayerId: 'player-2' }))
      .toBe(true)
    expect(shouldAdvanceScenario(step, game, undefined, undefined, { selfPlayerId: 'player-1' }))
      .toBe(false)
    // Без получателя условие не сбывается молча, а просто не сбывается.
    expect(shouldAdvanceScenario(step, game)).toBe(false)
  })

  it('считает ход, центры власти, корабли и области', () => {
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    game.turnNumber = 4
    expect(shouldAdvanceScenario({ ...tip, advanceWhen: { type: 'turn', atLeast: 4 } }, game)).toBe(true)
    expect(shouldAdvanceScenario({ ...tip, advanceWhen: { type: 'turn', atLeast: 5 } }, game)).toBe(false)
    expect(shouldAdvanceScenario({ ...tip, advanceWhen: { type: 'turn', atMost: 3 } }, game)).toBe(false)

    game.cells[0]!.isPowerCenter = true
    game.cells[0]!.controlOwnerId = 'player-1'
    game.cells[0]!.ships.push({ id: 'ship-1', type: 'cruiser', ownerId: 'player-1' })
    const extras = { selfPlayerId: 'player-1' }
    expect(shouldAdvanceScenario(
      { ...tip, advanceWhen: { type: 'power-centers', playerId: '@me', atLeast: 1 } },
      game, undefined, undefined, extras,
    )).toBe(true)
    expect(shouldAdvanceScenario(
      { ...tip, advanceWhen: { type: 'ships', playerId: '@me', shipType: 'cruiser', atLeast: 1 } },
      game, undefined, undefined, extras,
    )).toBe(true)
    expect(shouldAdvanceScenario(
      { ...tip, advanceWhen: { type: 'ships', playerId: '@me', shipType: 'destroyer', atLeast: 1 } },
      game, undefined, undefined, extras,
    )).toBe(false)
    expect(shouldAdvanceScenario(
      { ...tip, advanceWhen: { type: 'not', condition: { type: 'turn', atLeast: 9 } } },
      game,
    )).toBe(true)
  })

  it('отличает разрезанную территорию от связной: это и есть «котёл» из разбора', () => {
    // Полоса из четырёх клеток: на ней видно и связную территорию, и разрезанную.
    const game = gameSnapshotFromMap(normalizeMapDefinition({
      id: 'strip',
      name: 'Полоса',
      playerCount: 2,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
    }))
    const byKey = new Map(game.cells.map((cell) => [hexKey(cell.coord.q, cell.coord.r), cell]))
    const own = (q: number, r: number) => {
      const cell = byKey.get(hexKey(q, r))
      expect(cell).toBeDefined()
      cell!.controlOwnerId = 'player-1'
    }
    const extras = { selfPlayerId: 'player-1' }
    const split: ScenarioStep = {
      ...tip,
      advanceWhen: { type: 'regions', playerId: '@me', atLeast: 2 },
    }

    own(0, 0)
    own(1, 0)
    expect(shouldAdvanceScenario(split, game, undefined, undefined, extras)).toBe(false)

    // Клетка, оторванная от остальных, — вторая область.
    own(3, 0)
    expect(shouldAdvanceScenario(split, game, undefined, undefined, extras)).toBe(true)

    // Соединили — снова одна область.
    own(2, 0)
    expect(shouldAdvanceScenario(split, game, undefined, undefined, extras)).toBe(false)
  })

  it('шаг с showWhen молчит до своего момента и не проходится раньше', () => {
    const waiting: ScenarioStep = {
      ...tip,
      id: 'waiting',
      showWhen: { type: 'turn', atLeast: 3 },
    }
    const scenario = coachScript([waiting, tip])
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    const progress = initScenarioProgress(scenario.id)

    expect(getCurrentStep(scenario, progress)?.id).toBe('waiting')
    expect(getVisibleStep(scenario, progress, game)).toBeNull()
    expect(manualAdvanceProgress(scenario, progress, game)).toEqual(progress)

    game.turnNumber = 3
    expect(getVisibleStep(scenario, progress, game)?.id).toBe('waiting')
    expect(manualAdvanceProgress(scenario, progress, game).stepIndex).toBe(1)
  })

  it('выключенные подсказки прячут шаг, включённые возвращают очередь', () => {
    const scenario = coachScript([tip, tip])
    const game = gameSnapshotFromMap(createEmptyMap('test-map', 'Test'))
    const progress = initScenarioProgress(scenario.id)
    const off = dismissScenarioProgress(progress)
    expect(getCurrentStep(scenario, off)).toBeNull()
    expect(getVisibleStep(scenario, off, game)).toBeNull()
    expect(getVisibleStep(scenario, restoreScenarioProgress(off), game)?.id).toBe('tip')
  })
})
