import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CombatResolutionResult, PendingCombat, ShipType } from '@galaxy/rules'
import {
  combatContinueDecisionRole,
  combatContinueUiExpectation,
  combatDecisionStatusLine,
  combatResultRollsKey,
  combatRoundOutcome,
  isCombatDefender,
  shouldKeepCombatResultDismiss,
  shouldShowCombatContinueBanner,
  shouldShowForeignCombatBanner,
} from './combat-continue-ui.js'

function awaitingContinue(
  partial?: Partial<Extract<PendingCombat, { phase: 'awaiting-continue' }>>,
): PendingCombat {
  return {
    cellKey: '1,0',
    attackerId: 'p-att',
    defenderIds: ['p-def'],
    roundNumber: 1,
    continueDecisions: {},
    ...partial,
    phase: 'awaiting-continue',
  }
}

function resultWithRolls(extra?: Partial<CombatResolutionResult>): CombatResolutionResult {
  return {
    coord: { q: 1, r: 0 },
    winnerId: 'p-att',
    attackerWon: true,
    log: [],
    destroyedShipIds: extra?.destroyedShipIds ?? [],
    stub: false,
    needsDestructionSelection: extra?.needsDestructionSelection,
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
      ],
    },
    ...extra,
  }
}

describe('combatContinueDecisionRole', () => {
  it('attacker decides first', () => {
    const pending = awaitingContinue({ continueDecisions: {} })
    assert.equal(combatContinueDecisionRole(pending, 'p-att'), 'attacker')
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), null)
    assert.equal(combatContinueDecisionRole(pending, 'p-other'), null)
  })

  it('defender decides only after attacker continued', () => {
    const pending = awaitingContinue({ continueDecisions: { attacker: true } })
    assert.equal(combatContinueDecisionRole(pending, 'p-att'), null)
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), 'defender')
  })

  it('ignores whose turn it is on the map — non-active defender still decides', () => {
    const pending = awaitingContinue({ continueDecisions: { attacker: true } })
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), 'defender')
  })

  it('falls back to roundState.defenderId when defenderIds omit the player', () => {
    const pending = awaitingContinue({
      defenderIds: [],
      continueDecisions: { attacker: true },
      roundState: {
        rounds: [],
        shieldAbsorbed: 0,
        rawDamage: 1,
        remainingDamage: 0,
        winnerId: 'p-att',
        attackerWon: true,
        defenderId: 'p-def',
        combatOptions: {},
        incomingAttackerShipIds: [],
        attackerSkipTypes: [],
        defenderSkipTypes: [],
        trigger: 'movement',
      },
    })
    assert.equal(isCombatDefender(pending, 'p-def'), true)
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), 'defender')
  })

  it('returns null outside awaiting-continue', () => {
    assert.equal(
      combatContinueDecisionRole(
        {
          phase: 'awaiting-destruction',
          cellKey: '1,0',
          attackerId: 'p-att',
          defenderIds: ['p-def'],
          roundNumber: 1,
          roundState: {
            rounds: [],
            shieldAbsorbed: 0,
            rawDamage: 1,
            remainingDamage: 1,
            winnerId: 'p-att',
            attackerWon: true,
            defenderId: 'p-def',
            combatOptions: {},
            incomingAttackerShipIds: [],
            attackerSkipTypes: [],
            defenderSkipTypes: [],
            trigger: 'movement',
          },
        },
        'p-att',
      ),
      null,
    )
  })
})

