import { describe, expect, it } from 'vitest'
import { autoResolveClaimPicks } from './claim.js'
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
  abortPendingCombat,
  applyCombatResultToSnapshot,
  beginOrAwaitCombatContinuation,
  buildCombatPreview,
  buildCombatPreviewForMoves,
  buildCombatPreviewFromPending,
  combatOrderFromMoves,
  combatPrepOf,
  combatResolutionFingerprint,
  combatResolutionFromPending,
  COMBAT_STUB,
  continuePendingCombat,
  detectCombats,
  detectCombatsFromMoves,
  estimateBattleOutcome,
  formatCombatRoundSummary,
  getCombatRetreatDestinations,
  isAwaitingContinue,
  isCombatDestination,
  ONE_BATTLE_PER_MARKER_MSG,
  pendingCombatInvariantViolations,
  releaseInvalidPendingCombat,
  removeShipsFromSnapshot,
  resolveCombatAtCell,
  rollCombatRound,
  setupCombatPrepForMovement,
  setupPendingCombat,
  stopPendingCombat,
  updateCombatPrep,
  UNRESOLVABLE_BATTLE_MSG,
  validateSingleCombatDestination,
} from './combat.js'
import {
  applyGameActionOnSnapshot,
  executeMarkerMovement,
  getLegalActionsForSnapshot,
  resolveCombatPrep,
} from './movement.js'
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
import { combatDiceReport } from './combat-dice-report.js'
import { forecastBattle, forecastRoundDamage } from './combat-forecast.js'

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

function cellAt(game: GameSnapshot, q: number, r: number) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error(`cell ${q},${r} missing`)
  return cell
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

/** Все кубики выпадают шестёркой. */
const allSixes = () => 5 / 6

/** Кубики выпадают по списку значений d6; после конца списка — единицы. */
function diceSequence(values: number[]): () => number {
  const queue = [...values]
  return () => ((queue.shift() ?? 1) - 1) / 6 + 0.01
}

function withRandom<T>(rng: () => number, fn: () => T): T {
  const original = Math.random
  Math.random = rng
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

/** Две клетки: атакующий на (0,0), защитник на (1,0), клетка защитника под его контролем. */
function duelBoard(extraCells: { q: number; r: number }[] = []) {
  const map = createEmptyMap('duel-board', 'Duel board')
  map.cells.push({ q: 1, r: 0 }, ...extraCells)
  const game = gameSnapshotFromMap(map)
  game.phase = 'actions'
  game.activePlayerId = 'player-1'
  game.participatingPlayerIds = ['player-1', 'player-2']
  cellAt(game, 1, 0).controlOwnerId = 'player-2'
  return { map, game }
}

describe('превью боя', () => {
  it('корабли на клетке боя стреляют по порогу своего класса и имеют прочность', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')

    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(preview.attacker.ships).toEqual([
      expect.objectContaining({ shipId: 'att-bb', dice: 3, threshold: 4, hull: 3, damage: 0 }),
    ])
    expect(preview.defender.ships.map((s) => [s.shipId, s.dice, s.threshold, s.hull])).toEqual([
      ['def-dd', 1, 6, 1],
      ['def-cr', 2, 5, 2],
    ])
    expect(preview.attacker.diceTotal).toBe(3)
    expect(preview.defender.diceTotal).toBe(3)
    expect(preview.attacker.expectedHits).toBeCloseTo(1.5)
  })

  it('поддержка с соседней клетки: +1 к нужному значению; эсминец не поддерживает', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-2', 'cruiser', 'sup-cr')
    addShip(game, 2, 0, 'player-2', 'destroyer', 'sup-dd')

    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
    ])!
    expect(preview.defender.supportingShips).toEqual([
      expect.objectContaining({ shipId: 'sup-cr', distance: 1, dice: 2, threshold: 6 }),
    ])
    expect(preview.defender.diceTotal).toBe(3)
    expect(preview.attacker.supportingShips).toEqual([])
  })

  it('мирный ход того же маркера считается уже сделанным для поддержки', () => {
    const map = createEmptyMap('support-peaceful', 'Support peaceful')
    for (const c of [{ q: -1, r: 1 }, { q: -1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }]) {
      map.cells.push(c)
    }
    const game = gameSnapshotFromMap(map)
    addShip(game, -1, -1, 'player-1', 'destroyer', 'att-dd')
    addShip(game, -1, -1, 'player-1', 'cruiser', 'att-cr-fight')
    addShip(game, -1, -1, 'player-1', 'cruiser', 'att-cr-support')
    addShip(game, -1, 1, 'player-2', 'destroyer', 'def-dd')
    cellAt(game, -1, 1).controlOwnerId = 'player-2'
    const incoming = [
      { id: 'att-dd', type: 'destroyer' as ShipType, ownerId: 'player-1' },
      { id: 'att-cr-fight', type: 'cruiser' as ShipType, ownerId: 'player-1' },
    ]

    // С исходной клетки расстояние 2 — крейсеру уже не хватает шестёрки.
    const withoutPlans = buildCombatPreview(game, { q: -1, r: 1 }, 'player-1', incoming)
    expect(withoutPlans?.attacker.supportingShips).toEqual([])

    const withPlans = buildCombatPreview(game, { q: -1, r: 1 }, 'player-1', incoming, {
      attackerMovementPlans: [
        { shipId: 'att-dd', to: { q: -1, r: 1 } },
        { shipId: 'att-cr-fight', to: { q: -1, r: 1 } },
        { shipId: 'att-cr-support', to: { q: 0, r: 0 } },
      ],
    })
    expect(withPlans?.attacker.supportingShips).toEqual([
      expect.objectContaining({ shipId: 'att-cr-support', fromCoord: { q: 0, r: 0 }, threshold: 6 }),
    ])
  })

  it('третий игрок направляет поддержку выбранной стороне', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    game.players.push({ id: 'player-3', name: 'Игрок 3', color: '#22c55e', isAi: false, eliminated: false })
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')

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

  it('авианосец: +2 кубика союзникам на своей клетке, +1 с соседней, не себе подобным, не складывается', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 0, 1, 'player-1', 'carrier', 'att-cv-far')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')

    // Авианосец остался на соседней клетке: +1.
    const adjacent = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
    ])!
    expect(adjacent.attacker.ships[0]).toMatchObject({ shipId: 'att-dd', dice: 2, bonusDice: 1 })

    // Авианосец идёт в бой вместе с эсминцем: +2, сам не стреляет, бонусы не складываются.
    const together = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
      { id: 'att-cv', type: 'carrier', ownerId: 'player-1' },
    ])!
    expect(together.attacker.ships.find((s) => s.shipId === 'att-dd')).toMatchObject({ dice: 3, bonusDice: 2 })
    expect(together.attacker.ships.find((s) => s.shipId === 'att-cv')).toMatchObject({ dice: 0, hull: 2 })
  })

  it('гиперорудие на своей клетке не стреляет и держит одно попадание', () => {
    const { game } = duelBoard([{ q: 3, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'raid-dd')
    addShip(game, 1, 0, 'player-2', 'hyper', 'def-hy')
    addShip(game, 3, 0, 'player-2', 'hyper', 'far-hy')

    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'raid-dd', type: 'destroyer', ownerId: 'player-1' },
    ])!
    expect(preview.defender.ships[0]).toMatchObject({ shipId: 'def-hy', dice: 0, threshold: null, hull: 1 })
    // Второе гиперорудие в двух клетках поддерживает на 5+.
    expect(preview.defender.supportingShips).toEqual([
      expect.objectContaining({ shipId: 'far-hy', distance: 2, threshold: 5, dice: 3 }),
    ])
  })

  it('detectCombatsFromMoves и detectCombats находят спорные клетки', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    expect(isCombatDestination(game, 'player-1', { q: 1, r: 0 })).toBe(true)

    const pending = detectCombatsFromMoves(game, [{ shipId: 'att-dd', to: { q: 1, r: 0 } }], 'player-1')
    expect(pending).toHaveLength(1)
    expect(pending[0].defenderId).toBe('player-2')
    expect(pending[0].trigger).toBe('movement')

    addShip(game, 1, 0, 'player-1', 'destroyer', 'stacked')
    expect(detectCombats(game)).toHaveLength(1)
    expect(detectCombats(game)[0].trigger).toBe('stack')
  })

  it('validateSingleCombatDestination: один маркер — один бой', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'dd-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 0, 1, 'player-2', 'destroyer', 'def-b')
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
})

