import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectHexMoves,
  easeOutCubic,
  indexShipsById,
  shipLocationSignature,
} from './ship-move-index.js'

describe('indexShipsById', () => {
  it('skips ships without id', () => {
    const index = indexShipsById([
      {
        q: 0,
        r: 0,
        startingShips: [
          { type: 'destroyer', player: 1 },
          { id: 's1', type: 'cruiser', player: 1 },
        ],
      },
    ])
    assert.equal(index.size, 1)
    assert.equal(index.get('s1')?.q, 0)
  })
})

describe('detectHexMoves', () => {
  it('returns ids that changed hex', () => {
    const prev = indexShipsById([
      { q: 0, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
      { q: 1, r: 0, startingShips: [] },
    ])
    const next = indexShipsById([
      { q: 0, r: 0, startingShips: [] },
      { q: 1, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
    ])
    assert.deepEqual(detectHexMoves(prev, next), ['a'])
  })

  it('ignores ships that stayed for combat', () => {
    const prev = indexShipsById([
      { q: 0, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
    ])
    const next = indexShipsById([
      { q: 0, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
    ])
    assert.deepEqual(detectHexMoves(prev, next), [])
  })

  it('ignores spawned and destroyed ships', () => {
    const prev = indexShipsById([
      { q: 0, r: 0, startingShips: [{ id: 'gone', type: 'destroyer', player: 1 }] },
    ])
    const next = indexShipsById([
      { q: 1, r: 0, startingShips: [{ id: 'new', type: 'cruiser', player: 1 }] },
    ])
    assert.deepEqual(detectHexMoves(prev, next), [])
  })
})

describe('shipLocationSignature', () => {
  it('changes when a ship hops cells', () => {
    const before = shipLocationSignature([
      { q: 0, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
      { q: 1, r: 0, startingShips: [] },
    ])
    const after = shipLocationSignature([
      { q: 0, r: 0, startingShips: [] },
      { q: 1, r: 0, startingShips: [{ id: 'a', type: 'destroyer', player: 1 }] },
    ])
    assert.notEqual(before, after)
  })
})

describe('easeOutCubic', () => {
  it('clamps and ends at 1', () => {
    assert.equal(easeOutCubic(0), 0)
    assert.equal(easeOutCubic(1), 1)
    assert.equal(easeOutCubic(2), 1)
    assert.ok(easeOutCubic(0.5) > 0.5)
  })
})
