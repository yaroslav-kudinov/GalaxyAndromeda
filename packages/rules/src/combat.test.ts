import { describe, expect, it } from 'vitest'
import {
  GALAXY_SAVE_FORMAT,
  GALAXY_SAVE_VERSION,
  gameSnapshotFromMap,
  migrateLegacyPendingCombat,
  normalizeGalaxySave,
  validateGalaxySave,
  type GameSnapshot,
} from './save-file.js'
import { createEmptyMap } from './map.js'
import type { ShipType } from './types.js'
import {
  applyShieldAbsorption,
  applyCombatResultToSnapshot,
  applyPrioritySkipToggle,
  primaryDestructionType,
  selectableDestructionTypes,
  buildCombatPreview,
  buildCombatPreviewFromPending,
  buildDestructionSelectionState,
  canTogglePrioritySkipType,
  combatResolutionFingerprint,
  formatShieldContributionLabel,
  COMBAT_STUB,
  computeRoundDamage,
  detectCombats,
  detectCombatsFromMoves,
  estimateRoundOneOutcome,
  formatCombatRoundDiceTotals,
  getImmediatelyDestroyableShipIds,
  getCombatRetreatDestinations,
  isCombatDestination,
  isValidPrioritySkipSet,
  ONE_BATTLE_PER_MARKER_MSG,
  presentDestructionPriorityChain,
  resolveCombatAtCell,
  rollCombatRound,
  selectShipsToDestroy,
  sortShipsForDestruction,
  sumCombatSideDiceTotal,
  totalShieldAbsorbExample,
  validateCombatOptions,
  validateDestructionSelection,
  validateSingleCombatDestination,
  SHIELD_ABSORB_NEIGHBOR,
  SHIELD_ABSORB_SELF,
  updateCombatPrep,
  abortPendingCombat,
  combatPrepOf,
  combatRoundStateOf,
  confirmCombatDestruction,
  continuePendingCombat,
  isAwaitingContinue,
  pendingCombatInvariantViolations,
  releaseInvalidPendingCombat,
  setupCombatPrepForMovement,
  setupPendingCombat,
  setupPendingCombatDestruction,
  stopPendingCombat,
} from './combat.js'
import { executeDestroyerSacrifice } from './destroyer-sacrifice.js'
import { applyGameActionOnSnapshot, executeMarkerMovement, resolveCombatPrep } from './movement.js'
import { advanceGameSnapshot } from './turn.js'
import {
  buildBombardmentPreview,
  canShipBombard,
  continueBombardmentQueueOrFinalize,
  executeMarkerBombardment,
  getBombardmentTargetKeys,
  validateMarkerBombardment,
} from './bombardment.js'
import { addActionMarker } from './markers.js'

function addShip(
  game: GameSnapshot,
  q: number,
  r: number,
  ownerId: string,
  type: ShipType = 'destroyer',
  id?: string,
) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error(`cell ${q},${r} missing`)
  cell.ships.push({
    id: id ?? `ship-${ownerId}-${q}-${r}-${type}`,
    type,
    ownerId,
  })
}

function ensureActionMarkerCapacity(game: GameSnapshot, ownerId: string, needed: number) {
  let have = game.cells.filter((c) => c.isPowerCenter && c.controlOwnerId === ownerId).length
  for (const cell of game.cells) {
    if (have >= needed) return
    if (cell.controlOwnerId === ownerId && !cell.isPowerCenter) {
      cell.isPowerCenter = true
      have += 1
    }
  }
  for (const cell of game.cells) {
    if (have >= needed) return
    if (
      !cell.isPowerCenter
      && cell.ships.some((ship) => ship.ownerId === ownerId)
      && (cell.controlOwnerId == null || cell.controlOwnerId === ownerId)
    ) {
      cell.isPowerCenter = true
      cell.controlOwnerId = ownerId
      have += 1
    }
  }
}

function placeActionMarker(game: GameSnapshot, ownerId: string, coord: { q: number; r: number }) {
  const already = game.actionMarkers.filter((m) => m.ownerId === ownerId).length
  ensureActionMarkerCapacity(game, ownerId, already + 1)
  const prevPhase = game.phase
  const prevActive = game.activePlayerId
  game.phase = 'planning'
  game.activePlayerId = ownerId
  expect(addActionMarker(game, ownerId, coord)).toEqual([])
  game.phase = prevPhase
  game.activePlayerId = prevActive
}