describe('combat continue banners after closing results', () => {
  it('shows continue banner when modal is closed even if fingerprint looks pending', () => {
    assert.equal(
      shouldShowCombatContinueBanner({ decisionRole: 'attacker', battleModalOpen: false }),
      true,
    )
    assert.equal(
      shouldShowCombatContinueBanner({ decisionRole: 'defender', battleModalOpen: true }),
      false,
    )
  })

  it('shows foreign banner instead of a blank screen when results pending but modal closed', () => {
    assert.equal(
      shouldShowForeignCombatBanner({
        hasPendingCombat: true,
        battleModalOpen: false,
        showContinueBanner: false,
      }),
      true,
    )
    assert.equal(
      shouldShowForeignCombatBanner({
        hasPendingCombat: true,
        battleModalOpen: true,
        showContinueBanner: false,
      }),
      false,
    )
  })

  it('keeps dismiss when destruction changes fingerprint but rolls are the same', () => {
    const before = resultWithRolls({ needsDestructionSelection: true, destroyedShipIds: [] })
    const after = resultWithRolls({ needsDestructionSelection: false, destroyedShipIds: ['def-dd'] })
    const rollsKey = combatResultRollsKey(before)
    assert.equal(rollsKey, combatResultRollsKey(after))
    assert.equal(
      shouldKeepCombatResultDismiss({
        previousFingerprint: 'old-needs-selection',
        nextFingerprint: 'new-after-destruction',
        dismissedRollsKey: rollsKey,
        currentRollsKey: combatResultRollsKey(after),
      }),
      true,
    )
  })

  it('resets dismiss when a new round has different rolls', () => {
    const round1 = resultWithRolls()
    const round2 = resultWithRolls({
      rounds: [
        round1.roundOne!,
        {
          attackerTotal: 8,
          defenderTotal: 2,
          winner: 'attacker',
          shipRolls: [
            {
              shipId: 'att-dd',
              shipType: 'destroyer',
              ownerId: 'p-att',
              side: 'attacker',
              combatRolls: [4, 4],
              total: 8,
            },
          ],
        },
      ],
    })
    assert.notEqual(combatResultRollsKey(round1), combatResultRollsKey(round2))
    assert.equal(
      shouldKeepCombatResultDismiss({
        previousFingerprint: 'round-1',
        nextFingerprint: 'round-2',
        dismissedRollsKey: combatResultRollsKey(round1),
        currentRollsKey: combatResultRollsKey(round2),
      }),
      false,
    )
  })

  it('expects continue-decision as soon as modal is closed', () => {
    assert.equal(
      combatContinueUiExpectation({
        hasPendingCombat: true,
        decisionRole: 'attacker',
        isDestructionChooser: false,
        phase: 'awaiting-continue',
        isParticipant: true,
        battleModalOpen: false,
        viewingResults: true,
      }),
      'continue-decision',
    )
    assert.equal(
      combatContinueUiExpectation({
        hasPendingCombat: true,
        decisionRole: 'attacker',
        isDestructionChooser: false,
        phase: 'awaiting-continue',
        isParticipant: true,
        battleModalOpen: true,
        viewingResults: true,
      }),
      null,
    )
  })
})

describe('combatRoundOutcome', () => {
  it('shows win / loss from the viewer side', () => {
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-att',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: 'p-att',
        roundWinner: 'attacker',
      }),
      { kind: 'win', label: 'Победа' },
    )
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-def',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: 'p-att',
        roundWinner: 'attacker',
      }),
      { kind: 'loss', label: 'Поражение' },
    )
  })

  it('shows a global label for spectators and a draw', () => {
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-other',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: 'p-def',
        roundWinner: 'defender',
      }),
      { kind: 'defender-won', label: 'Победа защитника' },
    )
    assert.equal(
      combatRoundOutcome({
        localPlayerId: 'p-att',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: null,
        roundWinner: 'draw',
      }).kind,
      'draw',
    )
  })
})

describe('combatDecisionStatusLine', () => {
  it('uses combat role, not the map turn, for destruction and continue', () => {
    assert.equal(
      combatDecisionStatusLine({
        pending: {
          phase: 'awaiting-destruction',
          cellKey: '1,0',
          attackerId: 'p-att',
          defenderIds: ['p-def'],
          roundNumber: 1,
          roundState: {
            rounds: [],
            shieldAbsorbed: 0,
            rawDamage: 1,
            remainingDamage: 1,
            winnerId: 'p-att',
            attackerWon: true,
            defenderId: 'p-def',
            combatOptions: {},
            incomingAttackerShipIds: [],
            attackerSkipTypes: [],
            defenderSkipTypes: [],
            trigger: 'movement',
          },
        },
      }),
      'Атакующий выбирает потери',
    )
    assert.equal(
      combatDecisionStatusLine({
        pending: awaitingContinue({
          continueDecisions: { attacker: true },
          shipsDestroyedInCombat: true,
        }),
      }),
      'Защитник: продолжить или отступить',
    )
    assert.equal(
      combatDecisionStatusLine({
        pending: awaitingContinue({
          continueDecisions: {},
          shipsDestroyedInCombat: false,
        }),
      }),
      'Атакующий подтверждает продолжение',
    )
  })

  it('says waiting during countdown', () => {
    assert.equal(
      combatDecisionStatusLine({
        pending: {
          phase: 'prep',
          cellKey: '1,0',
          attackerId: 'p-att',
          defenderIds: ['p-def'],
          roundNumber: 1,
          prep: {
            phase: 'countdown',
            defenderId: 'p-def',
            readyBy: {},
            combatOptions: {},
            countdownStartedAt: 1,
          },
        },
      }),
      'Ждём подтверждения',
    )
  })
})
