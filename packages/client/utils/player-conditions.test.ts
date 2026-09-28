import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyMap, gameSnapshotFromMap } from '@galaxy/rules'
import { playerConditions } from './player-conditions'

function board() {
  const map = createEmptyMap('conditions', 'Условия')
  map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
  const game = gameSnapshotFromMap(map)
  game.turnNumber = 2
  game.doctrineWindow = 3
  const home = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
  home.isPowerCenter = true
  home.controlOwnerId = 'player-1'
  home.ships = [
    { id: 'g1', type: 'cruiser', ownerId: 'player-1' },
    { id: 'g2', type: 'cruiser', ownerId: 'player-1' },
    { id: 'b1', type: 'cruiser', ownerId: 'player-2' },
  ]
  game.sieges = { '0,0': { besiegerId: 'player-2', besiegedId: 'player-1', sinceTurn: 1 } }
  return game
}

test('«Атака» при осаде своего центра: предупреждение, что бонус не действует', () => {
  const game = board()
  game.doctrineByPlayer = {
    'player-1': { doctrineId: 'attack', fromTurn: 1 },
    'player-2': { doctrineId: 'defense', fromTurn: 1 },
  }
  const texts = playerConditions(game, 'player-1').map((c) => c.text)
  assert.ok(texts.some((t) => t.startsWith('«Атака» сейчас не действует: осаждён ваш центр власти (0,0)')))
  assert.ok(texts.some((t) => t.includes('«Оборона»: на его клетках вашим кораблям нужно на 1 больше')))
  assert.ok(texts.some((t) => t.startsWith('Ваш центр (0,0) осаждает игрок')))
})

test('осаждающий видит, что гарнизон при штурме перебрасывает промахи', () => {
  const game = board()
  const texts = playerConditions(game, 'player-2').map((c) => c.text)
  assert.ok(texts.some((t) => t.startsWith('Вы осаждаете центр (0,0)') && t.includes('(дважды)')))
})
