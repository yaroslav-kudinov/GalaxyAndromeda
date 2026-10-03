import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyGameActionOnSnapshot,
  combatPrepOf,
  getLegalActionsForSnapshot,
  parseScenarioScript,
  tickCombatPrepCountdown,
  resolveCombatPrep,
} from './index.js'
import { gameSnapshotFromMap } from './save-file.js'
import { normalizeMapDefinition, validateMapDefinition } from './map.js'
import type { MapDefinition } from './types.js'

function loadTutorialMap(): MapDefinition {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), '../../maps/bundled/tutorial-corridor.json'), 'utf8'),
  )
  const map = normalizeMapDefinition(raw)
  expect(validateMapDefinition(map)).toEqual([])
  return map
}

function loadTutorialScenario() {
  return parseScenarioScript(
    JSON.parse(
      readFileSync(resolve(process.cwd(), '../../scenarios/tutorial-basics.json'), 'utf8'),
    ),
  )
}

describe('tutorial corridor', () => {
  it('карта скрытого коридора валидна и рассчитана на троих', () => {
    const map = loadTutorialMap()
    expect(map.id).toBe('tutorial-corridor')
    expect(map.playerCount).toBe(3)
    expect(map.cells.length).toBeGreaterThanOrEqual(18)
    expect(map.cells.length).toBeLessThanOrEqual(24)
  })

  it('сценарий задаёт двух учебных ботов и ограничения шагов', () => {
    const scenario = loadTutorialScenario()
    expect(scenario.mapId).toBe('tutorial-corridor')
    expect(scenario.bots?.map((bot) => bot.playerId)).toEqual(['player-2', 'player-3'])
    expect(scenario.steps.length).toBeGreaterThanOrEqual(12)
    const markerStep = scenario.steps.find((step) => step.id === 'marker-cruisers')
    expect(markerStep?.allowedActions?.[0]).toMatchObject({
      actionId: 'toggle-marker',
      params: { coord: { q: -5, r: 0 }, kind: 'action' },
    })
  })

  it('после ожидания обстрела и боя идут ручные шаги осознания итога', () => {
    const scenario = loadTutorialScenario()
    const ids = scenario.steps.map((step) => step.id)
    const bombardmentWait = ids.indexOf('bombardment-wait')
    const battleWait = ids.indexOf('battle-wait')
    expect(bombardmentWait).toBeGreaterThanOrEqual(0)
    expect(battleWait).toBeGreaterThanOrEqual(0)
    expect(ids[bombardmentWait + 1]).toBe('bombardment-result')
    expect(scenario.steps[bombardmentWait + 1]?.advanceWhen).toEqual({ type: 'manual' })
    expect(ids[battleWait + 1]).toBe('battle-result')
    expect(scenario.steps[battleWait + 1]?.advanceWhen).toEqual({ type: 'manual' })
  })

  it('урок про фазы стоит сразу после завершения первого планирования', () => {
    const scenario = loadTutorialScenario()
    const ids = scenario.steps.map((step) => step.id)
    expect(ids[ids.indexOf('finish-planning-one') + 1]).toBe('phases-explained')
    const step = scenario.steps.find((s) => s.id === 'phases-explained')!
    // Шаг обязан назвать признак, по которому игрок отличит фазы в своей партии: плашку
    // фазы, её цвет и названия фаз. На рамку экрана ссылаться нельзя — она работает
    // боковым зрением, а не чтением (согласовано с блоком A плана).
    const text = [step.objective, step.why, step.hint].join(' ')
    expect(text).toContain('плашка')
    expect(text).toContain('янтарный')
    expect(text).toContain('Планирование')
    expect(text).toContain('Действия')
    expect(text).not.toContain('рамка')
    expect(step.highlight).toBe('phase-panel')
    expect(step.advanceWhen).toEqual({ type: 'manual' })
  })

  it('последняя треть — свободный ход, а не четыре экрана текста', () => {
    const scenario = loadTutorialScenario()
    const ids = scenario.steps.map((step) => step.id)
    for (const removed of ['shield-carrier', 'battleship-hyper', 'regions-resources', 'victory-surrender']) {
      expect(ids).not.toContain(removed)
    }
    const free = scenario.steps.find((step) => step.id === 'free-play')!
    // Свободный шаг ничего не запрещает и ждёт результата, а не нажатия в нужную клетку.
    expect(free.allowedActions).toBeUndefined()
    expect(free.advanceWhen).toEqual({
      type: 'power-centers',
      playerId: 'player-1',
      atLeast: 2,
    })
    expect(free.hint).toBeTruthy()
    expect(ids[ids.length - 1]).toBe('complete')
  })

  it('шаги про кнопку фазы не цитируют её подпись: подписи задаёт turn.ts', () => {
    const scenario = loadTutorialScenario()
    for (const id of ['finish-planning-one', 'finish-planning-two', 'finish-planning-three']) {
      const step = scenario.steps.find((s) => s.id === id)!
      for (const text of [step.objective, step.hint]) {
        expect(text).not.toContain('«Далее»')
        expect(text).not.toContain('Передать ход')
      }
    }
  })

  it('подсказчик первой партии не привязан ни к карте, ни к координатам', () => {
    const coach = parseScenarioScript(
      JSON.parse(
        readFileSync(resolve(process.cwd(), '../../scenarios/coach-first-match.json'), 'utf8'),
      ),
    )
    expect(coach.kind).toBe('coach')
    expect(coach.mapId).toBeUndefined()
    expect(coach.steps.length).toBeGreaterThanOrEqual(5)
    // Ни одного запрета и ни одной координаты: иначе подсказчик не поедет на чужой карте.
    const dump = JSON.stringify(coach.steps)
    expect(dump).not.toContain('allowedActions')
    expect(dump).not.toContain('"coord"')
    expect(dump).not.toContain('player-1')
    for (const step of coach.steps) {
      expect(step.advanceWhen).toEqual({ type: 'manual' })
      expect(step.showWhen).toBeDefined()
    }
    // Темы, которых игроку не хватило в разборе, должны быть названы.
    const ids = coach.steps.map((step) => step.id)
    expect(ids).toContain('phases-split')
    expect(ids).toContain('arrived-can-attack')
    expect(ids).toContain('resources-what-for')
    expect(ids).toContain('support-neighbours')
    expect(ids).toContain('regions-production')
    expect(ids).toContain('claim-connectivity')
  })

  it('неактивный защитник и поддержка получают готовность к бою в legalActions', () => {
    const map = loadTutorialMap()
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    // Раунд без потерь теперь ждёт выбора целей — кубики как в обучении, бой кончается в первом раунде.
    game.scriptedDiceValue = 6

    const source = game.cells.find((cell) => cell.coord.q === -3 && cell.coord.r === 0)!
    const home = game.cells.find((cell) => cell.coord.q === -5 && cell.coord.r === 0)!
    const target = game.cells.find((cell) => cell.coord.q === -1 && cell.coord.r === 0)!
    const cruisers = home.ships.filter((ship) => ship.ownerId === 'player-1' && ship.type === 'cruiser')
    expect(cruisers.length).toBe(2)
    home.ships = home.ships.filter((ship) => ship.ownerId !== 'player-1' || ship.type !== 'cruiser')
    source.ships.push(...cruisers)
    source.controlOwnerId = 'player-1'
    expect(target.ships.some((ship) => ship.ownerId === 'player-2')).toBe(true)

    game.actionMarkers.push({
      id: 'am-1',
      ownerId: 'player-1',
      coord: { q: -3, r: 0 },
      placedInPhase: 'planning',
    })
    source.actionMarkerId = 'am-1'

    const move = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: -3, r: 0 },
      moves: cruisers.map((ship) => ({ shipId: ship.id, to: { q: -1, r: 0 } })),
    })
    expect(move.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('prep')

    const defenderLegal = getLegalActionsForSnapshot(game, map.id, 'player-2')
    const supportLegal = getLegalActionsForSnapshot(game, map.id, 'player-3')
    expect(defenderLegal.map((action) => action.id)).toContain('update-combat-prep')
    expect(supportLegal.map((action) => action.id)).toContain('update-combat-prep')

    expect(
      applyGameActionOnSnapshot(game, map, 'player-3', 'update-combat-prep', {
        ready: true,
        supportSide: 'attacker',
      }).errors,
    ).toEqual([])
    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'update-combat-prep', {
        ready: true,
      }).errors,
    ).toEqual([])
    expect(
      applyGameActionOnSnapshot(game, map, 'player-1', 'update-combat-prep', {
        ready: true,
      }).errors,
    ).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')

    combatPrepOf(game.pendingCombat)!.countdownStartedAt = Date.now() - 4000
    expect(tickCombatPrepCountdown(game)).toBe(true)
    const resolved = resolveCombatPrep(game, map)
    expect(resolved.errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
  })
})