/** Эсминец d4: floor(0.5×4)+1 = 3 (детерминизм тестов). */
function withAllDiceThree<T>(fn: () => T): T {
  const original = Math.random
  Math.random = () => 0.5
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

describe('combat sketch', () => {
  it('shield absorb follows rulebook 6+3 example', () => {
    expect(SHIELD_ABSORB_SELF).toBe(6)
    expect(SHIELD_ABSORB_NEIGHBOR).toBe(3)
    expect(totalShieldAbsorbExample()).toBe(9)
  })

  it('formatShieldContributionLabel describes self and neighbor shields', () => {
    expect(
      formatShieldContributionLabel({
        shipId: 'sh-1',
        ownerId: 'p2',
        absorbCapacity: 6,
        scope: 'self',
        fromCoord: { q: 1, r: 0 },
      }),
    ).toBe('щит · до 6 на клетке')
    expect(
      formatShieldContributionLabel({
        shipId: 'sh-2',
        ownerId: 'p2',
        absorbCapacity: 3,
        scope: 'neighbor',
        fromCoord: { q: 2, r: 0 },
      }),
    ).toBe('щит · до 3 с соседа')
  })

  it('carrier aura: сосед +1d4 на каждый не-авианосец; на клетке +1d6; не стакается', () => {
    const map = createEmptyMap('carrier-aura', 'Carrier')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addShip(game, 1, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-1', 'destroyer', 'att-dd2')
    addShip(game, 2, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [
        { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
        { id: 'att-dd2', type: 'destroyer', ownerId: 'player-1' },
      ],
    )
    expect(preview?.attacker.carrierAura).toMatchObject({ faces: 4, scope: 'neighbor' })

    addShip(game, 1, 0, 'player-1', 'carrier', 'att-cv-self')
    const previewSelf = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [
        { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
        { id: 'att-dd2', type: 'destroyer', ownerId: 'player-1' },
      ],
    )
    expect(previewSelf?.attacker.carrierAura).toMatchObject({ faces: 6, scope: 'self' })

    const round = rollCombatRound(previewSelf!, () => 0.99)
    const attRolls = round.shipRolls.filter((r) => r.side === 'attacker' && r.combatRolls.length)
    expect(attRolls).toHaveLength(2)
    for (const roll of attRolls) {
      expect(roll.supportRolls?.[0]?.rolls).toHaveLength(1)
      expect(roll.total).toBe(
        roll.combatRolls.reduce((a, b) => a + b, 0) + (roll.supportRolls?.[0]?.rolls[0] ?? 0),
      )
    }
  })

  it('combatResolutionFingerprint is stable for identical results', () => {
    const base = {
      coord: { q: 1, r: 0 },
      winnerId: 'player-1',
      attackerWon: true,
      log: [],
      destroyedShipIds: [],
      stub: false,
      roundOne: {
        attackerTotal: 5,
        defenderTotal: 3,
        winner: 'attacker' as const,
        shipRolls: [
          {
            shipId: 'att-dd',
            shipType: 'destroyer' as ShipType,
            ownerId: 'player-1',
            side: 'attacker' as const,
            combatRolls: [3, 2],
            total: 5,
          },
        ],
      },
    }
    const a = combatResolutionFingerprint(base)
    const b = combatResolutionFingerprint({ ...base, log: [{ step: 'dice-roll' as const, message: 'x' }] })
    expect(a).toBe(b)
    expect(combatResolutionFingerprint(null)).toBeNull()
  })

  it('detectCombatsFromMoves finds contested destination', () => {
    const map = createEmptyMap('combat-test', 'Combat')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.activePlayerId = 'player-1'

    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    expect(isCombatDestination(game, 'player-1', { q: 1, r: 0 })).toBe(true)

    const pending = detectCombatsFromMoves(
      game,
      [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
      'player-1',
    )
    expect(pending).toHaveLength(1)
    expect(pending[0].defenderId).toBe('player-2')
    expect(pending[0].trigger).toBe('movement')

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
    )
    expect(preview?.attacker.ships).toHaveLength(1)
    expect(preview?.defender.ships).toHaveLength(1)
  })

  it('detectCombats finds stacked multi-owner cells', () => {
    const map = createEmptyMap('stack-test', 'Stack')
    const game = gameSnapshotFromMap(map)

    addShip(game, 0, 0, 'player-1', 'destroyer')
    addShip(game, 0, 0, 'player-2', 'destroyer')

    const combats = detectCombats(game)
    expect(combats).toHaveLength(1)
    expect(combats[0].trigger).toBe('stack')
  })

  it('buildCombatPreview includes nearby support ships within fireRange', () => {
    const map = createEmptyMap('support-test', 'Support')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)

    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-2', 'cruiser', 'sup-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
    )
    expect(preview).not.toBeNull()
    expect(preview!.defender.combatDiceTotal).toBe(1)
    expect(preview!.defender.supportDiceTotal).toBe(1)
    expect(preview!.defender.supportingShips).toHaveLength(1)
    expect(preview!.defender.supportingShips[0].shipId).toBe('sup-cr')
    expect(preview!.attacker.supportDiceTotal).toBe(0)
  })

  it('counts attacker support from peaceful move destination in the same marker', () => {
    // Как в бою (-1,1): крейсер уходит на соседнюю (0,0), остальные — в бой с (-1,-1).
    // Физически крейсер ещё на исходной (дистанция 2), но поддержка считается с (0,0).
    const map = createEmptyMap('support-peaceful', 'Support peaceful')
    for (const c of [
      { q: -1, r: 1 },
      { q: -1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
    ]) {
      map.cells.push(c)
    }
    const game = gameSnapshotFromMap(map)
    addShip(game, -1, -1, 'player-1', 'destroyer', 'att-dd')
    addShip(game, -1, -1, 'player-1', 'cruiser', 'att-cr-fight')
    addShip(game, -1, -1, 'player-1', 'cruiser', 'att-cr-support')
    addShip(game, -1, 1, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === -1 && c.coord.r === 1)!.controlOwnerId = 'player-2'

    const withoutPlans = buildCombatPreview(
      game,
      { q: -1, r: 1 },
      'player-1',
      [
        { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
        { id: 'att-cr-fight', type: 'cruiser', ownerId: 'player-1' },
      ],
    )
    expect(withoutPlans?.attacker.supportDiceTotal).toBe(0)

    const withPlans = buildCombatPreview(
      game,
      { q: -1, r: 1 },
      'player-1',
      [
        { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
        { id: 'att-cr-fight', type: 'cruiser', ownerId: 'player-1' },
      ],
      {
        attackerMovementPlans: [
          { shipId: 'att-dd', to: { q: -1, r: 1 } },
          { shipId: 'att-cr-fight', to: { q: -1, r: 1 } },
          { shipId: 'att-cr-support', to: { q: 0, r: 0 } },
        ],
      },
    )
    expect(withPlans?.attacker.supportDiceTotal).toBe(1)
    expect(withPlans?.attacker.supportingShips[0]?.shipId).toBe('att-cr-support')
    expect(withPlans?.attacker.supportingShips[0]?.fromCoord).toEqual({ q: 0, r: 0 })
  })

  it('leaves cruiser support at distance 2 without movement plan', () => {
    const map = createEmptyMap('support-far', 'Support far')
    map.cells.push({ q: -1, r: 1 }, { q: -1, r: -1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, -1, -1, 'player-1', 'destroyer', 'att-dd')
    addShip(game, -1, -1, 'player-1', 'cruiser', 'att-cr')
    addShip(game, -1, 1, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === -1 && c.coord.r === 1)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: -1, r: 1 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
    )
    expect(preview?.attacker.supportDiceTotal).toBe(0)
  })

  it('allows a third player to assign eligible support to either side', () => {
    const map = createEmptyMap('third-party-support', 'Third party support')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.players.push({
      id: 'player-3',
      name: 'Игрок 3',
      color: '#22c55e',
      isAi: false,
      eliminated: false,
    })
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      { supportSides: { 'player-3': 'attacker' } },
    )
    expect(preview?.supportCandidates?.[0]?.playerId).toBe('player-3')
    expect(preview?.attacker.supportingShips.map((ship) => ship.shipId)).toContain('third-cr')
    expect(preview?.defender.supportingShips.map((ship) => ship.shipId)).not.toContain('third-cr')
  })

  it('rollCombatRound produces per-ship rolls and sums sides', () => {
    const preview = {
      coord: { q: 1, r: 0 },
      coordKey: '1,0',
      trigger: 'movement' as const,
      attackerId: 'player-1',
      defenderId: 'player-2',
      attacker: {
        playerId: 'player-1',
        role: 'attacker' as const,
        ships: [{ shipId: 'att-bb', type: 'battleship' as ShipType, ownerId: 'player-1', side: 'attacker' as const }],
        combatDiceTotal: 3,
        supportDiceTotal: 0,
        supportingShips: [],
      },
      defender: {
        playerId: 'player-2',
        role: 'defender' as const,
        ships: [{ shipId: 'def-dd', type: 'destroyer' as ShipType, ownerId: 'player-2', side: 'defender' as const }],
        combatDiceTotal: 1,
        supportDiceTotal: 1,
        supportingShips: [{
          shipId: 'sup-cr',
          type: 'cruiser' as ShipType,
          ownerId: 'player-2',
          fromCoord: { q: 2, r: 0 },
          supportDice: 1,
          distance: 1,
        }],
      },
      shieldContributions: [],
      shieldAbsorbTotal: 0,
      destructionOrder: ['destroyer'] as ShipType[],
      notes: [],
    }

    let seq = 0
    const rng = () => {
      const values = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]
      return values[seq++ % values.length]
    }

    const round = rollCombatRound(preview, rng)
    expect(round.shipRolls).toHaveLength(3)
    expect(round.shipRolls.find((r) => r.shipId === 'att-bb')?.combatRolls).toHaveLength(3)
    expect(round.shipRolls.find((r) => r.shipId === 'def-dd')?.combatRolls).toHaveLength(1)
    expect(round.shipRolls.find((r) => r.shipId === 'sup-cr')?.supportRolls?.[0].rolls).toHaveLength(1)
    expect(round.attackerTotal).toBe(
      round.shipRolls.filter((r) => r.side === 'attacker').reduce((s, r) => s + r.total, 0),
    )
    expect(round.defenderTotal).toBe(
      round.shipRolls.filter((r) => r.side === 'defender').reduce((s, r) => s + r.total, 0),
    )
    expect(round.attackerTotal).toBe(sumCombatSideDiceTotal(round.shipRolls, 'attacker'))
    expect(formatCombatRoundDiceTotals(round)).toBe(
      `Раунд 1 — сумма кубиков: атакующий ${round.attackerTotal}, защитник ${round.defenderTotal}; ничья — очки уничтожения 0`,
    )
  })

  it('крейсер на клетке боя бросает 2d6', () => {
    const preview = {
      coord: { q: 1, r: 0 },
      coordKey: '1,0',
      trigger: 'movement' as const,
      attackerId: 'player-1',
      defenderId: 'player-2',
      attacker: {
        playerId: 'player-1',
        role: 'attacker' as const,
        ships: [{ shipId: 'att-cr', type: 'cruiser' as ShipType, ownerId: 'player-1', side: 'attacker' as const }],
        combatDiceTotal: 2,
        supportDiceTotal: 0,
        supportingShips: [],
      },
      defender: {
        playerId: 'player-2',
        role: 'defender' as const,
        ships: [{ shipId: 'def-dd', type: 'destroyer' as ShipType, ownerId: 'player-2', side: 'defender' as const }],
        combatDiceTotal: 1,
        supportDiceTotal: 0,
        supportingShips: [],
      },
      shieldContributions: [],
      shieldAbsorbTotal: 0,
      destructionOrder: ['destroyer', 'cruiser'] as ShipType[],
      notes: [],
    }
    const round = rollCombatRound(preview, () => 0.99)
    const cr = round.shipRolls.find((r) => r.shipId === 'att-cr')
    expect(cr?.combatRolls).toEqual([6, 6])
    expect(cr?.total).toBe(12)
    expect(round.attackerTotal).toBe(12)
    expect(round.defenderTotal).toBe(4)
  })

  it('resolveCombatAtCell includes incoming attacker ships in dice totals', () => {
    const map = createEmptyMap('resolve-combat', 'Resolve')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const withoutIncoming = resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', [], {})
    expect(withoutIncoming.roundOne!.attackerTotal).toBe(0)
    expect(withoutIncoming.stub).toBe(false)

    let seq = 0
    const rng = () => [0.5, 0.01][seq++ % 2]!

    const withIncoming = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      {},
      rng,
    )
    expect(withIncoming.roundOne!.attackerTotal).toBe(3)
    expect(withIncoming.roundOne!.defenderTotal).toBe(1)
    expect(withIncoming.log.find((e) => e.step === 'dice-roll')!.message).toBe(
      formatCombatRoundDiceTotals(withIncoming.roundOne!),
    )
  })

  it('estimateRoundOneOutcome favors stronger dice side', () => {
    const map = createEmptyMap('odds-test', 'Odds')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-bb', type: 'battleship', ownerId: 'player-1' }],
    )
    expect(preview).not.toBeNull()

    let roll = 0
    const rng = () => {
      roll = (roll + 1) % 6
      return roll / 6
    }

    const odds = estimateRoundOneOutcome(preview!, { samples: 600, rng })
    expect(odds.win + odds.draw + odds.defeat).toBeCloseTo(1, 5)
    expect(odds.win).toBeGreaterThan(odds.defeat)
  })

  it('validateSingleCombatDestination rejects two combat cells in one order', () => {
    const map = createEmptyMap('two-combat', 'Two combat')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'destroyer', 'dd-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 0, 1, 'player-2', 'destroyer', 'def-b')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.controlOwnerId = 'player-2'

    expect(
      validateSingleCombatDestination(
        game,
        [
          { shipId: 'dd-1', to: { q: 1, r: 0 } },
          { shipId: 'dd-2', to: { q: 0, r: 1 } },
        ],
        'player-1',
      ),
    ).toEqual([ONE_BATTLE_PER_MARKER_MSG])
  })

  it('COMBAT_STUB is false after full implementation', () => {
    expect(COMBAT_STUB).toBe(false)
  })

  it('computeRoundDamage uses dice margin, not gross winner total', () => {
    expect(
      computeRoundDamage({ attackerTotal: 15, defenderTotal: 7, winner: 'attacker' }),
    ).toBe(8)
    expect(
      computeRoundDamage({ attackerTotal: 15, defenderTotal: 7, winner: 'defender' }),
    ).toBe(8)
    expect(
      computeRoundDamage({ attackerTotal: 15, defenderTotal: 15, winner: 'draw' }),
    ).toBe(0)
  })

  it('margin damage 15 vs 7 with shield 6 leaves 2 points (ниже destroyCost эсминца)', () => {
    const round = { attackerTotal: 15, defenderTotal: 7, winner: 'attacker' as const, shipRolls: [] }
    expect(computeRoundDamage(round)).toBe(8)

    const shieldResult = applyShieldAbsorption(8, [
      {
        shipId: 'sh-self',
        ownerId: 'p2',
        absorbCapacity: SHIELD_ABSORB_SELF,
        scope: 'self' as const,
        fromCoord: { q: 1, r: 0 },
      },
    ])
    expect(shieldResult).toEqual({ absorbed: 6, remainingDamage: 2 })

    const defenderShips = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-3', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'sh-1', type: 'shield' as ShipType, ownerId: 'p2' },
    ]
    // 2 < destroyCost эсминца (3) — уничтожения нет
    expect(selectShipsToDestroy(defenderShips, shieldResult.remainingDamage, new Set())).toEqual([])

    const grossWinnerTotal = round.attackerTotal
    const grossAfterShields = applyShieldAbsorption(grossWinnerTotal, [
      {
        shipId: 'sh-self',
        ownerId: 'p2',
        absorbCapacity: SHIELD_ABSORB_SELF,
        scope: 'self' as const,
        fromCoord: { q: 1, r: 0 },
      },
    ])
    // 15−6=9 → три эсминца (3+3+3)
    expect(selectShipsToDestroy(defenderShips, grossAfterShields.remainingDamage, new Set())).toEqual([
      'dd-1',
      'dd-2',
      'dd-3',
    ])
  })

  it('resolveCombatAtCell applies margin damage from dice totals', () => {
    const map = createEmptyMap('gross-damage', 'Gross')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.turnNumber = 2

    for (let i = 0; i < 5; i++) {
      addShip(game, 0, 0, 'player-1', 'destroyer', `att-dd-${i}`)
    }
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-3')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const incoming = game.cells
      .find((c) => c.coord.q === 0 && c.coord.r === 0)!
      .ships.filter((s) => s.ownerId === 'player-1')

    const result = withAllDiceThree(() =>
      resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming, {
        destructionSelection: ['def-dd-1'],
      }),
    )
    expect(result.attackerWon).toBe(true)
    expect(result.roundOne!.attackerTotal).toBe(15)
    expect(result.roundOne!.defenderTotal).toBe(9)
    expect(result.rawDamage).toBe(6)
    expect(result.rawDamage).toBe(
      result.roundOne!.attackerTotal - result.roundOne!.defenderTotal,
    )
    expect(result.shieldAbsorbed).toBe(0)
    expect(result.destroyedShipIds).toEqual(['def-dd-1'])
    expect(result.log.find((e) => e.step === 'shield-absorb')?.message).toContain('Очки уничтожения 6')
  })

  it('resolveCombatAtCell auto-wipes when damage covers entire loser fleet', () => {
    const map = createEmptyMap('full-wipe', 'Wipe')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    let seq = 0
    const rng = () => {
      seq++
      return seq <= 6 ? 5 / 6 : 0
    }

    const result = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-bb', type: 'battleship', ownerId: 'player-1' }],
      {},
      rng,
    )
    expect(result.needsDestructionSelection).toBeFalsy()
    expect(result.destroyedShipIds).toContain('def-dd')
  })

  it('does not await destruction when one point cannot destroy a skipped ship', () => {
    const map = createEmptyMap('no-affordable-destruction', 'No affordable destruction')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const rolls = [0.5, 0.3] // 3 против 2 на d4: бюджет 1, skip эсминца повышает destroyCost до 4.
    let rollIndex = 0
    const result = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      { attacker: { prioritySkips: [{ shipType: 'destroyer' }] } },
      () => rolls[rollIndex++] ?? 0,
    )

    expect(result.rawDamage).toBe(1)
    expect(result.needsDestructionSelection).toBeFalsy()
    expect(result.destroyedShipIds).toEqual([])
    expect(result.log.find((entry) => entry.step === 'destruction')?.message)
      .toMatch(/Ничья раунда без уничтожения/)
  })

  it('resolveCombatAtCell requests manual destruction when damage is partial', () => {
    const map = createEmptyMap('partial-dmg', 'Partial')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.turnNumber = 2
    for (let i = 0; i < 5; i++) {
      addShip(game, 0, 0, 'player-1', 'destroyer', `att-dd-${i}`)
    }
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-3')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const incoming = game.cells
      .find((c) => c.coord.q === 0 && c.coord.r === 0)!
      .ships.filter((s) => s.ownerId === 'player-1')

    const result = withAllDiceThree(() =>
      resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming),
    )
    expect(result.attackerWon).toBe(true)
    expect(result.needsDestructionSelection).toBe(true)
    expect(result.destructionState?.remainingDamage).toBe(6)
    expect(result.destructionState?.forceFullWipe).toBe(false)
    expect(result.destructionState?.immediatelyDestroyableIds.length).toBeGreaterThan(0)
  })

  it('confirm-combat-destruction works for winner who is not activePlayer', () => {
    const map = createEmptyMap('destroy-winner', 'Destroy winner')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.turnNumber = 2

    for (let i = 0; i < 5; i++) {
      addShip(game, 0, 0, 'player-1', 'destroyer', `att-dd-${i}`)
    }
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-3')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const incoming = game.cells
      .find((c) => c.coord.q === 0 && c.coord.r === 0)!
      .ships.filter((s) => s.ownerId === 'player-1')

    const result = withAllDiceThree(() =>
      resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming),
    )
    expect(result.needsDestructionSelection).toBe(true)
    expect(result.winnerId).toBe('player-1')

    setupPendingCombatDestruction(
      game,
      { q: 1, r: 0 },
      'player-1',
      'player-2',
      result,
      {},
      { attacker: [], defender: [] },
      'movement',
      {
        incomingAttackerShipIds: incoming.map((s) => s.id),
        movementFrom: { q: 0, r: 0 },
        movementPlans: incoming.map((s) => ({ shipId: s.id, to: { q: 1, r: 0 } })),
      },
    )

    // Ход фазы у другого игрока — победитель раунда всё равно должен подтвердить уничтожение.
    game.activePlayerId = 'player-2'

    const pick = result.destructionState?.selectableIds[0]
    expect(pick).toBeTruthy()

    const { errors } = applyGameActionOnSnapshot(
      game,
      map,
      'player-1',
      'confirm-combat-destruction',
      { destructionSelection: [pick!] },
    )
    expect(errors).toEqual([])
  })

  it('applyShieldAbsorption follows 6+3 rulebook example', () => {
    const contributions = [
      {
        shipId: 'sh-self',
        ownerId: 'p2',
        absorbCapacity: SHIELD_ABSORB_SELF,
        scope: 'self' as const,
        fromCoord: { q: 1, r: 0 },
      },
      {
        shipId: 'sh-nei',
        ownerId: 'p2',
        absorbCapacity: SHIELD_ABSORB_NEIGHBOR,
        scope: 'neighbor' as const,
        fromCoord: { q: 0, r: 0 },
      },
    ]
    expect(applyShieldAbsorption(8, contributions)).toEqual({
      remainingDamage: 0,
      absorbed: 8,
    })
    expect(applyShieldAbsorption(12, contributions)).toEqual({
      remainingDamage: 3,
      absorbed: 9,
    })
  })

  it('selectShipsToDestroy respects destruction priority', () => {
    const ships = [
      { id: 'bb', type: 'battleship' as ShipType, ownerId: 'p2' },
      { id: 'dd', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'cr', type: 'cruiser' as ShipType, ownerId: 'p2' },
    ]
    const destroyed = selectShipsToDestroy(ships, 10, new Set())
    expect(destroyed[0]).toBe('dd')
    expect(destroyed).toContain('cr')
  })

  it('priority skip by ship type delays all ships of that type', () => {
    const ships = [
      { id: 'bb1', type: 'battleship' as ShipType, ownerId: 'p2' },
      { id: 'dd1', type: 'destroyer' as ShipType, ownerId: 'p2' },
    ]
    const destroyed = selectShipsToDestroy(ships, 4, new Set(['battleship']))
    expect(destroyed).toEqual(['dd1'])
  })

  it('priority skip type applies to every ship of the type in tier', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-3', type: 'destroyer' as ShipType, ownerId: 'p2' },
    ]
    // skip: destroyCost 3+1=4; бюджет 6 → один эсминец; бюджет 8 → два
    expect(selectShipsToDestroy(ships, 6, new Set(['destroyer']))).toEqual(['dd-1'])
    expect(selectShipsToDestroy(ships, 8, new Set(['destroyer']))).toEqual(['dd-1', 'dd-2'])
  })

  it('getImmediatelyDestroyableShipIds highlights front tier within budget', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'cr-1', type: 'cruiser' as ShipType, ownerId: 'p2' },
    ]
    const ordered = sortShipsForDestruction(ships, new Set())
    const immediate = getImmediatelyDestroyableShipIds(ordered, 11, new Set(), (t) =>
      t === 'destroyer' ? 3 : 6,
    )
    expect(immediate).toEqual(['dd-1', 'dd-2'])
  })

  it('validateDestructionSelection rejects out-of-priority picks', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'cr-1', type: 'cruiser' as ShipType, ownerId: 'p2' },
    ]
    const errors = validateDestructionSelection(ships, ['cr-1'], 6, new Set())
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/Эсминец|эсминец/i)
  })

  it('validateDestructionSelection allows any ship within the same type', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-3', type: 'destroyer' as ShipType, ownerId: 'p2' },
    ]
    // Раньше сравнение шло по позиции в отсортированном списке (id),
    // и выбор dd-2 без dd-1 давал «Эсминец раньше Эсминец».
    expect(validateDestructionSelection(ships, ['dd-2'], 4, new Set())).toEqual([])
    expect(validateDestructionSelection(ships, ['dd-3', 'dd-1'], 8, new Set())).toEqual([])
  })

  it('validateDestructionSelection still blocks lower type while higher type remains', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'cr-1', type: 'cruiser' as ShipType, ownerId: 'p2' },
    ]
    expect(validateDestructionSelection(ships, ['cr-1'], 6, new Set()).join(' '))
      .toMatch(/Эсминец/)
    expect(validateDestructionSelection(ships, ['dd-2', 'cr-1'], 9, new Set()).join(' '))
      .toMatch(/Эсминец/)
    expect(validateDestructionSelection(ships, ['dd-1', 'dd-2', 'cr-1'], 14, new Set())).toEqual([])
  })

  it('buildDestructionSelectionState does not list cruiser as initially selectable ahead of destroyers', () => {
    const map = createEmptyMap('sel-priority', 'Sel priority')
    map.cells.push({ q: 0, r: 0, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'player-2' },
      { id: 'dd-2', type: 'destroyer' as ShipType, ownerId: 'player-2' },
      { id: 'cr-1', type: 'cruiser' as ShipType, ownerId: 'player-2' },
    ]
    const state = buildDestructionSelectionState(game, ships, 12, new Set())
    expect(state.selectableIds).toEqual(expect.arrayContaining(['dd-1', 'dd-2']))
    expect(state.selectableIds).not.toContain('cr-1')
    expect(state.immediatelyDestroyableIds).not.toContain('cr-1')
  })

  it('validateDestructionSelection allows lower type when higher type is priority-skipped', () => {
    const ships = [
      { id: 'dd-1', type: 'destroyer' as ShipType, ownerId: 'p2' },
      { id: 'cr-1', type: 'cruiser' as ShipType, ownerId: 'p2' },
    ]
    expect(
      validateDestructionSelection(ships, ['cr-1'], 7, new Set(['destroyer']), {
        destroyCostForType: (t) => (t === 'destroyer' ? 4 : 6),
      }),
    ).toEqual([])
  })

  it('both sides can configure type-based priority skip in combat options', () => {
    const map = createEmptyMap('both-skip', 'Skip')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [
        { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
        { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
      ],
    )
    expect(preview).not.toBeNull()

    // Skip только префиксом цепочки: DD, но не CR без DD; последний тип в бою — нельзя.
    const ok = validateCombatOptions(game, preview!, ['att-bb', 'att-dd'], {
      attacker: { prioritySkips: [{ shipType: 'destroyer' }] },
      defender: { prioritySkips: [{ shipType: 'destroyer' }] },
    })
    expect(ok).toEqual([])

    const outOfOrder = validateCombatOptions(game, preview!, ['att-bb', 'att-dd'], {
      attacker: { prioritySkips: [{ shipType: 'cruiser' }] },
    })
    expect(outOfOrder.some((e) => /порядку приоритета/.test(e))).toBe(true)

    const skipLastUseless = validateCombatOptions(game, preview!, ['att-bb', 'att-dd'], {
      attacker: { prioritySkips: [{ shipType: 'destroyer' }, { shipType: 'cruiser' }] },
    })
    expect(skipLastUseless.some((e) => /порядку приоритета|бессмысленно/.test(e))).toBe(true)

    const ownSideRejected = validateCombatOptions(game, preview!, ['att-bb', 'att-dd'], {
      attacker: { prioritySkips: [{ shipType: 'battleship' }] },
    })
    expect(ownSideRejected.some((e) => /нет у противника/.test(e))).toBe(true)
  })

  it('priority skip helpers: prefix only, last present type not skippable', () => {
    const present: ShipType[] = ['destroyer', 'cruiser', 'battleship']
    expect(presentDestructionPriorityChain(present)).toEqual([
      'destroyer',
      'cruiser',
      'battleship',
    ])
    expect(isValidPrioritySkipSet([], present)).toBe(true)
    expect(isValidPrioritySkipSet(['destroyer'], present)).toBe(true)
    expect(isValidPrioritySkipSet(['destroyer', 'cruiser'], present)).toBe(true)
    expect(isValidPrioritySkipSet(['cruiser'], present)).toBe(false)
    expect(isValidPrioritySkipSet(['destroyer', 'cruiser', 'battleship'], present)).toBe(false)

    expect(canTogglePrioritySkipType('destroyer', [], present)).toBe(true)
    expect(canTogglePrioritySkipType('cruiser', [], present)).toBe(false)
    expect(canTogglePrioritySkipType('cruiser', ['destroyer'], present)).toBe(true)
    expect(canTogglePrioritySkipType('battleship', ['destroyer', 'cruiser'], present)).toBe(false)

    expect(applyPrioritySkipToggle('destroyer', ['destroyer', 'cruiser'], present)).toEqual([])
    expect(applyPrioritySkipToggle('cruiser', ['destroyer'], present)).toEqual([
      'destroyer',
      'cruiser',
    ])

    expect(primaryDestructionType(present, [])).toBe('destroyer')
    expect(primaryDestructionType(present, ['destroyer'])).toBe('cruiser')
    expect(selectableDestructionTypes(present, [])).toEqual(['destroyer'])
    expect(selectableDestructionTypes(present, ['destroyer'])).toEqual([
      'destroyer',
      'cruiser',
    ])
    expect(selectableDestructionTypes(present, ['destroyer', 'cruiser'])).toEqual([
      'destroyer',
      'cruiser',
      'battleship',
    ])
  })

  it('executeMarkerMovement removes destroyed defender ships on attacker win', () => {
    const map = createEmptyMap('move-combat', 'MoveCombat')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    game.phase = 'planning'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.phase = 'actions'

    const originalRandom = Math.random
    let seq = 0
    Math.random = () => {
      seq++
      return seq <= 6 ? 5 / 6 : 0
    }

    try {
      const exec = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-bb', to: { q: 1, r: 0 } },
      ], {})
      expect(exec.errors).toEqual([])
      expect(exec.combatResult?.destroyedShipIds).toContain('def-dd')

      const battleCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
      expect(battleCell.ships.some((s) => s.id === 'att-bb')).toBe(true)
      expect(battleCell.ships.some((s) => s.id === 'def-dd')).toBe(false)
    } finally {
      Math.random = originalRandom
    }
  })

  it('updateCombatPrep accepts priority skip without token payment', () => {
    const map = createEmptyMap('prep-skip', 'Prep skip')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.phase = 'planning'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.phase = 'actions'

    const prepStart = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-bb', to: { q: 1, r: 0 } },
      { shipId: 'att-dd', to: { q: 1, r: 0 } },
    ])
    expect(prepStart.errors).toEqual([])

    // Защитник пропускает эсминцев атакующего (не единственный/последний тип).
    expect(updateCombatPrep(game, 'player-2', true, [{ shipType: 'destroyer' }]).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.readyBy['player-2']).toBe(true)

    updateCombatPrep(game, 'player-1', true, [{ shipType: 'destroyer' }])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')
  })

  it('combat prep waits for both sides then resolves after countdown', () => {
    const map = createEmptyMap('prep', 'Prep')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.phase = 'planning'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.phase = 'actions'

    const prepStart = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-bb', to: { q: 1, r: 0 } },
    ])
    expect(prepStart.errors).toEqual([])
    expect(prepStart.combatResult).toBeUndefined()
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')

    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([])
    expect(updateCombatPrep(game, 'player-2', true).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')

    combatPrepOf(game.pendingCombat)!.countdownStartedAt = Date.now() - 4000

    const originalRandom = Math.random
    let seq = 0
    Math.random = () => {
      seq++
      return seq <= 6 ? 5 / 6 : 0
    }
    try {
      const resolved = resolveCombatPrep(game, map)
      expect(resolved.errors).toEqual([])
      expect(resolved.combatResult?.attackerWon).toBe(true)
      expect(combatPrepOf(game.pendingCombat)).toBeUndefined()
    } finally {
      Math.random = originalRandom
    }
  })

  it('requires attacker then defender to continue a combat', () => {
    const map = createEmptyMap('continue-order', 'Continue order')
    map.cells.push({ q: 1, r: 0 })
    map.cells.push({ q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'movement', undefined, {
      shipsDestroyedInCombat: true,
    })

    expect(continuePendingCombat(game, 'player-2').errors[0]).toMatch(/Сначала/)
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(
      isAwaitingContinue(game.pendingCombat) && game.pendingCombat.continueDecisions.attacker,
    ).toBe(true)
    expect(stopPendingCombat(game, 'player-2', { q: 0, r: 1 })).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
  })

  it('forbids retreat until at least one ship is destroyed in the combat', () => {
    const map = createEmptyMap('no-retreat-yet', 'No retreat yet')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    setupPendingCombat(
      game,
      { q: 1, r: 0 },
      'player-1',
      2,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att', to: { q: 1, r: 0 } }],
        incomingAttackerShipIds: ['att'],
      },
      { shipsDestroyedInCombat: false },
    )
    expect(getCombatRetreatDestinations(game, 'player-1')).toEqual([])
    expect(stopPendingCombat(game, 'player-1', { q: 0, r: 1 })[0]).toMatch(/не уничтожен/)
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
  })

  it('auto-starts next rounds when no ships were destroyed yet', () => {
    const map = createEmptyMap('auto-continue', 'Auto continue')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.turnNumber = 2
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    setupPendingCombat(
      game,
      { q: 1, r: 0 },
      'player-1',
      1,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att', to: { q: 1, r: 0 } }],
        incomingAttackerShipIds: ['att'],
      },
      { shipsDestroyedInCombat: false },
    )

    // Чередуем сильный и слабый бросок на d4 — раунд не застревает в ничьей.
    let roll = 0
    const originalRandom = Math.random
    Math.random = () => {
      roll += 1
      return roll % 2 === 0 ? 0.99 : 0.01
    }
    try {
      const continued = continuePendingCombat(game, 'player-1')
      expect(continued.errors).toEqual([])
      expect(continued.combatResult).toBeTruthy()
      const reachedOutcome =
        (continued.combatResult?.destroyedShipIds.length ?? 0) > 0
        || game.pendingCombat?.shipsDestroyedInCombat === true
        || game.pendingCombat?.phase === 'awaiting-destruction'
        || game.pendingCombat?.phase === 'awaiting-continue'
        || game.pendingCombat == null
      expect(reachedOutcome).toBe(true)
    } finally {
      Math.random = originalRandom
    }
  })

  it('lists legal retreat cells and moves defender ships there', () => {
    const map = createEmptyMap('retreat', 'Retreat')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    addShip(game, 1, -1, 'player-1', 'destroyer', 'enemy-on-destination')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'movement', undefined, {
      shipsDestroyedInCombat: true,
    })
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(getCombatRetreatDestinations(game, 'player-2')).toEqual([{ q: 0, r: 1 }])
    expect(stopPendingCombat(game, 'player-2', { q: 0, r: 1 })).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)?.ships[0]?.id).toBe('def')
  })

  it('removes the defender action marker when attacker wins, even on a neutral cell', () => {
    const map = createEmptyMap('captured-marker', 'Captured marker')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0, isPowerCenter: true, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    // Нейтральная клетка: контроль не переходит, но маркер защитника всё равно снимается.
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = null
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })

    applyCombatResultToSnapshot(
      game,
      {
        coord: { q: 1, r: 0 },
        winnerId: 'player-1',
        attackerWon: true,
        log: [],
        destroyedShipIds: ['def'],
        stub: false,
      },
      'player-1',
      'player-2',
    )

    expect(game.actionMarkers).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.actionMarkerId).toBeNull()
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.controlOwnerId).toBeNull()
  })

  it('combat capture takes control and removes defender production marker', () => {
    const map = createEmptyMap('capture-prod', 'Capture prod')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    const cell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    cell.controlOwnerId = 'player-2'
    cell.productionMarkerId = 'prod-p2'
    game.productionMarkers.push({
      id: 'prod-p2',
      ownerId: 'player-2',
      coord: { q: 1, r: 0 },
      targetRegionId: 'region-p2',
    })

    applyCombatResultToSnapshot(
      game,
      {
        coord: { q: 1, r: 0 },
        winnerId: 'player-1',
        attackerWon: true,
        log: [],
        destroyedShipIds: ['def'],
        stub: false,
      },
      'player-1',
      'player-2',
    )

    expect(cell.controlOwnerId).toBe('player-1')
    expect(cell.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('removes action marker when owner ships are wiped even if round winner is defender', () => {
    const map = createEmptyMap('orphan-marker', 'Orphan marker')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-b')
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })

    // Уничтожены все корабли владельца маркера — маркер снимается независимо от attackerWon.
    applyCombatResultToSnapshot(
      game,
      {
        coord: { q: 1, r: 0 },
        winnerId: 'player-2',
        attackerWon: false,
        log: [],
        destroyedShipIds: ['def-a', 'def-b'],
        stub: false,
      },
      'player-1',
      'player-2',
    )

    expect(game.actionMarkers).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.actionMarkerId).toBeNull()
  })

  it('after combat wipe via follow-up, attackers occupy the battle cell and marker is cleared', () => {
    const map = createEmptyMap('occupy-wipe', 'Occupy wipe')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.activePlayerId = 'player-2'
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })
    game.activePlayerId = 'player-1'
    game.phase = 'actions'

    const originalRandom = Math.random
    Math.random = () => 5 / 6
    try {
      const result = executeMarkerMovement(
        game,
        map,
        'player-1',
        { q: 0, r: 0 },
        [{ shipId: 'att-bb', to: { q: 1, r: 0 } }],
        {},
      )
      expect(result.errors).toEqual([])
      expect(result.combatResult?.attackerWon).toBe(true)
      expect(game.pendingCombat).toBeUndefined()

      const battle = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
      const origin = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
      expect(battle.ships.some((s) => s.id === 'att-bb')).toBe(true)
      expect(origin.ships.some((s) => s.id === 'att-bb')).toBe(false)
      expect(battle.ships.some((s) => s.ownerId === 'player-2')).toBe(false)
      expect(battle.actionMarkerId).toBeNull()
      expect(game.actionMarkers.every((m) => m.ownerId !== 'player-2')).toBe(true)
      expect(battle.controlOwnerId).toBe('player-1')
    } finally {
      Math.random = originalRandom
    }
  })

  it('keeps the defender action marker when defender wins the round', () => {
    const map = createEmptyMap('defender-marker', 'Defender marker')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })
    const markerId = game.actionMarkers[0]!.id

    applyCombatResultToSnapshot(
      game,
      {
        coord: { q: 1, r: 0 },
        winnerId: 'player-2',
        attackerWon: false,
        log: [],
        destroyedShipIds: ['att'],
        stub: false,
      },
      'player-1',
      'player-2',
    )

    expect(game.actionMarkers).toHaveLength(1)
    expect(game.actionMarkers[0]!.id).toBe(markerId)
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.actionMarkerId).toBe(markerId)
  })

  it('removes defender marker when defender retreats; keeps it when attacker retreats', () => {
    const map = createEmptyMap('retreat-marker', 'Retreat marker')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })
    setupPendingCombat(
      game,
      { q: 1, r: 0 },
      'player-1',
      2,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att', to: { q: 1, r: 0 } }],
        incomingAttackerShipIds: ['att'],
      },
      { shipsDestroyedInCombat: true },
    )
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(stopPendingCombat(game, 'player-2', { q: 0, r: 1 })).toEqual([])
    expect(game.actionMarkers).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.actionMarkerId).toBeNull()

    const game2 = gameSnapshotFromMap(map)
    game2.phase = 'planning'
    game2.activePlayerId = 'player-2'
    addShip(game2, 0, 0, 'player-1', 'destroyer', 'att2')
    addShip(game2, 1, 0, 'player-2', 'destroyer', 'def2')
    placeActionMarker(game2, 'player-2', { q: 1, r: 0 })
    const markerId = game2.actionMarkers[0]!.id
    setupPendingCombat(
      game2,
      { q: 1, r: 0 },
      'player-1',
      2,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att2', to: { q: 1, r: 0 } }],
        incomingAttackerShipIds: ['att2'],
      },
      { shipsDestroyedInCombat: true },
    )
    expect(stopPendingCombat(game2, 'player-1', { q: 1, r: -1 })).toEqual([])
    expect(game2.actionMarkers).toHaveLength(1)
    expect(game2.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)?.actionMarkerId).toBe(markerId)
  })
})