describe('раунд боя', () => {
  function bbVersusDestroyerAndCruiser() {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    const incoming = [{ id: 'att-bb', type: 'battleship' as ShipType, ownerId: 'player-1' }]
    return { game, incoming, preview: buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', incoming)! }
  }

  it('попадания обеих сторон применяются одновременно', () => {
    const { preview } = bbVersusDestroyerAndCruiser()
    const round = rollCombatRound(preview, {}, {}, allSixes)

    // Линкор сосредоточил огонь на крейсере, защитники — на линкоре.
    expect(round.attackerHits).toBe(3)
    expect(round.defenderHits).toBe(3)
    expect(round.destroyedShipIds.sort()).toEqual(['att-bb', 'def-cr'])
    expect(round.damageByShipId['def-dd'] ?? 0).toBe(0)

    const bbLog = round.shipRolls.find((r) => r.shipId === 'att-bb')!
    expect(bbLog.dice).toHaveLength(3)
    expect(bbLog.dice.every((d) => d.targetShipId === 'def-cr' && d.hit)).toBe(true)
    expect(formatCombatRoundSummary(round, 2)).toBe('Раунд 2 — попаданий: атакующий 3, защитник 3')
  })

  /**
   * Баг-репорт Serafal от 2026-09-26: уничтоженный авианосец подписывался служебным номером
   * корабля вместо класса. Авианосец не бросает кубиков, поэтому в бросках раунда его нет, а с
   * доски он после боя пропадает — подписать его можно только по классам из итога раунда.
   */
  it('классы уничтоженных есть в итоге раунда — даже у тех, кто не стрелял', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'carrier', 'def-cv')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!

    const round = rollCombatRound(preview, {}, {}, allSixes)
    expect(round.destroyedShipIds).toEqual(['def-cv'])
    expect(round.shipRolls.some((roll) => roll.shipId === 'def-cv')).toBe(false)
    expect(round.destroyedShipTypes).toEqual({ 'def-cv': 'carrier' })
  })

  it('урон, полученный раньше в этом бою, учитывается', () => {
    const { preview } = bbVersusDestroyerAndCruiser()
    // Линкор уже получил два попадания; эсминец защиты добивает его единственной шестёркой.
    const rng = diceSequence([1, 1, 1, 6, 1, 1])
    const round = rollCombatRound(preview, { 'att-bb': 2 }, {}, rng)
    expect(round.destroyedShipIds).toEqual(['att-bb'])
    expect(round.damageByShipId['att-bb']).toBe(3)
  })

  it('порядок целей стороны направляет кубики', () => {
    const { preview } = bbVersusDestroyerAndCruiser()
    const round = rollCombatRound(
      preview,
      {},
      { attacker: { targetPriority: ['def-dd'] } },
      allSixes,
    )
    const bbLog = round.shipRolls.find((r) => r.shipId === 'att-bb')!
    expect(bbLog.dice[0]!.targetShipId).toBe('def-dd')
    expect(round.destroyedShipIds).toContain('def-dd')
  })

  it('resolveCombatAtCell: исход раунда и урон выживших', () => {
    const { game, incoming } = bbVersusDestroyerAndCruiser()
    const result = resolveCombatAtCell(
      game,
      { q: 1, r: 0 },
      'player-1',
      incoming,
      {},
      diceSequence([6, 6, 1, 6, 1, 1]),
    )
    // Два попадания линкора сносят крейсер, эсминец защиты ранит линкор.
    expect(result.destroyedShipIds).toEqual(['def-cr'])
    expect(result.attackerWon).toBe(false)
    expect(result.winnerId).toBeNull()
    expect(result.damageByShipId).toEqual({ 'att-bb': 1 })
    expect(result.log.find((e) => e.step === 'dice-roll')!.message).toBe(
      formatCombatRoundSummary(result.rounds![0]!),
    )
  })

  it('ни одна сторона не может стрелять — бой не состоялся', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'carrier', 'def-cv')
    const result = resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-cv', type: 'carrier', ownerId: 'player-1' },
    ])
    expect(result.stalemate).toBe(true)
    expect(result.attackerWon).toBe(false)
    expect(result.destroyedShipIds).toEqual([])
  })

  it('estimateBattleOutcome: линкор против эсминца почти всегда побеждает', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    let n = 0
    const odds = estimateBattleOutcome(preview, {
      samples: 300,
      rng: () => {
        n = (n + 1) % 6
        return n / 6 + 0.001
      },
    })
    expect(odds.win + odds.draw + odds.defeat).toBeCloseTo(1, 5)
    expect(odds.win).toBeGreaterThan(0.9)
  })

  it('combatResolutionFingerprint устойчив к журналу и меняется с бросками', () => {
    const { preview } = bbVersusDestroyerAndCruiser()
    const round = rollCombatRound(preview, {}, {}, allSixes)
    const base = {
      coord: { q: 1, r: 0 },
      winnerId: null,
      attackerWon: false,
      log: [],
      destroyedShipIds: round.destroyedShipIds,
      rounds: [round],
      stub: false,
    }
    const a = combatResolutionFingerprint(base)
    expect(combatResolutionFingerprint({ ...base, log: [{ step: 'dice-roll' as const, message: 'x' }] })).toBe(a)
    const other = rollCombatRound(preview, {}, {}, () => 0)
    expect(combatResolutionFingerprint({ ...base, rounds: [other] })).not.toBe(a)
    expect(combatResolutionFingerprint(null)).toBeNull()
  })

  it('COMBAT_STUB выключен', () => {
    expect(COMBAT_STUB).toBe(false)
  })
})

