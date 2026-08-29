import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { syncAudioToDocumentVisibility, visibilityAudioIntent } from './page-visibility-audio.js'

describe('visibilityAudioIntent', () => {
  it('pauses whenever the tab is hidden', () => {
    assert.equal(
      visibilityAudioIntent({ hidden: true, muted: false, shouldBePlaying: true }),
      'pause',
    )
    assert.equal(
      visibilityAudioIntent({ hidden: true, muted: true, shouldBePlaying: true }),
      'pause',
    )
    assert.equal(
      visibilityAudioIntent({ hidden: true, muted: false, shouldBePlaying: false }),
      'pause',
    )
  })

  it('resumes only when visible, not muted, and the session wants audio', () => {
    assert.equal(
      visibilityAudioIntent({ hidden: false, muted: false, shouldBePlaying: true }),
      'resume',
    )
  })

  it('does not resume when the user muted or the session is idle', () => {
    assert.equal(
      visibilityAudioIntent({ hidden: false, muted: true, shouldBePlaying: true }),
      'idle',
    )
    assert.equal(
      visibilityAudioIntent({ hidden: false, muted: false, shouldBePlaying: false }),
      'idle',
    )
  })
})

describe('syncAudioToDocumentVisibility', () => {
  it('pauses the element when hidden and does not call play', () => {
    const calls: string[] = []
    const audio = {
      pause() {
        calls.push('pause')
      },
    } as HTMLAudioElement
    syncAudioToDocumentVisibility({
      hidden: true,
      getAudio: () => audio,
      isMuted: () => false,
      shouldBePlaying: () => true,
      play: () => {
        calls.push('play')
      },
    })
    assert.deepEqual(calls, ['pause'])
  })

  it('plays when visible if not muted and the session wants audio', () => {
    const calls: string[] = []
    syncAudioToDocumentVisibility({
      hidden: false,
      getAudio: () => null,
      isMuted: () => false,
      shouldBePlaying: () => true,
      play: () => {
        calls.push('play')
      },
    })
    assert.deepEqual(calls, ['play'])
  })

  it('does not play when visible if muted', () => {
    const calls: string[] = []
    syncAudioToDocumentVisibility({
      hidden: false,
      getAudio: () => null,
      isMuted: () => true,
      shouldBePlaying: () => true,
      play: () => {
        calls.push('play')
      },
    })
    assert.deepEqual(calls, [])
  })
})
