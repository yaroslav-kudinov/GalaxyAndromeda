import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { planGreedyBotAction } from './greedy-bot.js'
import { beginMatchForParticipants } from './match-start.js'
import { applyGameActionOnSnapshot } from './movement.js'
import { normalizeMapDefinition } from './map-editor.js'
import { gameSnapshotFromMap } from './save-file.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function duel() {
  const map = normalizeMapDefinition(
    JSON.parse(readFileSync(resolve(root, 'maps/bundled/duel.json'), 'utf8')),
  )
  const game = gameSnapshotFromMap(map)
  beginMatchForParticipants(game, map.id, ['player-1', 'player-2'])
  return { map, game }
}

describe('жадный бот в живой партии', () => {
  it('решает только за ботов и не трогает саму партию', () => {
    const { map, game } = duel()
    const human = game.activePlayerId!
    const bot = human === 'player-1' ? 'player-2' : 'player-1'
    const before = JSON.stringify(game)

    // Доктрину бот выбирает вне очереди, а за человека не ходит вовсе.
    const planned = planGreedyBotAction(game, map, new Set([bot]), new Map())
    expect(planned).toMatchObject({ playerId: bot, actionId: 'choose-doctrine' })
    expect(JSON.stringify(game)).toBe(before)

    expect(applyGameActionOnSnapshot(game, map, bot, planned!.actionId, planned!.params).errors).toEqual([])
    expect(planGreedyBotAction(game, map, new Set([bot]), new Map())).toBeNull()
  })

  it('в свой ход бот действует сам', () => {
    const { map, game } = duel()
    const active = game.activePlayerId!
    const bots = new Set([active])
    let steps = 0
    for (; steps < 40 && game.activePlayerId === active && game.phase === 'planning'; steps++) {
      const planned = planGreedyBotAction(game, map, bots, new Map())
      if (!planned) {
        // Ждём доктрину человека — выбираем за него вручную.
        const other = active === 'player-1' ? 'player-2' : 'player-1'
        expect(applyGameActionOnSnapshot(game, map, other, 'choose-doctrine', { doctrineId: 'none' }).errors).toEqual([])
        continue
      }
      expect(planned.playerId).toBe(active)
      expect(applyGameActionOnSnapshot(game, map, planned.playerId, planned.actionId, planned.params).errors).toEqual([])
    }
    expect(game.actionMarkers.filter((marker) => marker.ownerId === active).length).toBeGreaterThan(0)
    expect(game.activePlayerId).not.toBe(active)
  })
})