describe('бой перемещением', () => {
  it('атакующий побеждает: защитник уничтожен, линкор входит, контроль переходит', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    game.activePlayerId = 'player-2'
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })
    game.activePlayerId = 'player-1'

    const result = withRandom(allSixes, () =>
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-bb', to: { q: 1, r: 0 } },
      ], {}),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.attackerWon).toBe(true)
    expect(result.combatResult?.destroyedShipIds).toEqual(['def-dd'])
    expect(game.pendingCombat).toBeUndefined()

    const battle = cellAt(game, 1, 0)
    expect(battle.ships.map((s) => s.id)).toEqual(['att-bb'])
    expect(cellAt(game, 0, 0).ships).toEqual([])
    expect(battle.controlOwnerId).toBe('player-1')
    expect(battle.actionMarkerId).toBeNull()
    expect(game.actionMarkers.every((m) => m.ownerId !== 'player-2')).toBe(true)
  })

  it('защитник побеждает: атакующий уничтожен и никуда не входит', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'battleship', 'def-bb')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const result = withRandom(allSixes, () =>
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-dd', to: { q: 1, r: 0 } },
      ], {}),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.attackerWon).toBe(false)
    expect(result.combatResult?.winnerId).toBe('player-2')
    expect(game.pendingCombat).toBeUndefined()
    expect(cellAt(game, 1, 0).ships.map((s) => s.id)).toEqual(['def-bb'])
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-2')
    expect(game.actionMarkers.filter((m) => m.ownerId === 'player-1')).toEqual([])
  })

  it('рейд на гиперорудие: оно не отвечает и гибнет от одного попадания', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'destroyer', 'raid-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'raid-2')
    addShip(game, 1, 0, 'player-2', 'hyper', 'def-hy')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const result = withRandom(diceSequence([6, 1]), () =>
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'raid-1', to: { q: 1, r: 0 } },
        { shipId: 'raid-2', to: { q: 1, r: 0 } },
      ], {}),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.destroyedShipIds).toEqual(['def-hy'])
    expect(result.combatResult?.attackerWon).toBe(true)
    expect(cellAt(game, 1, 0).ships.map((s) => s.id).sort()).toEqual(['raid-1', 'raid-2'])
  })

  it('бой, в котором никто не может стрелять, не допускается вовсе', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'carrier', 'def-cv')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    for (const options of [{}, undefined]) {
      const result = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-cv', to: { q: 1, r: 0 } },
      ], options)
      expect(result.errors).toEqual([UNRESOLVABLE_BATTLE_MSG])
      expect(game.pendingCombat).toBeUndefined()
      expect(cellAt(game, 0, 0).ships.map((s) => s.id)).toEqual(['att-cv'])
      expect(game.actionMarkerResolvedThisTurn).toBeFalsy()
    }
  })

  it('на центр власти, где бой невозможен, можно только осадить', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'carrier', 'def-cv')
    cellAt(game, 1, 0).isPowerCenter = true
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const result = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-cv', to: { q: 1, r: 0 } },
    ])
    expect(result.errors).toEqual([])
    const prep = combatPrepOf(game.pendingCombat)!
    expect(prep.siegeAvailable).toBe(true)
    expect(prep.assaultBlocked).toBe(true)
    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([UNRESOLVABLE_BATTLE_MSG])
    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege').errors).toEqual([])
    expect(game.sieges?.['1,0']?.besiegerId).toBe('player-1')
    // Ответить осаждённому нечем — вопроса о нападении нет.
    expect(game.pendingCombat).toBeUndefined()
  })

  it('урон копится между раундами одного боя и исчезает вместе с боем', () => {
    const { map, game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd2')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    // Раунд 1. Атакующий: линкор [def-dd1, def-dd1, def-dd2], эсминец [def-dd2].
    // Защита: оба эсминца бьют линкор. Выпало: линкор 6,1,1; эсминец 1; защита 6,1.
    const round1 = withRandom(diceSequence([6, 1, 1, 1, 6, 1]), () =>
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-bb', to: { q: 1, r: 0 } },
        { shipId: 'att-dd', to: { q: 1, r: 0 } },
      ], {}),
    )
    expect(round1.errors).toEqual([])
    expect(round1.combatResult?.destroyedShipIds).toEqual(['def-dd1'])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.shipsDestroyedInCombat).toBe(true)
    expect(game.pendingCombat?.roundNumber).toBe(2)
    expect(game.pendingCombat?.damageByShipId).toEqual({ 'att-bb': 1 })
    expect(game.pendingCombat?.continuation?.movementFrom).toEqual({ q: 0, r: 0 })
    expect(game.pendingCombat?.continuation?.movementPlans).toHaveLength(2)
    expect(combatResolutionFromPending(game.pendingCombat)?.destroyedShipIds).toEqual(['def-dd1'])
    expect(pendingCombatInvariantViolations(game)).toEqual([])
    // Корабли атакующего до исхода боя стоят на исходной клетке.
    expect(cellAt(game, 0, 0).ships).toHaveLength(2)

    const preview = buildCombatPreviewFromPending(game)!
    expect(preview.attacker.ships.find((s) => s.shipId === 'att-bb')?.damage).toBe(1)

    // Раунд 2: атака мажет, эсминец защиты снова попадает по линкору.
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    const round2 = continuePendingCombat(game, 'player-2', undefined, diceSequence([1, 1, 1, 1, 6]))
    expect(round2.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.roundNumber).toBe(3)
    expect(game.pendingCombat?.damageByShipId).toEqual({ 'att-bb': 2 })

    // Раунд 3: линкор добивает последнего защитника; атакующий входит.
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    const round3 = withRandom(diceSequence([6, 1, 1, 1, 1]), () =>
      applyGameActionOnSnapshot(game, map, 'player-2', 'continue-combat'),
    )
    expect(round3.errors).toEqual([])
    expect(round3.combatResult?.attackerWon).toBe(true)
    expect(game.pendingCombat).toBeUndefined()
    expect(cellAt(game, 1, 0).ships.map((s) => s.id).sort()).toEqual(['att-bb', 'att-dd'])
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
  })

  it('перед каждым раундом стороны выбирают цели, даже если уничтожений ещё не было', () => {
    const { map, game } = duelBoard()
    game.turnNumber = 2
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

    // Отступать нельзя: остаётся только подтвердить цели.
    const legal = (playerId: string) =>
      getLegalActionsForSnapshot(game, map.id, playerId).map((action) => action.id)
    expect(legal('player-1')).toContain('continue-combat')
    expect(legal('player-1')).not.toContain('stop-combat')

    // Пока никто не уничтожен, защитник может подтвердить раньше атакующего.
    expect(continuePendingCombat(game, 'player-2').errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    const empty = continuePendingCombat(game, 'player-1', {}, diceSequence([1, 1]))
    expect(empty.errors).toEqual([])
    // Раунд прошёл впустую — и снова ждём решений.
    expect(game.pendingCombat?.roundNumber).toBe(3)
    expect(isAwaitingContinue(game.pendingCombat) && game.pendingCombat.continueDecisions).toEqual({})

    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    const hit = continuePendingCombat(game, 'player-2', {}, diceSequence([6, 1]))
    expect(hit.combatResult?.destroyedShipIds).toEqual(['def'])
    expect(hit.combatResult?.attackerWon).toBe(true)
    expect(game.pendingCombat).toBeUndefined()
  })

  it('выбранные цели действуют один раунд', () => {
    const { game } = duelBoard()
    addShip(game, 1, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-3')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'stack', undefined, {
      shipsDestroyedInCombat: false,
    })

    // Все три кубика линкора — во второй эсминец; сама игра разбросала бы их по двум.
    expect(continuePendingCombat(game, 'player-1', {
      diceTargets: { 'att-bb': ['def-2', 'def-2', 'def-2'] },
    }).errors).toEqual([])
    const round = continuePendingCombat(game, 'player-2', {}, diceSequence([6, 6, 6, 1, 1, 1]))
    expect(round.errors).toEqual([])
    expect(round.combatResult?.destroyedShipIds).toEqual(['def-2'])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    // К следующему раунду выбор сброшен.
    expect(game.pendingCombat?.combatOptions?.attacker?.diceTargets).toBeUndefined()
  })

  it('кубики можно назначать только своим кораблям и только по врагам в бою', () => {
    const { game } = duelBoard()
    addShip(game, 1, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'stack', undefined, {
      shipsDestroyedInCombat: false,
    })
    expect(continuePendingCombat(game, 'player-1', { diceTargets: { 'def-dd': ['att-cr'] } }).errors[0])
      .toMatch(/своим кораблям/)
    expect(continuePendingCombat(game, 'player-1', { diceTargets: { 'att-cr': ['att-cr'] } }).errors[0])
      .toMatch(/не вражеский/)
    expect(continuePendingCombat(game, 'player-1', { diceTargets: { 'att-cr': ['def-dd', 'def-dd', 'def-dd'] } }).errors[0])
      .toMatch(/больше кубиков/)
    expect(continuePendingCombat(game, 'player-1', { diceTargets: { 'att-cr': ['def-dd', ''] } }).errors).toEqual([])
  })

  it('поддерживающий тоже подтверждает цели перед раундом', () => {
    const { map, game } = duelBoard([{ q: 1, r: -1 }])
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    if (!game.players.some((p) => p.id === 'player-3')) {
      game.players.push({ ...game.players[0]!, id: 'player-3', name: 'Игрок 3' })
    }
    addShip(game, 1, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    addShip(game, 1, -1, 'player-3', 'cruiser', 'sup-cr')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'stack', undefined, {
      shipsDestroyedInCombat: false,
    })
    game.pendingCombat!.combatOptions = { supportSides: { 'player-3': 'attacker' } }

    expect(getLegalActionsForSnapshot(game, map.id, 'player-3').map((a) => a.id)).toContain('continue-combat')
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(continuePendingCombat(game, 'player-2').errors).toEqual([])
    // Без поддерживающего раунд не бросается.
    expect(game.pendingCombat?.roundNumber).toBe(2)
    const rolled = continuePendingCombat(game, 'player-3', {}, diceSequence([1, 1, 1, 1, 1, 1]))
    expect(rolled.errors).toEqual([])
    expect(game.pendingCombat?.roundNumber).toBe(3)
    expect(isAwaitingContinue(game.pendingCombat) && game.pendingCombat.supportReady).toBeFalsy()
  })

  it('beginOrAwaitCombatContinuation переносит урон в следующий раунд и ждёт решений', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const incoming = [{ id: 'att-bb', type: 'battleship' as ShipType, ownerId: 'player-1' }]
    const first = resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', incoming, {}, diceSequence([1, 1, 1, 6]))
    expect(first.damageByShipId).toEqual({ 'att-bb': 1 })

    const followUp = beginOrAwaitCombatContinuation(
      game,
      {
        coord: { q: 1, r: 0 },
        attackerId: 'player-1',
        completedRoundNumber: 1,
        continuation: {
          movementFrom: { q: 0, r: 0 },
          movementPlans: [{ shipId: 'att-bb', to: { q: 1, r: 0 } }],
          incomingAttackerShipIds: ['att-bb'],
        },
        shipsDestroyedInCombat: false,
        seedCombatResult: first,
      },
    )
    expect(followUp.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.roundNumber).toBe(2)
    expect(game.pendingCombat?.damageByShipId).toEqual({ 'att-bb': 1 })
    expect(buildCombatPreviewFromPending(game)?.attacker.ships[0]?.damage).toBe(1)
  })
})

