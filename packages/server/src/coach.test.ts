import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { normalizeMapDefinition, type GameObservation } from '@galaxy/rules'

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Своё хранилище на файл теста: node --test гоняет файлы параллельно, а одна
// база SQLite на двоих даёт «database is locked».
process.env.GALAXY_DATA_DIR = mkdtempSync(join(tmpdir(), 'galaxy-coach-'))
// Комнаты теста на диск не пишем.
process.env.GALAXY_DEV_ROOMS = '0'
const rooms = await import('./room.js')
const { attachCoachToRoom, manualAdvanceScenarioStep, setScenarioHintsDismissed } = await import('./bot-tick.js')

const map = normalizeMapDefinition(
  JSON.parse(readFileSync(new URL('../../../maps/bundled/trio-start.json', import.meta.url), 'utf8')),
)

const COACH_ID = 'coach-first-match'

interface CoachExtras {
  kind?: 'tutorial' | 'coach'
  hintsDismissed?: boolean
  completed?: boolean
  scenarioStep?: { id: string; manual: boolean; stepNumber: number; stepCount: number }
}

function coachOf(obs: GameObservation): CoachExtras | undefined {
  return (obs as GameObservation & { tutorial?: CoachExtras }).tutorial
}

/** Лог сервера многословен; в тесте он только мешает. */
function quietly<T>(run: () => T): T {
  const log = console.log
  console.log = () => {}
  try {
    return run()
  } finally {
    console.log = log
  }
}

function startedRoomWithCoach() {
  const room = quietly(() => rooms.createRoom(map, 3))
  const attached = attachCoachToRoom(room, COACH_ID)
  assert.equal(attached.ok, true, 'подсказчик должен найтись в засеянной базе')
  const host = rooms.joinRoom(room.id, 'Человек', 'player-1')
  assert.ok(host.ok)
  const guest = rooms.joinRoom(room.id, 'Второй', 'player-2')
  assert.ok(guest.ok)
  const start = quietly(() => rooms.startRoom(room.id, 'player-1'))
  assert.ok(start.ok)
  return room
}

describe('подсказчик в обычной партии', () => {
  it('комната остаётся обычной: режим, лимит ходов и кубики не подменяются', () => {
    const room = startedRoomWithCoach()
    assert.notEqual(room.mode, 'tutorial')
    assert.equal(room.state.scriptedDiceValue, undefined, 'кубики в обычной партии честные')
    assert.ok(room.state.turnLimit != null, 'лимит ходов обычной партии на месте')
  })

  it('первая подсказка — про две части хода, и она ждёт нажатия игрока', () => {
    const room = startedRoomWithCoach()
    const extras = coachOf(rooms.getObservation(room, 'player-1', false))
    assert.equal(extras?.kind, 'coach')
    assert.equal(extras?.scenarioStep?.id, 'phases-split')
    assert.equal(extras?.scenarioStep?.manual, true)
    assert.equal(extras?.scenarioStep?.stepNumber, 1)
  })

  it('подсказчик ничего не отрезает от законных действий', () => {
    const room = startedRoomWithCoach()
    const withCoach = rooms.getObservation(room, 'player-1', false).legalActions.map((a) => a.id)

    const plain = quietly(() => rooms.createRoom(map, 3))
    assert.ok(rooms.joinRoom(plain.id, 'Человек', 'player-1').ok)
    assert.ok(rooms.joinRoom(plain.id, 'Второй', 'player-2').ok)
    assert.ok(quietly(() => rooms.startRoom(plain.id, 'player-1')).ok)
    const without = rooms.getObservation(plain, 'player-1', false).legalActions.map((a) => a.id)

    assert.deepEqual(new Set(withCoach), new Set(without))
  })

  it('подсказки видит только хозяин комнаты', () => {
    const room = startedRoomWithCoach()
    assert.equal(coachOf(rooms.getObservation(room, 'player-1', false))?.kind, 'coach')
    assert.equal(coachOf(rooms.getObservation(room, 'player-2', false)), undefined)
  })

  it('«Понятно» двигает очередь, следующая подсказка ждёт фазы действий', () => {
    const room = startedRoomWithCoach()
    assert.equal(manualAdvanceScenarioStep(room), true)
    // Вторая подсказка про фазу действий: в планировании она молчит, очередь не теряется.
    assert.equal(coachOf(rooms.getObservation(room, 'player-1', false))?.scenarioStep, undefined)
    assert.equal(room.state.scenarioProgress?.stepIndex, 1)

    room.state.phase = 'actions'
    assert.equal(
      coachOf(rooms.getObservation(room, 'player-1', false))?.scenarioStep?.id,
      'phases-actions',
    )
  })

  it('подсказка про области приходит, когда территория действительно распалась', () => {
    const room = startedRoomWithCoach()
    const split = room.state.scenarioProgress!
    // Перематываем очередь к шагу про области.
    const target = 6
    room.state.scenarioProgress = { ...split, stepIndex: target }
    room.state.phase = 'actions'
    room.state.turnNumber = 2

    const own = (q: number, r: number) => {
      const cell = room.state.cells.find((c) => c.coord.q === q && c.coord.r === r)
      assert.ok(cell, `клетка (${q}, ${r}) должна быть на карте`)
      cell.controlOwnerId = 'player-1'
    }
    for (const cell of room.state.cells) {
      if (cell.controlOwnerId === 'player-1') cell.controlOwnerId = null
    }
    own(0, 0)
    own(1, 0)
    assert.equal(
      coachOf(rooms.getObservation(room, 'player-1', false))?.scenarioStep,
      undefined,
      'территория связная — объяснять пока нечего',
    )

    own(3, 0)
    assert.equal(
      coachOf(rooms.getObservation(room, 'player-1', false))?.scenarioStep?.id,
      'regions-production',
    )
  })

  it('подсказки выключаются и возвращаются, очередь не сбрасывается', () => {
    const room = startedRoomWithCoach()
    assert.equal(manualAdvanceScenarioStep(room), true)
    const stepIndex = room.state.scenarioProgress?.stepIndex

    assert.equal(setScenarioHintsDismissed(room, true), true)
    const off = coachOf(rooms.getObservation(room, 'player-1', false))
    assert.equal(off?.hintsDismissed, true)
    assert.equal(off?.scenarioStep, undefined)

    assert.equal(setScenarioHintsDismissed(room, false), true)
    assert.equal(room.state.scenarioProgress?.stepIndex, stepIndex, 'очередь сохранилась')
  })

  it('на полигон подсказчика не ставят, а сценарий полигона не выдают за подсказчика', () => {
    const room = quietly(() => rooms.createRoom(map, 3))
    assert.equal(attachCoachToRoom(room, 'tutorial-basics').ok, false)
    room.mode = 'tutorial'
    assert.equal(attachCoachToRoom(room, COACH_ID).ok, false)
  })
})
