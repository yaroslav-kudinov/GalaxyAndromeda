import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CombatResolutionResult, CombatRoundResult, PendingCombat, ShipType } from '@galaxy/rules'
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

function round(values: number[]): CombatRoundResult {
  return {
    attackerHits: values.filter((v) => v >= 6).length,
    defenderHits: 0,
    damageByShipId: {},
    destroyedShipIds: [],
    shipRolls: [
      {
        shipId: 'att-dd',
        shipType: 'destroyer' as ShipType,
        ownerId: 'p-att',
        side: 'attacker',
        distance: 0,
        dice: values.map((value) => ({ value, threshold: 6, targetShipId: 'def-dd', hit: value >= 6 })),
        hits: values.filter((v) => v >= 6).length,
      },
    ],
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
    roundOne: round([3, 2]),
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
    assert.equal(
      combatContinueDecisionRole(pending, 'p-def', { eliminated: true }),
      null,
    )
  })

  it('ignores whose turn it is on the map — non-active defender still decides', () => {
    const pending = awaitingContinue({ continueDecisions: { attacker: true } })
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), 'defender')
  })

  it('prep defender counts as defender before defenderIds are known', () => {
    const pending: PendingCombat = {
      phase: 'prep',
      cellKey: '1,0',
      attackerId: 'p-att',
      defenderIds: [],
      roundNumber: 1,
      prep: { phase: 'prep', defenderId: 'p-def', readyBy: {}, combatOptions: {} },
    }
    assert.equal(isCombatDefender(pending, 'p-def'), true)
    assert.equal(combatContinueDecisionRole(pending, 'p-def'), null)
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

  it('keeps dismiss when fingerprint changes but rolls are the same', () => {
    const before = resultWithRolls({ destroyedShipIds: [] })
    const after = resultWithRolls({ destroyedShipIds: ['def-dd'] })
    const rollsKey = combatResultRollsKey(before)
    assert.equal(rollsKey, combatResultRollsKey(after))
    assert.equal(
      shouldKeepCombatResultDismiss({
        previousFingerprint: 'old',
        nextFingerprint: 'new',
        dismissedRollsKey: rollsKey,
        currentRollsKey: combatResultRollsKey(after),
      }),
      true,
    )
  })

  it('resets dismiss when a new round has different rolls', () => {
    const round1 = resultWithRolls()
    const round2 = resultWithRolls({
      rounds: [round1.roundOne!, round([6, 4])],
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
      }),
      { kind: 'win', label: 'Победа' },
    )
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-def',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: 'p-att',
      }),
      { kind: 'loss', label: 'Поражение' },
    )
  })

  it('shows a global label for spectators and rounds without outcome', () => {
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-other',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: 'p-def',
      }),
      { kind: 'defender-won', label: 'Победа защитника' },
    )
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-att',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: null,
      }),
      { kind: 'draw', label: 'Раунд без исхода' },
    )
    assert.deepEqual(
      combatRoundOutcome({
        localPlayerId: 'p-att',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: null,
        battleOver: true,
      }).label,
      'Взаимное уничтожение',
    )
    assert.equal(
      combatRoundOutcome({
        localPlayerId: 'p-att',
        attackerId: 'p-att',
        defenderId: 'p-def',
        winnerId: null,
        stalemate: true,
      }).label,
      'Бой не состоялся',
    )
  })
})

describe('combatDecisionStatusLine', () => {
  it('uses combat role, not the map turn, for continue', () => {
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