describe('подготовка к бою', () => {
  function prepGame() {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    const prepStart = executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-bb', to: { q: 1, r: 0 } },
      { shipId: 'att-dd', to: { q: 1, r: 0 } },
    ])
    expect(prepStart.errors).toEqual([])
    expect(prepStart.combatResult).toBeUndefined()
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')
    return { map, game }
  }

  it('стороны задают порядок целей; чужие корабли в нём недопустимы', () => {
    const { game } = prepGame()
    expect(updateCombatPrep(game, 'player-2', true, ['def-cr']).errors[0]).toMatch(/не участвует/)
    expect(updateCombatPrep(game, 'player-2', true, ['att-dd']).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.combatOptions.defender?.targetPriority).toEqual(['att-dd'])
    expect(combatPrepOf(game.pendingCombat)?.readyBy['player-2']).toBe(true)

    expect(updateCombatPrep(game, 'player-1', true, ['def-cr']).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')
  })

  it('после отсчёта бой разрешается', () => {
    const { map, game } = prepGame()
    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([])
    expect(updateCombatPrep(game, 'player-2', true).errors).toEqual([])
    combatPrepOf(game.pendingCombat)!.countdownStartedAt = Date.now() - 4000

    const resolved = withRandom(allSixes, () => resolveCombatPrep(game, map))
    expect(resolved.errors).toEqual([])
    expect(resolved.combatResult).toBeTruthy()
    expect(combatPrepOf(game.pendingCombat)).toBeUndefined()
  })

  it('действие update-combat-prep принимает порядок целей', () => {
    const { map, game } = prepGame()
    expect(
      applyGameActionOnSnapshot(game, map, 'player-1', 'update-combat-prep', {
        ready: true,
        targetPriority: ['def-dd'],
      }).errors,
    ).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.combatOptions.attacker?.targetPriority).toEqual(['def-dd'])
    expect(
      applyGameActionOnSnapshot(game, map, 'player-1', 'update-combat-prep', {
        ready: true,
        targetPriority: 'def-dd',
      }).errors[0],
    ).toMatch(/порядок целей/)
  })

  it('supportSide: третья сторона выбирает сторону; без кораблей — ошибка', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    game.players.push({ id: 'player-3', name: 'Игрок 3', color: '#22c55e', isAi: false, eliminated: false })
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')

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

    game.players.push({ id: 'player-4', name: 'Игрок 4', color: '#a855f7', isAi: false, eliminated: false })
    expect(updateCombatPrep(game, 'player-4', true, undefined, 'attacker').errors[0])
      .toMatch(/не можете поддержать/)
  })

  it('prep на трёх игроков: countdown ждёт готовности и третьей стороны с поддержкой', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    game.players.push({ id: 'player-3', name: 'Игрок 3', color: '#22c55e', isAi: false, eliminated: false })
    game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'third-cr')

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
})

describe('продолжение и отступление', () => {
  it('сначала решает атакующий, затем защитник', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
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

  it('отступать нельзя, пока в бою никто не уничтожен', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }])
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

  it('отступление — на соседнюю клетку без вражеских кораблей', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }, { q: 1, r: -1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    addShip(game, 1, -1, 'player-1', 'destroyer', 'enemy-on-destination')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2, 'movement', undefined, {
      shipsDestroyedInCombat: true,
    })
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    expect(getCombatRetreatDestinations(game, 'player-2')).toEqual([{ q: 0, r: 1 }])
    expect(stopPendingCombat(game, 'player-2', { q: 0, r: 1 })).toEqual([])
    expect(cellAt(game, 0, 1).ships[0]?.id).toBe('def')
  })

  it('маркер защитника снимается при его отступлении и остаётся при отступлении атакующего', () => {
    const extra = [{ q: 0, r: 1 }, { q: 1, r: -1 }]
    const { game } = duelBoard(extra)
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
    expect(cellAt(game, 1, 0).actionMarkerId).toBeNull()

    const { game: game2 } = duelBoard(extra)
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
    expect(cellAt(game2, 1, 0).actionMarkerId).toBe(markerId)
  })

  it('отступление на чужую контролируемую клетку сразу забирает контроль', () => {
    const { game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const retreatCell = cellAt(game, 0, 1)
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

  it('после отступления защитника атакующий входит и берёт клетку', () => {
    const { map, game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const retreatCell = cellAt(game, 0, 1)
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
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
    expect(cellAt(game, 1, 0).ships.some((s) => s.id === 'att-dd')).toBe(true)
    expect(retreatCell.ships.some((s) => s.id === 'def-dd')).toBe(true)
  })

  /** Маркер атакующего ведёт один корабль в бой, другой — на соседнюю с боем пустую клетку. */
  function splitMarkerBattle() {
    const { map, game } = duelBoard([{ q: 0, r: 1 }, { q: 1, r: -1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-side')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    setupPendingCombat(
      game,
      { q: 1, r: 0 },
      'player-1',
      2,
      'movement',
      {
        movementFrom: { q: 0, r: 0 },
        movementPlans: [
          { shipId: 'att', to: { q: 1, r: 0 } },
          { shipId: 'att-side', to: { q: 1, r: -1 } },
        ],
        incomingAttackerShipIds: ['att'],
      },
      { shipsDestroyedInCombat: true },
    )
    expect(continuePendingCombat(game, 'player-1').errors).toEqual([])
    return { map, game }
  }

  it('защитник не отступает туда, куда тем же маркером летят корабли атакующего', () => {
    const { map, game } = splitMarkerBattle()
    expect(getCombatRetreatDestinations(game, 'player-2')).toEqual([{ q: 0, r: 1 }])
    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'stop-combat', { retreatTo: { q: 1, r: -1 } }).errors[0],
    ).toMatch(/Нельзя отступить/)
  })

  it('после боя корабль маркера не садится в клетку, где за время боя оказались чужие корабли', () => {
    const { map, game } = splitMarkerBattle()
    // Чужой корабль появился на клетке назначения, пока шёл бой.
    addShip(game, 1, -1, 'player-2', 'destroyer', 'late')
    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'stop-combat', { retreatTo: { q: 0, r: 1 } }).errors,
    ).toEqual([])
    expect(cellAt(game, 1, 0).ships.map((s) => s.id)).toEqual(['att'])
    expect(cellAt(game, 1, -1).ships.map((s) => s.id)).toEqual(['late'])
    expect(cellAt(game, 0, 0).ships.map((s) => s.id)).toEqual(['att-side'])
  })
})