describe('bombardment', () => {
  function placeMarker(game: GameSnapshot, ownerId: string, coord: { q: number; r: number }) {
    placeActionMarker(game, ownerId, coord)
  }

  it('canShipBombard matches ships.yaml fireRange types', () => {
    expect(canShipBombard('cruiser')).toBe(true)
    expect(canShipBombard('battleship')).toBe(true)
    expect(canShipBombard('hyper')).toBe(true)
    expect(canShipBombard('destroyer')).toBe(false)
  })

  it('getBombardmentTargetKeys lists contested cells in fireRange only', () => {
    const map = createEmptyMap('bombard-test', 'Bombard')
    map.cells.push({ q: 1, r: 0 }, { q: 3, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.cells.find((c) => c.coord.q === 3 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const keys = getBombardmentTargetKeys(game, 'player-1', { q: 0, r: 0 }, 'battleship')
    expect(keys).toContain('1,0')
    expect(keys).not.toContain('3,0')
  })

  it('buildBombardmentPreview uses support dice from source cell', () => {
    const map = createEmptyMap('bombard-preview', 'Preview')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)

    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'dd-2')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildBombardmentPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'cr-1', type: 'cruiser', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )
    expect(preview?.trigger).toBe('bombardment')
    expect(preview?.attacker.combatDiceTotal).toBe(0)
    expect(preview?.attacker.supportDiceTotal).toBe(1)
    expect(preview?.attacker.supportingShips[0]?.shipId).toBe('cr-1')
    expect(preview?.defender.combatDiceTotal).toBe(0)
    expect(preview?.defender.supportDiceTotal).toBe(0)
    expect(preview?.defender.supportingShips).toEqual([])
    expect(preview?.defender.ships).toHaveLength(1)
  })

  it('bombardment roll: defender does not roll; damage equals attacker sum', () => {
    const map = createEmptyMap('bombard-no-def-dice', 'NoDefDice')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)

    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildBombardmentPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'bb-1', type: 'battleship', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )
    expect(preview).not.toBeNull()

    const round = rollCombatRound(preview!, () => 0.99)
    expect(round.shipRolls.every((r) => r.side === 'attacker')).toBe(true)
    expect(round.defenderTotal).toBe(0)
    expect(round.winner).toBe('attacker')
    // battleship supportDice = 2 d4, fixed high rolls → 4+4
    expect(round.attackerTotal).toBe(8)
    expect(computeRoundDamage(round)).toBe(8)

    const result = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      [],
      {},
      () => 0.99,
      preview!,
    )
    expect(result.attackerWon).toBe(true)
    expect(result.rawDamage).toBe(8)
    expect(result.roundOne!.defenderTotal).toBe(0)
    expect(result.roundOne!.shipRolls.filter((r) => r.side === 'defender')).toHaveLength(0)
  })

  it('executeMarkerBombardment resolves marker without moving ships', () => {
    const map = createEmptyMap('bombard-exec', 'Exec')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'

    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const result = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'cr-1', target: { q: 1, r: 0 } },
    ], {})
    const errors = result.errors
    expect(errors).toEqual([])
    expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.ships).toHaveLength(1)
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
    expect(game.actionMarkers).toHaveLength(0)
  })

  it('validateMarkerBombardment rejects out-of-range target', () => {
    const map = createEmptyMap('bombard-range', 'Range')
    map.cells.push({ q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'

    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const errors = validateMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'cr-1', target: { q: 2, r: 0 } },
    ])
    expect(errors.some((e) => /дальность/i.test(e))).toBe(true)
  })

  it('buildCombatPreviewFromPending works for awaitingDestruction roundState without prep', () => {
    const map = createEmptyMap('destr-preview', 'Destr')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-1')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    game.pendingCombat = {
      cellKey: '1,0',
      attackerId: 'player-1',
      defenderIds: ['player-2'],
      roundNumber: 1,
      phase: 'awaiting-destruction',
      trigger: 'movement',
      roundState: {
        rounds: [],
        shieldAbsorbed: 0,
        rawDamage: 1,
        remainingDamage: 1,
        winnerId: 'player-1',
        attackerWon: true,
        defenderId: 'player-2',
        combatOptions: {},
        incomingAttackerShipIds: ['att-1'],
        attackerSkipTypes: [],
        defenderSkipTypes: [],
        trigger: 'movement',
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att-1', to: { q: 1, r: 0 } }],
      },
    }

    const preview = buildCombatPreviewFromPending(game)
    expect(preview).not.toBeNull()
    expect(preview!.attackerId).toBe('player-1')
    expect(preview!.defenderId).toBe('player-2')
  })

  it('bombardment prep starts countdown when attacker ready only', () => {
    const map = createEmptyMap('bombard-prep', 'Bombard prep')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const prepStart = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'bb-1', target: { q: 1, r: 0 } },
    ])
    expect(prepStart.errors).toEqual([])
    expect(game.pendingCombat?.trigger).toBe('bombardment')
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')

    expect(updateCombatPrep(game, 'player-2', true).errors.length).toBeGreaterThan(0)
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')

    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')
  })

  it('bombardment wipe does not transfer cell control to attacker', () => {
    const map = createEmptyMap('bombard-control', 'Bombard control')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'

    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    targetCell.controlOwnerId = 'player-2'
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const originalRandom = Math.random
    Math.random = () => 5 / 6
    try {
      const result = executeMarkerBombardment(
        game,
        map,
        'player-1',
        { q: 0, r: 0 },
        [{ shipId: 'bb-1', target: { q: 1, r: 0 } }],
        {},
      )
      expect(result.errors).toEqual([])
      expect(result.combatResult?.attackerWon).toBe(true)
      expect(targetCell.ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(0)
      expect(targetCell.controlOwnerId).toBe('player-2')
      expect(game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!.ships).toHaveLength(1)
    } finally {
      Math.random = originalRandom
    }
  })

  it('destroyer sacrifice on neutral claims control and destroys the ship', () => {
    const map = createEmptyMap('neutral-dd-sacrifice', 'Neutral DD sacrifice')
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1']
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    placeMarker(game, 'player-1', { q: 0, r: 0 })
    targetCell.controlOwnerId = null

    const result = executeDestroyerSacrifice(game, map, 'player-1', { q: 0, r: 0 }, 'att-dd')
    expect(result.errors).toEqual([])
    expect(targetCell.controlOwnerId).toBe('player-1')
    expect(targetCell.ships).toHaveLength(0)
    expect(game.actionMarkers).toHaveLength(0)
  })

  it('destroyer winning combat on a neutral cell does not claim until sacrificed', () => {
    const map = createEmptyMap('neutral-dd-combat', 'Neutral DD combat')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    targetCell.controlOwnerId = null
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const originalRandom = Math.random
    let roll = 0
    Math.random = () => {
      roll += 1
      return roll % 3 === 0 ? 0.01 : 0.99
    }
    try {
      const result = executeMarkerMovement(
        game,
        map,
        'player-1',
        { q: 0, r: 0 },
        [
          { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
          { shipId: 'att-dd-2', to: { q: 1, r: 0 } },
        ],
        {},
      )
      expect(result.errors).toEqual([])
      expect(result.combatResult?.attackerWon).toBe(true)
      expect(targetCell.controlOwnerId).toBeNull()
      expect(targetCell.ships.some((s) => s.ownerId === 'player-1' && s.type === 'destroyer')).toBe(true)

      game.actionMarkers = []
      expect(advanceGameSnapshot(game, map.id)).toEqual([])
      expect(targetCell.controlOwnerId).toBeNull()
    } finally {
      Math.random = originalRandom
    }
  })

  it('destroyer combat win on neutral does not paint before ships land', () => {
    const map = createEmptyMap('neutral-dd-result', 'Neutral DD result')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    targetCell.controlOwnerId = null

    applyCombatResultToSnapshot(
      game,
      {
        coord: { q: 1, r: 0 },
        winnerId: 'player-1',
        attackerWon: true,
        log: [],
        destroyedShipIds: ['def-dd'],
        stub: false,
      },
      'player-1',
      'player-2',
      {
        incomingAttackerShips: [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      },
    )

    expect(targetCell.controlOwnerId).toBeNull()
  })

  it('battleship winning combat on a neutral cell does not grant control until end of turn', () => {
    const map = createEmptyMap('neutral-combat', 'Neutral combat')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    targetCell.controlOwnerId = null
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const originalRandom = Math.random
    Math.random = () => 5 / 6
    try {
      const result = executeMarkerMovement(
        game,
        map,
        'player-1',
        { q: 0, r: 0 },
        [{ shipId: 'att-bb', to: { q: 1, r: 0 } }],
        {},
      )
      expect(result.errors).toEqual([])
      expect(result.combatResult?.attackerWon).toBe(true)
      expect(targetCell.ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(0)
      expect(targetCell.controlOwnerId).toBeNull()
      expect(targetCell.ships.some((s) => s.ownerId === 'player-1')).toBe(true)
    } finally {
      Math.random = originalRandom
    }
  })

  it('winning combat on defender-controlled cell transfers control', () => {
    const map = createEmptyMap('owned-combat', 'Owned combat')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const targetCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    targetCell.controlOwnerId = 'player-2'
    placeMarker(game, 'player-1', { q: 0, r: 0 })

    const originalRandom = Math.random
    Math.random = () => 5 / 6
    try {
      const result = executeMarkerMovement(
        game,
        map,
        'player-1',
        { q: 0, r: 0 },
        [{ shipId: 'att-bb', to: { q: 1, r: 0 } }],
        {},
      )
      expect(result.errors).toEqual([])
      expect(result.combatResult?.attackerWon).toBe(true)
      expect(targetCell.controlOwnerId).toBe('player-1')
    } finally {
      Math.random = originalRandom
    }
  })
})

describe('pendingCombat FSM', () => {
  function combatOnCell(): GameSnapshot {
    const map = createEmptyMap('fsm', 'FSM')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    return game
  }

  it('accepts a well-formed pendingCombat in each phase', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2)
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(pendingCombatInvariantViolations(game)).toEqual([])

    const prepGame = combatOnCell()
    prepGame.phase = 'actions'
    prepGame.activePlayerId = 'player-1'
    setupCombatPrepForMovement(
      prepGame,
      { q: 0, r: 0 },
      [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
      'player-1',
      { q: 1, r: 0 },
      ['att-dd'],
    )
    expect(prepGame.pendingCombat?.phase).toBe('prep')
    expect(pendingCombatInvariantViolations(prepGame)).toEqual([])
  })

  it('reports a violation when the combat cell is not on the map', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.cellKey = '99,99'
    expect(pendingCombatInvariantViolations(game).join(' ')).toMatch(/отсутствует на карте/)
  })

  it('reports a violation when the attacker is no longer a player', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.attackerId = 'ghost'
    expect(pendingCombatInvariantViolations(game).join(' ')).toMatch(/отсутствует среди игроков/)
  })

  it('releaseInvalidPendingCombat clears a broken combat and logs it', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.attackerId = 'ghost'

    const violations = releaseInvalidPendingCombat(game)
    expect(violations.length).toBeGreaterThan(0)
    expect(game.pendingCombat).toBeUndefined()
    expect(game.eventLog.at(-1)?.message).toMatch(/снят автоматически/)
  })

  it('releaseInvalidPendingCombat keeps a valid combat untouched', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    expect(releaseInvalidPendingCombat(game)).toEqual([])
    expect(game.pendingCombat).toBeDefined()
  })

  it('abortPendingCombat is limited to combat participants', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)

    expect(abortPendingCombat(game, 'player-3').errors[0]).toMatch(/только участник/)
    expect(game.pendingCombat).toBeDefined()

    expect(abortPendingCombat(game, 'player-2').errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
    expect(game.eventLog.at(-1)?.message).toMatch(/прерван участником/)
  })

  it('abort-combat action unblocks a stuck combat for the attacker', () => {
    const map = createEmptyMap('fsm-abort', 'FSM abort')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2)

    // Пока бой висит, обычные действия заблокированы.
    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'advance-phase').errors[0])
      .toMatch(/завершите или продолжите/)

    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'abort-combat').errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
  })
})

