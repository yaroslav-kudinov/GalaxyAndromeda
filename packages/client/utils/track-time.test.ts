import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampTrackTime, formatTrackTime } from './track-time.js'

describe('formatTrackTime', () => {
  it('formats minutes and seconds', () => {
    assert.equal(formatTrackTime(0), '0:00')
    assert.equal(formatTrackTime(9), '0:09')
    assert.equal(formatTrackTime(75), '1:15')
    assert.equal(formatTrackTime(3599), '59:59')
  })

  it('formats hours when needed', () => {
    assert.equal(formatTrackTime(3600), '1:00:00')
    assert.equal(formatTrackTime(3661), '1:01:01')
  })

  it('treats invalid values as zero', () => {
    assert.equal(formatTrackTime(Number.NaN), '0:00')
    assert.equal(formatTrackTime(-4), '0:00')
    assert.equal(formatTrackTime(Number.POSITIVE_INFINITY), '0:00')
  })
})

describe('clampTrackTime', () => {
  it('clamps to the track duration', () => {
    assert.equal(clampTrackTime(12, 100), 12)
    assert.equal(clampTrackTime(-1, 100), 0)
    assert.equal(clampTrackTime(140, 100), 100)
  })

  it('returns zero without a finite duration', () => {
    assert.equal(clampTrackTime(12, 0), 0)
    assert.equal(clampTrackTime(12, Number.NaN), 0)
  })
})