describe('итог боя на доске', () => {
  function result(attackerWon: boolean, destroyedShipIds: string[]) {
    return {
      coord: { q: 1, r: 0 },
      winnerId: attackerWon ? 'player-1' : 'player-2',
      attackerWon,
      log: [],
      destroyedShipIds,
      stub: false,
    }
  }

  it('маркер защитника снимается, когда его корабли уничтожены, даже на нейтрали', () => {
    const map = createEmptyMap('captured-marker', 'Captured marker')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0, isPowerCenter: true, startPlayer: 2 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    cellAt(game, 1, 0).controlOwnerId = null
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })

    applyCombatResultToSnapshot(game, result(true, ['def']), 'player-1', 'player-2')

    expect(game.actionMarkers).toEqual([])
    expect(cellAt(game, 1, 0).actionMarkerId).toBeNull()
    expect(cellAt(game, 1, 0).controlOwnerId).toBeNull()
  })

  it('захват клетки снимает маркер производства защитника', () => {
    const { game } = duelBoard()
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    const cell = cellAt(game, 1, 0)
    cell.productionMarkerId = 'prod-p2'
    game.productionMarkers.push({
      id: 'prod-p2',
      ownerId: 'player-2',
      coord: { q: 1, r: 0 },
      targetRegionId: 'region-p2',
    })

    applyCombatResultToSnapshot(game, result(true, ['def']), 'player-1', 'player-2')

    expect(cell.controlOwnerId).toBe('player-1')
    expect(cell.productionMarkerId).toBeNull()
    expect(game.productionMarkers).toHaveLength(0)
  })

  it('маркер остаётся, пока у владельца есть корабли на клетке', () => {
    const { game } = duelBoard()
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def')
    placeActionMarker(game, 'player-2', { q: 1, r: 0 })
    const markerId = game.actionMarkers[0]!.id

    applyCombatResultToSnapshot(game, result(false, ['att']), 'player-1', 'player-2')

    expect(game.actionMarkers.map((m) => m.id)).toEqual([markerId])
    expect(cellAt(game, 1, 0).actionMarkerId).toBe(markerId)
  })

  it('эсминец, выигравший бой на нейтрали, занимает её в конце хода', () => {
    const { map, game } = duelBoard()
    cellAt(game, 1, 0).controlOwnerId = null
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const res = withRandom(diceSequence([6, 6, 1]), () =>
      executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
        { shipId: 'att-dd-2', to: { q: 1, r: 0 } },
      ], {}),
    )
    expect(res.errors).toEqual([])
    expect(res.combatResult?.attackerWon).toBe(true)
    const target = cellAt(game, 1, 0)
    expect(target.controlOwnerId).toBeNull()
    expect(target.ships.some((s) => s.ownerId === 'player-1')).toBe(true)

    game.actionMarkers = []
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    // Захват в начале хода — выбор игрока; закрываем его за игрока.
    autoResolveClaimPicks(game, map.id, 'player-1')
    expect(target.controlOwnerId).toBe('player-1')
  })

  it('победа на нейтрали не красит клетку до высадки', () => {
    const { game } = duelBoard()
    cellAt(game, 1, 0).controlOwnerId = null
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    applyCombatResultToSnapshot(game, result(true, ['def-dd']), 'player-1', 'player-2', {
      incomingAttackerShips: [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
    })
    expect(cellAt(game, 1, 0).controlOwnerId).toBeNull()
  })
})

describe('обстрел', () => {
  it('обстреливать может тот, кто достаёт дальше своей клетки', () => {
    expect(canShipBombard('cruiser')).toBe(true)
    expect(canShipBombard('battleship')).toBe(true)
    expect(canShipBombard('hyper')).toBe(true)
    expect(canShipBombard('destroyer')).toBe(false)
    expect(canShipBombard('carrier')).toBe(false)
  })

  it('цели обстрела — клетки с вражескими кораблями в дальности; пустую чужую — нет', () => {
    const map = createEmptyMap('bombard-test', 'Bombard')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 })
    const game = gameSnapshotFromMap(map)
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    for (const q of [1, 2, 3]) {
      cellAt(game, q, 0).controlOwnerId = 'player-2'
      addShip(game, q, 0, 'player-2', 'destroyer', `dd-${q}`)
    }

    const keys = getBombardmentTargetKeys(game, 'player-1', { q: 0, r: 0 }, 'battleship')
    expect(keys.sort()).toEqual(['1,0', '2,0'])
    expect(getBombardmentTargetKeys(game, 'player-1', { q: 0, r: 0 }, 'cruiser')).toEqual(['1,0'])

    // Чужая клетка без кораблей: попасть не во что, а обстрел её не захватывает.
    cellAt(game, 1, 0).ships = []
    expect(getBombardmentTargetKeys(game, 'player-1', { q: 0, r: 0 }, 'battleship')).toEqual(['2,0'])
  })

  it('превью обстрела: стреляют только выбранные корабли, с поправкой на расстояние', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-idle')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'dd-2')

    const preview = buildBombardmentPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'cr-1', type: 'cruiser', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )!
    expect(preview.trigger).toBe('bombardment')
    expect(preview.attacker.ships).toEqual([])
    expect(preview.attacker.supportingShips).toEqual([
      expect.objectContaining({ shipId: 'cr-1', distance: 1, threshold: 6, dice: 2 }),
    ])
    expect(preview.attacker.diceTotal).toBe(2)
    expect(preview.defender.diceTotal).toBe(0)
    expect(preview.defender.ships).toHaveLength(1)
  })

  it('защитник не отвечает на обстрел', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    const preview = buildBombardmentPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'bb-1', type: 'battleship', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )!

    const round = rollCombatRound(preview, {}, {}, allSixes)
    expect(round.shipRolls.every((r) => r.side === 'attacker')).toBe(true)
    expect(round.defenderHits).toBe(0)
    expect(round.attackerHits).toBe(3)
    expect(round.destroyedShipIds).toEqual(['def-cr'])

    const result = resolveCombatAtCell(game, { q: 1, r: 0 }, 'player-1', [], {}, allSixes, preview)
    expect(result.attackerWon).toBe(false)
    expect(result.destroyedShipIds).toEqual(['def-cr'])
  })

  it('обстрел снимает маркер, корабли остаются на месте', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const result = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'cr-1', target: { q: 1, r: 0 } },
    ], {})
    expect(result.errors).toEqual([])
    expect(cellAt(game, 0, 0).ships).toHaveLength(1)
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
    expect(game.actionMarkers).toHaveLength(0)
  })

  it('цель вне дальности отклоняется', () => {
    const map = createEmptyMap('bombard-range', 'Range')
    map.cells.push({ q: 2, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    addShip(game, 0, 0, 'player-1', 'cruiser', 'cr-1')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const errors = validateMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'cr-1', target: { q: 2, r: 0 } },
    ])
    expect(errors.some((e) => /дальность/i.test(e))).toBe(true)
  })

  it('подготовка обстрела ждёт только атакующего', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const prepStart = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'bb-1', target: { q: 1, r: 0 } },
    ])
    expect(prepStart.errors).toEqual([])
    expect(game.pendingCombat?.trigger).toBe('bombardment')
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('prep')

    expect(updateCombatPrep(game, 'player-2', true).errors.length).toBeGreaterThan(0)
    expect(updateCombatPrep(game, 'player-1', true).errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.phase).toBe('countdown')
  })

  it('обстрел, уничтоживший всех, не даёт контроль над клеткой', () => {
    const { map, game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const result = withRandom(allSixes, () =>
      executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
        { shipId: 'bb-1', target: { q: 1, r: 0 } },
      ], {}),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.attackerWon).toBe(true)
    expect(cellAt(game, 1, 0).ships).toEqual([])
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-2')
    expect(cellAt(game, 0, 0).ships).toHaveLength(1)
  })

  it('очередь обстрела подхватывает следующую цель', () => {
    const { map, game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-1')
    addShip(game, 0, 0, 'player-1', 'battleship', 'bb-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-a')
    addShip(game, 2, 0, 'player-2', 'destroyer', 'def-b')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })

    const start = executeMarkerBombardment(game, map, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'bb-1', target: { q: 1, r: 0 } },
      { shipId: 'bb-2', target: { q: 2, r: 0 } },
    ])
    expect(start.errors).toEqual([])
    expect(game.pendingCombat?.cellKey).toBe('1,0')
    expect(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans).toEqual([
      { shipId: 'bb-2', target: { q: 2, r: 0 } },
    ])

    const queued = [...(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans ?? [])]
    const next = continueBombardmentQueueOrFinalize(
      game,
      'player-1',
      { q: 0, r: 0 },
      [{ shipId: 'bb-1', target: { q: 1, r: 0 } }],
      queued,
    )
    expect(next.errors).toEqual([])
    expect(game.pendingCombat?.cellKey).toBe('2,0')
    expect(combatPrepOf(game.pendingCombat)?.queuedBombardmentPlans ?? []).toEqual([])
    expect(pendingCombatInvariantViolations(game)).toEqual([])
  })
})

