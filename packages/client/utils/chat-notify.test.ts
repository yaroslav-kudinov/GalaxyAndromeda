import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideChatNotify, type ChatNotifyMessage } from './chat-notify'

function msg(id: string, from: string): ChatNotifyMessage {
  return { id, fromPlayerId: from }
}

test('первая загрузка истории не звучит', () => {
  const decision = decideChatNotify({
    fresh: [msg('a', 'p2'), msg('b', 'p3')],
    selfPlayerId: 'p1',
    primed: false,
  })
  assert.equal(decision.play, false)
  assert.equal(decision.incoming, 2)
})

test('чужое сообщение после загрузки звучит', () => {
  const decision = decideChatNotify({
    fresh: [msg('a', 'p2')],
    selfPlayerId: 'p1',
    primed: true,
  })
  assert.deepEqual(decision, { play: true, incoming: 1 })
})

test('собственное сообщение не звучит', () => {
  const decision = decideChatNotify({
    fresh: [msg('a', 'p1'), msg('b', 'p1')],
    selfPlayerId: 'p1',
    primed: true,
  })
  assert.deepEqual(decision, { play: false, incoming: 0 })
})

test('в смешанной порции чужие считаются отдельно', () => {
  const decision = decideChatNotify({
    fresh: [msg('a', 'p1'), msg('b', 'p2'), msg('c', 'p3')],
    selfPlayerId: 'p1',
    primed: true,
  })
  assert.deepEqual(decision, { play: true, incoming: 2 })
})

test('без игрока решения нет', () => {
  const decision = decideChatNotify({
    fresh: [msg('a', 'p2')],
    selfPlayerId: null,
    primed: true,
  })
  assert.deepEqual(decision, { play: false, incoming: 0 })
})

test('пустая порция не звучит', () => {
  const decision = decideChatNotify({ fresh: [], selfPlayerId: 'p1', primed: true })
  assert.deepEqual(decision, { play: false, incoming: 0 })
})
