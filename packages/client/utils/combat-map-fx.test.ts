import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CombatResolutionResult, PendingCombat, ShipType } from '@galaxy/rules'
import {
  combatDestroyedGhosts,
  combatIncomingApproachMoves,
  combatIncomingShipIds,
  combatPulseHexKey,
} from './combat-map-fx.js'

function awaitingContinue(): PendingCombat {
  return {
    phase: 'awaiting-continue',
    cellKey: '1,0',
    attackerId: 'p-att',
    defenderIds: ['p-def'],
    roundNumber: 1,
    continueDecisions: {},
    continuation: {
      movementFrom: { q: 0, r: 0 },
      movementPlans: [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
      incomingAttackerShipIds: ['att-dd'],
    },
    roundState: {
      rounds: [],
      shieldAbsorbed: 0,
      rawDamage: 1,
      remainingDamage: 0,
      winnerId: 'p-att',
      attackerWon: true,
      defenderId: 'p-def',
      combatOptions: {},
      incomingAttackerShipIds: ['att-dd'],
      attackerSkipTypes: [],
      defenderSkipTypes: [],
      trigger: 'movement',
    },
  }
}

function resultWithDestroyed(): CombatResolutionResult {
  return {
    coord: { q: 1, r: 0 },
    winnerId: 'p-att',
    attackerWon: true,
    log: [],
    destroyedShipIds: ['def-dd'],
    stub: false,
    roundOne: {
      attackerTotal: 5,
      defenderTotal: 3,
      winner: 'attacker',
      shipRolls: [
        {
          shipId: 'att-dd',
          shipType: 'destroyer' as ShipType,
          ownerId: 'p-att',
          side: 'attacker',
          combatRolls: [3, 2],
          total: 5,
        },
        {
          shipId: 'def-dd',
          shipType: 'destroyer' as ShipType,
          ownerId: 'p-def',
          side: 'defender',
          combatRolls: [3],
          total: 3,
        },
      ],
    },
  }
}

describe('combat map overlays', () => {
  it('pulses the pending combat hex', () => {
    assert.equal(combatPulseHexKey(awaitingContinue()), '1,0')
    assert.equal(combatPulseHexKey(null), null)
  })

  it('draws approach arrows only while incoming ships are still on origin', () => {
    const pending = awaitingContinue()
    const stillOnOrigin = combatIncomingApproachMoves({
      pending,
      cells: [
        { q: 0, r: 0, startingShips: [{ id: 'att-dd', type: 'destroyer', player: 1 }] },
        { q: 1, r: 0, startingShips: [] },
      ],
    })
    assert.equal(stillOnOrigin.length, 1)
    assert.equal(stillOnOrigin[0]?.shipId, 'att-dd')
    assert.deepEqual(stillOnOrigin[0]?.to, { q: 1, r: 0 })

    const alreadyArrived = combatIncomingApproachMoves({
      pending,
      cells: [
        { q: 0, r: 0, startingShips: [] },
        { q: 1, r: 0, startingShips: [{ id: 'att-dd', type: 'destroyer', player: 1 }] },
      ],
    })
    assert.equal(alreadyArrived.length, 0)
  })

  it('ghosts destroyed ships that the snapshot already removed', () => {
    const players = [
      { id: 'p-att', name: 'A', color: '#f00', isAi: false, eliminated: false },
      { id: 'p-def', name: 'D', color: '#00f', isAi: false, eliminated: false },
    ]
    const ghosts = combatDestroyedGhosts({
      result: resultWithDestroyed(),
      pending: awaitingContinue(),
      players,
      cells: [
        { q: 0, r: 0, startingShips: [{ id: 'att-dd', type: 'destroyer', player: 1 }] },
        { q: 1, r: 0, startingShips: [] },
      ],
    })
    assert.equal(ghosts.length, 1)
    assert.equal(ghosts[0]?.id, 'def-dd')
    assert.deepEqual({ q: ghosts[0]?.q, r: ghosts[0]?.r }, { q: 1, r: 0 })
  })

  it('does not invent a ghost while the ship is still on the board', () => {
    const ghosts = combatDestroyedGhosts({
      result: resultWithDestroyed(),
      pending: awaitingContinue(),
      players: [],
      cells: [
        { q: 1, r: 0, startingShips: [{ id: 'def-dd', type: 'destroyer', player: 2 }] },
      ],
    })
    assert.equal(ghosts.length, 0)
  })

  it('lists incoming ids from pending combat', () => {
    assert.deepEqual(combatIncomingShipIds(awaitingContinue()), ['att-dd'])
  })
})