describe('pendingCombat FSM', () => {
  function combatOnCell(): GameSnapshot {
    const { game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    return game
  }

  it('корректный бой в каждой фазе проходит инвариант', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2)
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(pendingCombatInvariantViolations(game)).toEqual([])

    const prepGame = combatOnCell()
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

  it('клетка боя вне карты — нарушение', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.cellKey = '99,99'
    expect(pendingCombatInvariantViolations(game).join(' ')).toMatch(/отсутствует на карте/)
  })

  it('атакующего нет среди игроков — нарушение', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.attackerId = 'ghost'
    expect(pendingCombatInvariantViolations(game).join(' ')).toMatch(/отсутствует среди игроков/)
  })

  it('releaseInvalidPendingCombat снимает сломанный бой и пишет в журнал', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    game.pendingCombat!.attackerId = 'ghost'
    expect(releaseInvalidPendingCombat(game).length).toBeGreaterThan(0)
    expect(game.pendingCombat).toBeUndefined()
    expect(game.eventLog.at(-1)?.message).toMatch(/снят автоматически/)

    const valid = combatOnCell()
    setupPendingCombat(valid, { q: 1, r: 0 }, 'player-1', 1)
    expect(releaseInvalidPendingCombat(valid)).toEqual([])
    expect(valid.pendingCombat).toBeDefined()
  })

  it('прервать бой может только участник', () => {
    const game = combatOnCell()
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 1)
    expect(abortPendingCombat(game, 'player-3').errors[0]).toMatch(/только участник/)
    expect(abortPendingCombat(game, 'player-2').errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
    expect(game.eventLog.at(-1)?.message).toMatch(/прерван участником/)
  })

  it('abort-combat разблокирует зависший бой', () => {
    const { map, game } = duelBoard([{ q: 0, r: 1 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    setupPendingCombat(game, { q: 1, r: 0 }, 'player-1', 2)

    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'advance-phase').errors[0])
      .toMatch(/завершите или продолжите/)
    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'abort-combat').errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
  })

  it('снятая фаза выбора жертв и бой без фазы не восстанавливаются', () => {
    const base = { cellKey: '1,0', attackerId: 'player-1', defenderIds: ['player-2'], roundNumber: 1 }
    expect(migrateLegacyPendingCombat({ ...base, phase: 'awaiting-destruction', roundState: {} })).toBeUndefined()
    expect(migrateLegacyPendingCombat({ ...base, awaitingContinue: true })).toBeUndefined()
    expect(
      migrateLegacyPendingCombat({ ...base, phase: 'awaiting-continue', continueDecisions: {} })?.phase,
    ).toBe('awaiting-continue')

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
          ...base,
          phase: 'awaiting-continue',
          continueDecisions: {},
          damageByShipId: { 'att-bb': 2 },
        },
      },
    })
    expect(normalized.game?.pendingCombat?.phase).toBe('awaiting-continue')
    expect(normalized.game?.pendingCombat?.damageByShipId).toEqual({ 'att-bb': 2 })
  })

  it('сохранение после отступления: контроль защитника и корабли атакующего — легально', () => {
    const map = createEmptyMap('retreat-save', 'Retreat save')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    const battleCell = cellAt(game, 1, 0)
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

  it('isCombatDestination: пустая чужая клетка — не бой, любой вражеский корабль — бой', () => {
    const map = createEmptyMap('no-combat-empty', 'No combat')
    map.cells.push({ q: 1, r: 0 }, { q: 0, r: 1 })
    const game = gameSnapshotFromMap(map)
    cellAt(game, 1, 0).controlOwnerId = 'player-2'
    expect(isCombatDestination(game, 'player-1', { q: 1, r: 0 })).toBe(false)

    addShip(game, 0, 1, 'player-2', 'destroyer', 'dd-1')
    cellAt(game, 0, 1).controlOwnerId = 'player-2'
    expect(isCombatDestination(game, 'player-1', { q: 0, r: 1 })).toBe(true)
  })
})