describe('покрытие непокрытых боевых путей', () => {
  it('после частичного уничтожения: awaiting-continue и раунд 2 без погибших кораблей', () => {
    const map = createEmptyMap('partial-then-r2', 'Partial then R2')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.turnNumber = 2

    // 7 эсминцев атаки vs 4 защиты, d4=3 → 21 vs 12, урон 9 = ровно 3 эсминца (не full wipe).
    for (let i = 0; i < 7; i++) {
      addShip(game, 0, 0, 'player-1', 'destroyer', `att-dd-${i}`)
    }
    for (let i = 1; i <= 4; i++) {
      addShip(game, 1, 0, 'player-2', 'destroyer', `def-dd-${i}`)
    }
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const incoming = game.cells
      .find((c) => c.coord.q === 0 && c.coord.r === 0)!
      .ships.filter((s) => s.ownerId === 'player-1')
    const movementPlans = incoming.map((s) => ({ shipId: s.id, to: { q: 1, r: 0 } }))

    const result = withAllDiceThree(() =>
      resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming),
    )
    expect(result.attackerWon).toBe(true)
    expect(result.needsDestructionSelection).toBe(true)
    expect(result.rawDamage).toBe(9)

    setupPendingCombatDestruction(
      game,
      { q: 1, r: 0 },
      'player-1',
      'player-2',
      result,
      {},
      { attacker: [], defender: [] },
      'movement',
      {
        incomingAttackerShipIds: incoming.map((s) => s.id),
        movementFrom: { q: 0, r: 0 },
        movementPlans,
      },
    )

    const killed = ['def-dd-1', 'def-dd-2', 'def-dd-3']
    expect(confirmCombatDestruction(game, 'player-1', killed).errors).toEqual([])

    const cell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    expect(cell.ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(1)
    expect(cell.ships.some((s) => s.id === 'def-dd-4')).toBe(true)

    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.shipsDestroyedInCombat).toBe(true)
    expect(
      isAwaitingContinue(game.pendingCombat) ? game.pendingCombat.continueDecisions : null,
    ).toEqual({})

    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(
      isAwaitingContinue(game.pendingCombat) && game.pendingCombat.continueDecisions?.attacker,
    ).toBe(true)

    const previewBeforeR2 = buildCombatPreviewFromPending(game)
    expect(previewBeforeR2?.defender.ships.filter((s) => s.type === 'destroyer')).toHaveLength(1)

    const continued = withAllDiceThree(() => continuePendingCombat(game, 'player-2'))
    expect(continued.errors).toEqual([])

    const r2 = continued.combatResult
    expect(r2).toBeTruthy()
    const defenderRolls = (r2!.rounds?.at(-1) ?? r2!.roundOne)?.shipRolls.filter(
      (s) => s.side === 'defender' && s.shipType === 'destroyer' && !s.supportRolls?.length,
    )
    expect(defenderRolls).toHaveLength(1)
    expect(defenderRolls![0]?.shipId).toBe('def-dd-4')
  })

  it('раунд 2+: сохраняет movementFrom/plans, attackerId и увеличивает roundNumber', () => {
    const map = createEmptyMap('round2', 'Round 2')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.turnNumber = 2

    for (let i = 0; i < 5; i++) {
      addShip(game, 0, 0, 'player-1', 'destroyer', `att-dd-${i}`)
    }
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-3')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const incoming = game.cells
      .find((c) => c.coord.q === 0 && c.coord.r === 0)!
      .ships.filter((s) => s.ownerId === 'player-1')
    const movementPlans = incoming.map((s) => ({ shipId: s.id, to: { q: 1, r: 0 } }))

    const result = withAllDiceThree(() =>
      resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming),
    )
    expect(result.needsDestructionSelection).toBe(true)

    setupPendingCombatDestruction(
      game,
      { q: 1, r: 0 },
      'player-1',
      'player-2',
      result,
      {},
      { attacker: [], defender: [] },
      'movement',
      {
        incomingAttackerShipIds: incoming.map((s) => s.id),
        movementFrom: { q: 0, r: 0 },
        movementPlans,
      },
    )
    expect(game.pendingCombat?.phase).toBe('awaiting-destruction')
    expect(game.pendingCombat?.roundNumber).toBe(1)

    const pick = result.destructionState?.selectableIds[0]
    expect(pick).toBeTruthy()
    expect(confirmCombatDestruction(game, 'player-1', [pick!]).errors).toEqual([])

    // После частичного уничтожения бой продолжается — следующий раунд.
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.roundNumber).toBe(2)
    expect(game.pendingCombat?.attackerId).toBe('player-1')
    expect(game.pendingCombat?.continuation?.movementFrom).toEqual({ q: 0, r: 0 })
    expect(game.pendingCombat?.continuation?.movementPlans).toHaveLength(incoming.length)
    expect(pendingCombatInvariantViolations(game)).toEqual([])

    // Защитник продолжает бой — attackerId и планы движения не должны пропасть.
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    const originalRandom = Math.random
    Math.random = () => 0.5
    try {
      const continued = continuePendingCombat(game, 'player-2')
      expect(continued.errors).toEqual([])
      if (game.pendingCombat?.phase === 'awaiting-destruction') {
        expect(game.pendingCombat.attackerId).toBe('player-1')
        const rs = combatRoundStateOf(game.pendingCombat)
        expect(rs?.movementFrom).toEqual({ q: 0, r: 0 })
        expect(rs?.movementPlans?.length).toBe(incoming.length)
        expect(pendingCombatInvariantViolations(game)).toEqual([])
      } else if (game.pendingCombat?.phase === 'awaiting-continue') {
        expect(game.pendingCombat.attackerId).toBe('player-1')
        expect(game.pendingCombat.continuation?.movementFrom).toEqual({ q: 0, r: 0 })
        expect(game.pendingCombat.roundNumber).toBeGreaterThanOrEqual(2)
      }
    } finally {
      Math.random = originalRandom
    }
  })

  it('queuedBombardmentPlans подхватывает следующую цель после завершения первой', () => {
    const map = createEmptyMap('queue-bomb', 'Queue bomb')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']

    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 2, 0, 'player-2', 'destroyer', 'def-b')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const prevPhase = game.phase
    game.phase = 'planning'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.phase = prevPhase

    const start = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'bb-1', target: { q: 1, r: 0 } },
      { shipId: 'bb-2', target: { q: 2, r: 0 } },
    ])
    expect(start.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('prep')
    expect(game.pendingCombat?.cellKey).toBe('1,0')
    expect(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans).toEqual([
      { shipId: 'bb-2', target: { q: 2, r: 0 } },
    ])
    expect(pendingCombatInvariantViolations(game)).toEqual([])

    const queued = [...(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans ?? [])]
    const next = continueBombardmentQueueOrFinalize(
      game,
      'player-1',
      { q: 0, r: 0 },
      [{ shipId: 'bb-1', target: { q: 1, r: 0 } }],
      queued,
    )
    expect(next.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('prep')
    expect(game.pendingCombat?.cellKey).toBe('2,0')
    expect(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans ?? []).toEqual([])
    expect(pendingCombatInvariantViolations(game)).toEqual([])
  })

  it('supportSide: третья сторона выбирает сторону; без кораблей — ошибка', () => {
    const map = createEmptyMap('support-side', 'Support side')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.players.push({
      id: 'player-3',
      name: 'Игрок 3',
      color: '#22c55e',
      isAi: false,
      eliminated: false,
    })
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']

    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    expect(
      setupCombatPrepForMovement(
        game,
        { q: 0, r: 0 },
        [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
        'player-1',
        { q: 1, r: 0 },
        ['att-dd'],
      ),
    ).toEqual([])

    expect(updateCombatPrep(game, 'player-3', true, undefined, 'attacker').errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.combatOptions.supportSides?.['player-3']).toBe('attacker')
    expect(combatPrepOf(game.pendingCombat)?.readyBy['player-3']).toBe(true)

    expect(updateCombatPrep(game, 'player-3', true, undefined, 'defender').errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.combatOptions.supportSides?.['player-3']).toBe('defender')

    expect(updateCombatPrep(game, 'player-3', true, undefined, null).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.combatOptions.supportSides?.['player-3']).toBeUndefined()

    // Игрок без подходящих кораблей рядом — не может вмешиваться.
    game.players.push({
      id: 'player-4',
      name: 'Игрок 4',
      color: '#a855f7',
      isAi: false,
      eliminated: false,
    })
    expect(updateCombatPrep(game, 'player-4', true, undefined, 'attacker').errors[0])
      .toMatch(/не можете поддержать/)
  })

  it('prep на трёх игроков: countdown ждёт готовности и третьей стороны с поддержкой', () => {
    const map = createEmptyMap('prep3', 'Prep 3')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.players.push({
      id: 'player-3',
      name: 'Игрок 3',
      color: '#22c55e',
      isAi: false,
      eliminated: false,
    })
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']

    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    setupCombatPrepForMovement(
      game,
      { q: 0, r: 0 },
      [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
      'player-1',
      { q: 1, r: 0 },
      ['att-dd'],
    )

    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([])
    expect(updateCombatPrep(game, 'player-2', true).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')

    expect(updateCombatPrep(game, 'player-3', true, undefined, 'attacker').errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')
    expect(pendingCombatInvariantViolations(game)).toEqual([])
  })

  it('migrateLegacyPendingCombat выводит phase из старых флагов', () => {
    expect(
      migrateLegacyPendingCombat({
        cellKey: '1,0',
        attackerId: 'player-1',
        defenderIds: ['player-2'],
        roundNumber: 1,
        awaitingContinue: false,
        prep: {
          phase: 'prep',
          defenderId: 'player-2',
          readyBy: {},
          combatOptions: {},
        },
      })?.phase,
    ).toBe('prep')

    expect(
      migrateLegacyPendingCombat({
        cellKey: '1,0',
        attackerId: 'player-1',
        defenderIds: ['player-2'],
        roundNumber: 1,
        awaitingContinue: false,
        awaitingDestruction: true,
        roundState: {
          rounds: [],
          shieldAbsorbed: 0,
          rawDamage: 3,
          remainingDamage: 3,
          winnerId: 'player-1',
          attackerWon: true,
          defenderId: 'player-2',
          combatOptions: {},
          incomingAttackerShipIds: [],
          attackerSkipTypes: [],
          defenderSkipTypes: [],
          trigger: 'movement',
        },
      })?.phase,
    ).toBe('awaiting-destruction')

    expect(
      migrateLegacyPendingCombat({
        cellKey: '1,0',
        attackerId: 'player-1',
        defenderIds: ['player-2'],
        roundNumber: 2,
        awaitingContinue: true,
        continueDecisions: { attacker: true },
      })?.phase,
    ).toBe('awaiting-continue')

    expect(
      migrateLegacyPendingCombat({
        cellKey: '1,0',
        attackerId: 'player-1',
        defenderIds: ['player-2'],
        roundNumber: 1,
      }),
    ).toBeUndefined()

    // Полный путь нормализации сохранения тоже мигрирует.
    const map = createEmptyMap('legacy-save', 'Legacy')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    const normalized = normalizeGalaxySave({
      format: GALAXY_SAVE_FORMAT,
      version: GALAXY_SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      map,
      game: {
        ...game,
        pendingCombat: {
          cellKey: '1,0',
          attackerId: 'player-1',
          defenderIds: ['player-2'],
          roundNumber: 1,
          awaitingContinue: true,
          continueDecisions: {},
        } as never,
      },
    })
    expect(normalized.game?.pendingCombat?.phase).toBe('awaiting-continue')
  })

  it('сохранение после отступления: контроль защитника и корабли атакующего — легально', () => {
    const map = createEmptyMap('retreat-save', 'Retreat save')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    // После отступления защитника: на клетке боя стоят корабли атакующего,
    // а контроль всё ещё у защитника — раньше validateGalaxySave это отвергал.
    const battleCell = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    battleCell.controlOwnerId = 'player-2'
    battleCell.ships = [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }]

    const errors = validateGalaxySave({
      format: GALAXY_SAVE_FORMAT,
      version: GALAXY_SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      map,
      game,
    })
    expect(errors.filter((e) => e.includes('не совпадает с владельцем кораблей'))).toEqual([])
  })

  it('isCombatDestination: пустая чужая controlled — не бой, любой вражеский корабль — бой', () => {
    const map = createEmptyMap('no-combat-empty', 'No combat')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    expect(isCombatDestination(game, 'player-1', { q: 1, r: 0 })).toBe(false)

    addShip(game, 0, 1, 'player-2', 'destroyer', 'dd-1')
    game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!.controlOwnerId = 'player-2'
    expect(isCombatDestination(game, 'player-1', { q: 0, r: 1 })).toBe(true)
  })

  it('stopPendingCombat: отступление на чужую контролируемую клетку сразу забирает контроль', () => {
    const map = createEmptyMap('retreat-control', 'Retreat control')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'
    const retreatCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    retreatCell.controlOwnerId = 'player-1'
    retreatCell.productionMarkerId = 'prod-p1'
    game.productionMarkers.push({
      id: 'prod-p1',
      ownerId: 'player-1',
      coord: { q: 0, r: 1 },
      targetRegionId: 'region-p1',
    })
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'movement', undefined, {
      shipsDestroyedInCombat: true,
    })
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(stopPendingCombat(game, 'player-2', { q: 0, r: 1 })).toEqual([])
    expect(retreatCell.controlOwnerId).toBe('player-2')
    expect(retreatCell.ships.some((s) => s.id === 'def-dd')).toBe(true)
    expect(retreatCell.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('after defender retreats, attacker enter takes control of the battle hex', () => {
    const map = createEmptyMap('retreat-enter-control', 'Retreat enter')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const battle = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    battle.controlOwnerId = 'player-2'
    const retreatCell = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 1)!
    retreatCell.controlOwnerId = 'player-1'
    setupPendingCombat(
      game,
      { q: 1, r: 0 },
      'player-1',
      2,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [{ shipId: 'att-dd', to: { q: 1, r: 0 } }],
        incomingAttackerShipIds: ['att-dd'],
      },
      { shipsDestroyedInCombat: true },
    )
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'stop-combat', {
        retreatTo: { q: 0, r: 1 },
      }).errors,
    ).toEqual([])
    expect(retreatCell.controlOwnerId).toBe('player-2')
    expect(battle.controlOwnerId).toBe('player-1')
    expect(battle.ships.some((s) => s.id === 'att-dd')).toBe(true)
    expect(retreatCell.ships.some((s) => s.id === 'def-dd')).toBe(true)
  })

  it('щит атакующего поглощает, когда атакующий проиграл раунд', () => {
    const map = createEmptyMap('att-shield', 'Attacker shield')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 2, 0, 'player-1', 'shield', 'att-sh')
    addShip(game, 1, 0, 'player-2', 'battleship', 'def-bb')
    game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!.controlOwnerId = 'player-2'

    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
    )
    expect(preview).not.toBeNull()
    expect(preview!.shieldContributions.some((c) => c.ownerId === 'player-1')).toBe(true)

    let n = 0
    const rng = () => {
      // destroyer 1d6 low, battleship 3d6 high → defender wins
      n++
      return n <= 1 ? 0 : 5 / 6
    }
    const result = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      {},
      rng,
      preview!,
    )
    expect(result.attackerWon).toBe(false)
    expect(result.shieldAbsorbed).toBeGreaterThan(0)
  })
})
