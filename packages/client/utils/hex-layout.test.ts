import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { autoFitFromStorageValue } from './hex-layout.js'

describe('autoFitFromStorageValue', () => {
  it('treats a missing key as off so the editor does not zoom out on every edit', () => {
    assert.equal(autoFitFromStorageValue(null), false)
  })

  it('turns follow-the-map on only when the stored flag is 1', () => {
    assert.equal(autoFitFromStorageValue('1'), true)
    assert.equal(autoFitFromStorageValue('0'), false)
    assert.equal(autoFitFromStorageValue(''), false)
  })
})