describe('прочность гиперорудия', () => {
  it('в бою держит одно попадание, под обстрелом — два', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 2, 0, 'player-2', 'hyper', 'def-hy')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'

    const battle = buildCombatPreview(game, { q: 2, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(battle.defender.ships[0]?.hull).toBe(1)

    const bombardment = buildBombardmentPreview(
      game,
      { q: 2, r: 0 },
      'player-1',
      [{ id: 'att-bb', type: 'battleship', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )!
    expect(bombardment.defender.ships[0]?.hull).toBe(2)
  })
})

describe('прогноз боя', () => {
  /** Разыгрывает бой до конца так, как это делает движок: превью пересобирается каждый раунд. */
  function playBattleToEnd(
    game: GameSnapshot,
    coord: { q: number; r: number },
    attackerId: string,
    attackerCell: { q: number; r: number },
    rng: () => number,
  ): 'win' | 'draw' | 'defeat' {
    let damage: Record<string, number> = {}
    for (let round = 0; round < 64; round++) {
      const incoming = cellAt(game, attackerCell.q, attackerCell.r).ships.filter(
        (ship) => ship.ownerId === attackerId,
      )
      const preview = buildCombatPreview(game, coord, attackerId, incoming, { damageByShipId: damage })
      if (!preview) break
      const result = rollCombatRound(preview, damage, {}, rng)
      damage = result.damageByShipId
      removeShipsFromSnapshot(game, result.destroyedShipIds)
      const attackersAlive = cellAt(game, attackerCell.q, attackerCell.r).ships.some(
        (ship) => ship.ownerId === attackerId,
      )
      const defendersAlive = cellAt(game, coord.q, coord.r).ships.some((ship) => ship.ownerId !== attackerId)
      if (!defendersAlive && attackersAlive) return 'win'
      if (!attackersAlive && defendersAlive) return 'defeat'
      if (!attackersAlive && !defendersAlive) return 'draw'
      if (preview.attacker.diceTotal === 0 && preview.defender.diceTotal === 0) return 'draw'
    }
    return 'draw'
  }

  it('считает точно и даёт одно и то же число при каждом пересчёте', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr-1')
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr-2')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr-1')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr-2')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-cr-1', type: 'cruiser', ownerId: 'player-1' },
      { id: 'att-cr-2', type: 'cruiser', ownerId: 'player-1' },
    ])!

    const first = forecastBattle(preview)
    const second = forecastBattle(preview)
    expect(first.exact).toBe(true)
    expect(second.outcome).toEqual(first.outcome)
    expect(second.round).toEqual(first.round)
    expect(first.outcome.win + first.outcome.draw + first.outcome.defeat).toBeCloseTo(1, 10)
    // Равные флоты — симметричный исход.
    expect(first.outcome.win).toBeCloseTo(first.outcome.defeat, 10)
  })

  it('линкор против эсминца: победа без потерь считается точно', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    const forecast = forecastBattle(preview)
    expect(forecast.exact).toBe(true)
    // Эсминец ещё может трижды попасть, пока линкор промахивается, — но это доли процента.
    expect(forecast.outcome.win).toBeGreaterThan(0.999)
    expect(forecast.outcome.defeat).toBeLessThan(0.001)
    // Три кубика на 4+: хотя бы одно попадание — 1 − (1/2)³ = 7/8, прочность эсминца 1.
    expect(forecast.round.defenderLosses).toBeCloseTo(7 / 8, 10)
    expect(forecast.round.attackerLosses).toBe(0)
  })

  it('эсминец против эсминца: разбор вручную', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
    ])!
    const forecast = forecastBattle(preview)
    expect(forecast.round.defenderLosses).toBeCloseTo(1 / 6, 10)
    expect(forecast.round.attackerLosses).toBeCloseTo(1 / 6, 10)
    // За раунд: попали оба — 1/36, один из двух — 10/36, никто — 25/36. Промах обоих повторяет
    // раунд, поэтому исходы делятся как 5 : 1 : 5.
    expect(forecast.outcome.win).toBeCloseTo(5 / 11, 6)
    expect(forecast.outcome.draw).toBeCloseTo(1 / 11, 6)
    expect(forecast.outcome.defeat).toBeCloseTo(5 / 11, 6)
  })

  it('точный расчёт совпадает с живым боем, включая поддержку с соседней клетки', () => {
    const makeBoard = () => {
      const { game } = duelBoard([{ q: 2, r: 0 }])
      addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-1')
      addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-2')
      addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
      addShip(game, 2, 0, 'player-2', 'cruiser', 'sup-cr')
      cellAt(game, 2, 0).controlOwnerId = 'player-2'
      return game
    }
    const preview = buildCombatPreview(makeBoard(), { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd-1', type: 'destroyer', ownerId: 'player-1' },
      { id: 'att-dd-2', type: 'destroyer', ownerId: 'player-1' },
    ])!
    const forecast = forecastBattle(preview)
    expect(forecast.exact).toBe(true)

    let seed = 1
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const runs = 4000
    const tally = { win: 0, draw: 0, defeat: 0 }
    for (let i = 0; i < runs; i++) {
      tally[playBattleToEnd(makeBoard(), { q: 1, r: 0 }, 'player-1', { q: 0, r: 0 }, rng)] += 1
    }
    expect(tally.win / runs).toBeCloseTo(forecast.outcome.win, 1)
    expect(tally.defeat / runs).toBeCloseTo(forecast.outcome.defeat, 1)
    expect(tally.draw / runs).toBeCloseTo(forecast.outcome.draw, 1)
  })

  it('выбитый корабль больше не стреляет', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd-2')
    const preview = buildCombatPreview(
      game,
      { q: 1, r: 0 },
      'player-1',
      [{ id: 'att-dd', type: 'destroyer', ownerId: 'player-1' }],
      { damageByShipId: { 'def-dd-1': 1 } },
    )!
    // Первый эсминец защитника уже выбит: кубик у стороны остался один.
    expect(forecastRoundDamage(preview).defenderHits).toBeCloseTo(1 / 6, 10)
    expect(combatDiceReport(preview, 'defender').total).toBe(1)
  })

  it('большой флот честно помечается оценкой', () => {
    const { game } = duelBoard()
    const incoming: { id: string; type: ShipType; ownerId: string }[] = []
    for (let i = 0; i < 6; i++) {
      const attId = 'att-bb-' + i
      addShip(game, 0, 0, 'player-1', 'battleship', attId)
      incoming.push({ id: attId, type: 'battleship', ownerId: 'player-1' })
      addShip(game, 1, 0, 'player-2', 'battleship', 'def-bb-' + i)
    }
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', incoming)!
    const forecast = forecastBattle(preview, { samples: 200 })
    expect(forecast.exact).toBe(false)
    expect(forecast.samples).toBe(200)
    // Итог раунда остаётся точным и на большом флоте.
    expect(forecast.round.defenderLosses).toBeGreaterThan(0)
  })

  it('бой, в котором никто не может стрелять, — размен без вариантов', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'carrier', 'def-cv')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-cv', type: 'carrier', ownerId: 'player-1' },
    ])!
    const forecast = forecastBattle(preview)
    expect(forecast.outcome).toEqual({ win: 0, draw: 1, defeat: 0 })
    expect(forecast.exact).toBe(true)
  })
})

describe('состав сторон в прогнозе', () => {
  /**
   * Баг-репорт живого игрока: «два эсминца атакуют один, но поражение 68%, у меня 1 кубик, у него
   * 3». Три кубика у защитника — эсминец на клетке плюс крейсер поддержки с соседней. Один кубик у
   * атакующего получался потому, что прогноз строился из незавершённого черновика назначений:
   * второй эсминец в него ещё не попал, а в бой шли оба.
   */
  function twoDestroyersVersusSupportedDestroyer() {
    const { map, game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-1')
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-2')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-2', 'cruiser', 'sup-cr')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'
    return { map, game }
  }

  it('в прогноз по приказу идут все корабли приказа, а не часть', () => {
    const { game } = twoDestroyersVersusSupportedDestroyer()
    const moves = [
      { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
      { shipId: 'att-dd-2', to: { q: 1, r: 0 } },
    ]
    const preview = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, moves)!
    expect(preview.attacker.ships.map((s) => s.shipId)).toEqual(['att-dd-1', 'att-dd-2'])
    expect(preview.attacker.diceTotal).toBe(2)
    expect(preview.defender.diceTotal).toBe(3)

    const forecast = forecastBattle(preview)
    expect(forecast.exact).toBe(true)
    expect(forecast.outcome.defeat).toBeLessThan(0.4)
    expect(forecast.outcome.win).toBeGreaterThan(0.55)
  })

  it('прогноз одного эсминца и прогноз двух — разные числа', () => {
    const { game } = twoDestroyersVersusSupportedDestroyer()
    const one = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
    ])!
    const both = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
      { shipId: 'att-dd-2', to: { q: 1, r: 0 } },
    ])!
    expect(one.attacker.diceTotal).toBe(1)
    expect(both.attacker.diceTotal).toBe(2)
    // Ровно то поражение, которое видел игрок, когда в прогноз попадал один эсминец из двух.
    expect(forecastBattle(one).outcome.defeat).toBeCloseTo(0.68, 2)
    expect(forecastBattle(both).outcome.defeat).toBeLessThan(0.35)
  })

  it('корабль, пришедший в клетку маркера вторым действием, попадает в прогноз', () => {
    const { game } = twoDestroyersVersusSupportedDestroyer()
    // Два эсминца уже стояли в клетке с маркером, третий пришёл туда предыдущим действием —
    // в бой одним приказом уходят все три.
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd-3')
    const moves = cellAt(game, 0, 0).ships
      .filter((ship) => ship.ownerId === 'player-1')
      .map((ship) => ({ shipId: ship.id, to: { q: 1, r: 0 } }))
    const order = combatOrderFromMoves(game, 'player-1', { q: 0, r: 0 }, moves)!
    expect(order.incomingShips.map((s) => s.id)).toEqual(['att-dd-1', 'att-dd-2', 'att-dd-3'])
    const preview = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, moves)!
    expect(preview.attacker.diceTotal).toBe(3)
  })

  it('прогноз и бой собирают состав одним помощником — расхождения нет', () => {
    const { map, game } = twoDestroyersVersusSupportedDestroyer()
    const moves = [
      { shipId: 'att-dd-1', to: { q: 1, r: 0 } },
      { shipId: 'att-dd-2', to: { q: 1, r: 0 } },
    ]
    placeActionMarker(game, 'player-1', { q: 0, r: 0 })
    const before = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, moves)!
    expect(executeMarkerMovement(game, map, 'player-1', { q: 0, r: 0 }, moves).errors).toEqual([])
    const prep = buildCombatPreviewFromPending(game)!
    expect(prep.attacker.ships.map((s) => s.shipId)).toEqual(before.attacker.ships.map((s) => s.shipId))
    expect(prep.attacker.diceTotal).toBe(before.attacker.diceTotal)
    expect(prep.defender.diceTotal).toBe(before.defender.diceTotal)
  })

  it('мирный ход того же приказа учитывается в прогнозе как сделанный', () => {
    const map = createEmptyMap('order-support', 'Order support')
    map.cells.push({ q: 1, r: 0 })
    const game = gameSnapshotFromMap(map)
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    game.participatingPlayerIds = ['player-1', 'player-2']
    cellAt(game, 1, 0).controlOwnerId = 'player-2'
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')

    // Крейсер остаётся на (0,0) — это соседняя клетка, его два кубика идут поддержкой.
    const preview = buildCombatPreviewForMoves(game, 'player-1', { q: 0, r: 0 }, [
      { shipId: 'att-dd', to: { q: 1, r: 0 } },
      { shipId: 'att-cr', to: { q: 0, r: 0 } },
    ])!
    expect(preview.attacker.supportingShips.map((s) => s.shipId)).toEqual(['att-cr'])
    expect(preview.attacker.diceTotal).toBe(3)
  })
})

