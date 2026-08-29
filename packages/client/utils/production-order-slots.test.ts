import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProductionOrderSlots,
  placementsToPreviewShips,
} from './production-order-slots.js'

describe('buildProductionOrderSlots', () => {
  it('marks placed, active and remaining ships', () => {
    const slots = buildProductionOrderSlots(
      [{ type: 'destroyer' }, { type: 'cruiser' }, { type: 'destroyer' }],
      [{ type: 'destroyer', coord: { q: 1, r: 0 } }],
    )
    assert.equal(slots.length, 3)
    assert.equal(slots[0]?.placed, true)
    assert.equal(slots[0]?.active, false)
    assert.deepEqual(slots[0]?.coord, { q: 1, r: 0 })
    assert.equal(slots[1]?.placed, false)
    assert.equal(slots[1]?.active, true)
    assert.equal(slots[2]?.placed, false)
    assert.equal(slots[2]?.active, false)
  })

  it('does not mark an active slot while confirming', () => {
    const slots = buildProductionOrderSlots(
      [{ type: 'cruiser' }],
      [{ type: 'cruiser', coord: { q: 0, r: 1 } }],
      { confirming: true },
    )
    assert.equal(slots[0]?.placed, true)
    assert.equal(slots[0]?.active, false)
  })
})

describe('placementsToPreviewShips', () => {
  it('copies coordinates and player slot', () => {
    const ships = placementsToPreviewShips(
      [{ type: 'battleship', coord: { q: 2, r: -1 } }],
      3,
    )
    assert.deepEqual(ships, [
      { q: 2, r: -1, type: 'battleship', player: 3 },
    ])
  })
})
