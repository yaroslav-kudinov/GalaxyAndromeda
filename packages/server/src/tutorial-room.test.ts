import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { surrenderPlayer, TUTORIAL_TURN_LIMIT } from '@galaxy/rules'

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Своё хранилище на файл теста: node --test гоняет файлы параллельно, а одна
// база SQLite на двоих даёт «database is locked».
process.env.GALAXY_DATA_DIR = mkdtempSync(join(tmpdir(), 'galaxy-tutorial-room-'))
// Комнаты теста на диск не пишем.
process.env.GALAXY_DEV_ROOMS = '0'
const rooms = await import('./room.js')

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

function tutorialRoom() {
  const created = quietly(() => rooms.createTutorialRoom('tutorial-basics', 'Ученик'))
  if (!created.ok) throw new Error(`учебная комната не создалась: ${created.error}`)
  return created
}

describe('учебная партия', () => {
  it('получает предел ходов, а не бесконечность', () => {
    const { room } = tutorialRoom()
    assert.equal(room.mode, 'tutorial')
    assert.equal(room.state.turnLimit, TUTORIAL_TURN_LIMIT)
    assert.ok(TUTORIAL_TURN_LIMIT > 0)
  })

  it('«сдаться» на полигоне не предлагается и не принимается', () => {
    const { room, playerId } = tutorialRoom()

    const obs = quietly(() => rooms.getObservation(room, playerId, false))
    assert.equal(
      obs.legalActions?.some((action) => action.id === 'surrender'),
      false,
      'кнопке «Сдаться» в обучении браться неоткуда',
    )

    assert.throws(
      () => quietly(() => rooms.submitAction(room, playerId, { actionId: 'surrender' })),
      /сдаться нельзя/,
      'сервер обязан отказать, даже если кнопку нажали в обход интерфейса',
    )
    assert.equal(room.state.players.find((p) => p.id === playerId)?.eliminated, false)
  })

  it('счётчик ходов не убегает: пустой полигон закрывается пределом ходов', () => {
    const { room, playerId } = tutorialRoom()
    // Так выглядел полигон в отчёте тестировщика: ученик с доски ушёл, остались два пассивных
    // бота. Учебные боты ходят на каждом запросе наблюдения — отсюда и росли ходы до 85-го.
    quietly(() => surrenderPlayer(room.state, room.map.id, playerId))
    assert.equal(room.state.players.find((p) => p.id === playerId)?.eliminated, true)

    let polls = 0
    while (polls < 2_000 && !room.state.gameOver) {
      quietly(() => rooms.getObservation(room, playerId, false))
      polls += 1
    }

    assert.ok(room.state.gameOver, 'партия обязана закончиться сама')
    assert.equal(room.state.gameOver?.reason, 'turn_limit')
    assert.equal(
      room.state.turnNumber,
      TUTORIAL_TURN_LIMIT + 1,
      'партия должна встать ровно на ходу за пределом',
    )
  })
})