describe('расшифровка кубиков', () => {
  it('называет каждый корабль, откуда он стреляет и сколько даёт кубиков', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, 2, 0, 'player-2', 'cruiser', 'sup-cr')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-dd', type: 'destroyer', ownerId: 'player-1' },
    ])!

    const attacker = combatDiceReport(preview, 'attacker')
    expect(attacker.sources).toEqual([
      expect.objectContaining({ shipId: 'att-dd', type: 'destroyer', distance: 0, dice: 1, threshold: 6 }),
    ])
    expect(attacker.total).toBe(1)

    const defender = combatDiceReport(preview, 'defender')
    expect(defender.sources.map((s) => [s.shipId, s.distance, s.dice, s.threshold])).toEqual([
      ['def-dd', 0, 1, 6],
      ['sup-cr', 1, 2, 6],
    ])
    expect(defender.sources[1]?.fromCoord).toEqual({ q: 2, r: 0 })
    expect(defender.total).toBe(3)
    expect(defender.total).toBe(preview.defender.diceTotal)
  })

  it('прибавку авианосца видно в разбивке', () => {
    const { game } = duelBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 0, 0, 'player-1', 'carrier', 'att-cv')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-cr', type: 'cruiser', ownerId: 'player-1' },
      { id: 'att-cv', type: 'carrier', ownerId: 'player-1' },
    ])!
    const report = combatDiceReport(preview, 'attacker')
    expect(report.sources).toEqual([
      expect.objectContaining({ shipId: 'att-cr', dice: 4, bonusDice: 2 }),
    ])
    // Авианосец в бою есть, но кубиков не даёт — об этом надо сказать, иначе он «пропал».
    expect(report.silent).toEqual([
      expect.objectContaining({ shipId: 'att-cv', reason: 'no-weapon' }),
    ])
    expect(report.total).toBe(4)
  })

  it('защитник под обстрелом не отвечает — кубиков ноль', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 2, 0, 'player-2', 'destroyer', 'def-dd')
    cellAt(game, 2, 0).controlOwnerId = 'player-2'
    const preview = buildBombardmentPreview(
      game,
      { q: 2, r: 0 },
      'player-1',
      [{ id: 'att-bb', type: 'battleship', ownerId: 'player-1' }],
      { q: 0, r: 0 },
    )!
    expect(combatDiceReport(preview, 'defender').total).toBe(0)
    expect(combatDiceReport(preview, 'attacker').total).toBe(3)
  })
})

/**
 * Разбор баг-репортов Крапивы от 2026-09-28: «гиперорудие в 3 клетках от боя не пришло ко мне на
 * помощь» и «гиперорудие стреляет на 3 и через чёрные пространства, разве это правильно?».
 *
 * Правило: дальность выводится из точности (`6 − hit`), у гиперорудия hit = 3, значит предел —
 * ровно три клетки, и это задумано. Поля зрения в игре нет нигде — ни у поддержки, ни у обстрела,
 * — поэтому выстрел идёт и над клетками, которых на карте нет. Единственное, что сокращает
 * дальность, — поправка к броску: чужая «Оборона» на своей клетке отнимает у поддержки клетку,
 * и гиперорудие с третьей клетки в бой уже не попадает. Отсюда и впечатление «не пришло».
 */
describe('дальность поддержки гиперорудия', () => {
  /** Поддержка гиперорудия защитника с клетки `from` в бой на (1,0). */
  function hyperSupport(from: { q: number; r: number }, extraCells: { q: number; r: number }[] = []) {
    const { game } = duelBoard([from, ...extraCells])
    addShip(game, 0, 0, 'player-1', 'battleship', 'att-bb')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    addShip(game, from.q, from.r, 'player-2', 'hyper', 'def-hy')
    cellAt(game, from.q, from.r).controlOwnerId = 'player-2'
    return { game }
  }

  it('с трёх клеток поддерживает: нужна шестёрка — предел дальности', () => {
    const { game } = hyperSupport({ q: 4, r: 0 }, [{ q: 2, r: 0 }, { q: 3, r: 0 }])
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(preview.defender.supportingShips).toEqual([
      expect.objectContaining({ shipId: 'def-hy', distance: 3, dice: 3, threshold: 6 }),
    ])
  })

  it('с четырёх клеток не поддерживает: нужно семь', () => {
    const { game } = hyperSupport({ q: 5, r: 0 }, [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }])
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(preview.defender.supportingShips).toEqual([])
  })

  it('с соседней клетки не поддерживает: минимальная дальность — две клетки', () => {
    const { game } = hyperSupport({ q: 2, r: 0 })
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(preview.defender.supportingShips).toEqual([])
  })

  it('стреляет над клетками, которых нет на карте: поля зрения в игре нет', () => {
    // Между (1,0) и (4,0) карта пуста — ни одной клетки. Расстояние считается по прямой.
    const { game } = hyperSupport({ q: 4, r: 0 })
    expect(game.cells.some((cell) => cell.coord.q === 2 || cell.coord.q === 3)).toBe(false)
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', [
      { id: 'att-bb', type: 'battleship', ownerId: 'player-1' },
    ])!
    expect(preview.defender.supportingShips.map((ship) => ship.shipId)).toEqual(['def-hy'])
  })

  it('чужая «Оборона» на своей клетке отнимает у поддержки клетку дальности', () => {
    const { game } = duelBoard([{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }])
    addShip(game, 0, 0, 'player-1', 'destroyer', 'att-dd')
    addShip(game, 4, 0, 'player-1', 'hyper', 'att-hy')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'def-dd')
    cellAt(game, 4, 0).controlOwnerId = 'player-1'
    const attackerShips = [{ id: 'att-dd', type: 'destroyer' as const, ownerId: 'player-1' }]

    // Бой на клетке player-2 (её задаёт duelBoard), и у него «Оборона»: нужное значение
    // гиперорудию поднимается с шести до семи — выстрел невозможен.
    game.doctrineWindow = 3
    game.doctrineByPlayer = { 'player-2': { doctrineId: 'defense', fromTurn: 1 } }
    const underDefense = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', attackerShips)!
    expect(underDefense.attacker.supportingShips).toEqual([])

    // Та же доска без доктрины: гиперорудие с трёх клеток в бой попадает.
    delete game.doctrineByPlayer
    const plain = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', attackerShips)!
    expect(plain.attacker.supportingShips.map((ship) => ship.shipId)).toEqual(['att-hy'])
  })
})
