import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  applyGameActionOnSnapshot,
  combatPrepOf,
  normalizeMapDefinition,
  planGreedyBotAction,
  resolveCombatPrep,
  type MarkerAttempts,
} from '@galaxy/rules'

// Комнаты теста на диск не пишем.
process.env.GALAXY_DEV_ROOMS = '0'
const rooms = await import('./room.js')
const { COMBAT_RESULT_HOLD_MS, stepLobbyBots } = await import('./lobby-bots.js')
const { getDebugLogs } = await import('./debug-log.js')

const map = normalizeMapDefinition(
  JSON.parse(readFileSync(new URL('../../../maps/bundled/trio-start.json', import.meta.url), 'utf8')),
)

function lobbyWithBots() {
  const room = rooms.createRoom(map, 3)
  const host = rooms.joinRoom(room.id, 'Человек', 'player-1')
  assert.equal(host.ok, true)
  return room
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

describe('боты в лобби', () => {
  it('хозяин сажает и убирает ботов, остальным нельзя', () => {
    const room = lobbyWithBots()
    const guest = rooms.joinRoom(room.id, 'Гость', 'player-2')
    assert.equal(guest.ok, true)
    assert.equal(rooms.addLobbyBot(room.id, 'player-2').ok, false)

    const bot = rooms.addLobbyBot(room.id, 'player-1')
    assert.ok(bot.ok)
    assert.equal(bot.botPlayerId, 'player-3')
    const seat = room.state.players.find((p) => p.id === 'player-3')!
    assert.equal(seat.name, 'Бот Альфа')
    assert.equal(seat.isAi, true)
    assert.equal(room.hostPlayerId, 'player-1')
    assert.equal(rooms.addLobbyBot(room.id, 'player-1').ok, false, 'мест больше нет')

    // За бота нельзя ни войти, ни сходить.
    assert.equal(rooms.rejoinRoom(room.id, 'player-3', 'Самозванец').ok, false)

    assert.equal(rooms.removeLobbyBot(room.id, 'player-1', 'player-2').ok, false, 'это человек')
    assert.ok(rooms.removeLobbyBot(room.id, 'player-1', 'player-3').ok)
    assert.equal(room.playerIds.includes('player-3'), false)
    assert.equal(seat.isAi, false)
    assert.equal(rooms.joinRoom(room.id, 'Второй гость', 'player-3').ok, true)
  })

  it('боты доигрывают свои ходы и ждут человека', () => {
    const room = lobbyWithBots()
    assert.ok(rooms.addLobbyBot(room.id, 'player-1').ok)
    assert.ok(rooms.addLobbyBot(room.id, 'player-1').ok)
    assert.ok(rooms.startRoom(room.id, 'player-1').ok)
    assert.throws(
      () => rooms.submitAction(room, 'player-2', { actionId: 'advance-phase' }, false),
      /бот/,
    )

    const rejected: string[] = []
    let botActions = 0
    const apply = (target: typeof room, botId: string, actionId: string, params?: Record<string, unknown>) => {
      const { errors } = applyGameActionOnSnapshot(target.state, target.map, botId, actionId, params)
      if (errors.length) {
        rejected.push(`${botId} ${actionId}: ${errors[0]}`)
        throw new Error(errors[0])
      }
      target.observationRevision += 1
      botActions += 1
    }

    // Человека ведёт тот же бот, но через обычный вход для игрока.
    const humanAttempts: MarkerAttempts = new Map()
    let now = Date.now()
    let humanActions = 0
    let idleWhileHumanActive = 0
    quietly(() => {
      for (let i = 0; i < 4000 && !room.state.gameOver && room.state.turnNumber < 4; i++) {
        now += 1000
        const prep = combatPrepOf(room.state.pendingCombat)
        if (prep?.phase === 'countdown') {
          // Отсчёт подготовки идёт по часам сервера — в тесте сразу к бою.
          resolveCombatPrep(room.state, room.map)
          room.observationRevision += 1
          continue
        }
        const step = stepLobbyBots(room, apply, now)
        if (step !== 'idle') continue
        if (room.state.activePlayerId === 'player-1' && !room.state.pendingCombat) idleWhileHumanActive += 1
        const planned = planGreedyBotAction(room.state, room.map, new Set(['player-1']), humanAttempts)
        assert.ok(planned, `партия встала: ход ${room.state.turnNumber}, ${room.state.phase}, ${room.state.activePlayerId}`)
        rooms.submitAction(room, planned.playerId, { actionId: planned.actionId, params: planned.params }, false)
        humanActions += 1
      }
    })

    assert.ok(room.state.turnNumber >= 4 || room.state.gameOver, `партия дошла до хода ${room.state.turnNumber}`)
    assert.ok(humanActions > 0)
    assert.ok(botActions > humanActions, `боты сходили ${botActions} раз`)
    assert.ok(idleWhileHumanActive > 0, 'в ход человека боты ждут')
    assert.deepEqual(rejected, [])
    const botLog = getDebugLogs(room.id).filter((entry) => entry.event.startsWith('lobby-bot.'))
    assert.deepEqual(botLog, [])
    for (const botId of ['player-2', 'player-3']) {
      const ships = room.state.cells.flatMap((cell) => cell.ships ?? []).filter((ship) => ship.ownerId === botId)
      assert.ok(ships.length > 0, `${botId} сохранил флот`)
    }
  })
  it('после боя с человеком боты ждут, пока он посмотрит итог', () => {
    const room = lobbyWithBots()
    assert.ok(rooms.addLobbyBot(room.id, 'player-1').ok)
    assert.ok(rooms.addLobbyBot(room.id, 'player-1').ok)
    assert.ok(rooms.startRoom(room.id, 'player-1').ok)
    let botActions = 0
    const apply = (target: typeof room, botId: string, actionId: string, params?: Record<string, unknown>) => {
      const { errors } = applyGameActionOnSnapshot(target.state, target.map, botId, actionId, params)
      if (errors.length) throw new Error(errors[0])
      target.observationRevision += 1
      botActions += 1
    }
    const now = Date.now()

    quietly(() => {
      // Окно итога открыто — боты стоят.
      room.combatResultHold = { humans: ['player-1'], since: now }
      assert.equal(stepLobbyBots(room, apply, now + 1000), 'waiting')
      assert.equal(botActions, 0)
      // Закрыл окно — боты пошли.
      rooms.acknowledgeCombatResult(room, 'player-1')
      assert.equal(room.combatResultHold, undefined)
      assert.equal(stepLobbyBots(room, apply, now + 2000), 'acted')

      // Сходил сам — значит, итог видел.
      room.combatResultHold = { humans: ['player-1'], since: now }
      rooms.submitAction(room, 'player-1', { actionId: 'choose-doctrine', params: { doctrineId: 'none' } }, false)
      assert.equal(room.combatResultHold, undefined)

      // Окно так и не закрыли — через минуту боты идут дальше.
      room.combatResultHold = { humans: ['player-1'], since: now }
      assert.equal(stepLobbyBots(room, apply, now + 5000), 'waiting')
      stepLobbyBots(room, apply, now + COMBAT_RESULT_HOLD_MS + 5000)
      assert.equal(room.combatResultHold, undefined)
    })
  })
  it('хозяин выбирает сложность каждого бота', () => {
    const room = lobbyWithBots()
    const hard = rooms.addLobbyBot(room.id, 'player-1', 'player-2', 'hard')
    assert.ok(hard.ok)
    assert.equal(rooms.lobbyBotDifficulty(room, 'player-2'), 'hard')
    // Без выбора — средний.
    assert.ok(rooms.addLobbyBot(room.id, 'player-1', 'player-3').ok)
    assert.equal(rooms.lobbyBotDifficulty(room, 'player-3'), 'medium')

    assert.ok(rooms.setLobbyBotDifficulty(room.id, 'player-1', 'player-3', 'easy').ok)
    assert.equal(rooms.lobbyBotDifficulty(room, 'player-3'), 'easy')
    assert.equal(rooms.setLobbyBotDifficulty(room.id, 'player-1', 'player-3', 'insane').ok, false)
    assert.equal(rooms.setLobbyBotDifficulty(room.id, 'player-1', 'player-1', 'easy').ok, false, 'это человек')

    assert.ok(rooms.removeLobbyBot(room.id, 'player-1', 'player-2').ok)
    assert.equal(room.botDifficulty?.['player-2'], undefined)

    assert.ok(rooms.startRoom(room.id, 'player-1').ok)
    assert.equal(rooms.setLobbyBotDifficulty(room.id, 'player-1', 'player-3', 'hard').ok, false, 'после старта не меняется')
  })
})
