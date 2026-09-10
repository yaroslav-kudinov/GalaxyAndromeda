import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHAT_MAX_TEXT_LENGTH,
  CHAT_RATE_LIMIT,
  clearRoomChat,
  listRoomChatVisible,
  postRoomChat,
  sanitizeChatText,
} from './room-chat.js'

describe('sanitizeChatText', () => {
  it('trims and strips controls', () => {
    assert.equal(sanitizeChatText('  hello\nworld\t '), 'hello world')
    assert.equal(sanitizeChatText(''), null)
    assert.equal(sanitizeChatText('   '), null)
  })

  it('clamps length', () => {
    const long = 'x'.repeat(CHAT_MAX_TEXT_LENGTH + 50)
    assert.equal(sanitizeChatText(long)?.length, CHAT_MAX_TEXT_LENGTH)
  })
})

describe('room chat', () => {
  const roomId = 'room-chat-test'

  it('posts public and dm; filters by viewer', () => {
    clearRoomChat(roomId)
    const members = ['player-1', 'player-2', 'player-3']
    const pub = postRoomChat({
      roomId,
      fromPlayerId: 'player-1',
      fromName: 'Алый',
      text: 'всем',
      memberIds: members,
      now: 1000,
    })
    assert.equal(pub.ok, true)
    const dm = postRoomChat({
      roomId,
      fromPlayerId: 'player-1',
      fromName: 'Алый',
      text: 'секретик',
      toPlayerId: 'player-2',
      memberIds: members,
      now: 1001,
    })
    assert.equal(dm.ok, true)

    const for3 = listRoomChatVisible({ roomId, viewerPlayerId: 'player-3' })
    assert.equal(for3.length, 1)
    assert.equal(for3[0]?.text, 'всем')

    const for2 = listRoomChatVisible({ roomId, viewerPlayerId: 'player-2' })
    assert.equal(for2.length, 2)
    assert.ok(for2.some((m) => m.text === 'секретик'))
  })

  it('rate-limits', () => {
    clearRoomChat(roomId)
    const members = ['player-1']
    let lastOk = true
    for (let i = 0; i < CHAT_RATE_LIMIT + 2; i++) {
      const r = postRoomChat({
        roomId,
        fromPlayerId: 'player-1',
        fromName: 'A',
        text: `m${i}`,
        memberIds: members,
        now: 5000 + i,
      })
      lastOk = r.ok
      if (i < CHAT_RATE_LIMIT) assert.equal(r.ok, true)
    }
    assert.equal(lastOk, false)
  })
})
