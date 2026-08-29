import { describe, expect, it } from 'vitest'
import {
  buildEventDeckTemplate,
  createShuffledEventDeck,
  drawNextEventFromDeck,
  drawRandomEvent,
  ensureTurnEventForPhase,
  enforceOneProductionMarkerPerRegion,
  EVENT_DECK_COPIES,
  EVENT_DECK_SIZE,
  getEffectiveMoveRange,
  getEffectiveTokenValue,
  getEventCard,
  getTurnModifiers,
  getTurnEventHistory,
  isMovementIntoCellBlocked,
  migrateLegacyEventId,
  resolveTurnEvent,
  type EventCardId,
} from './events.js'
import {
  rollCombatRound,
  selectShipsToDestroy,
  getEffectiveDestroyCost,
  buildCombatPreview,
  getEffectiveFireRangeBounds,
} from './combat.js'
import { gameSnapshotFromMap, type GameSnapshot } from './save-file.js'
import { createEmptyMap } from './map.js'
import type { ShipUnit } from './types.js'
import { hexKey } from './types.js'

function gameWithEvent(eventId: EventCardId, resolved = true): GameSnapshot {
  const game = gameSnapshotFromMap(createEmptyMap())
  game.phase = resolved ? 'planning' : 'events'
  game.turnNumber = 2
  game.turnEvent = {
    eventId,
    turnNumber: 2,
    resolvedAt: resolved ? new Date().toISOString() : undefined,
  }
  return game
}

function setPlayerControl(game: GameSnapshot, playerId: string, coords: { q: number; r: number }[]): void {
  for (const coord of coords) {
    const cell = game.cells.find((c) => c.coord.q === coord.q && c.coord.r === coord.r)
    if (cell) cell.controlOwnerId = playerId
  }
}

describe('events', () => {
  it('getTurnEventHistory parses turn-event log entries', () => {
    const game = gameSnapshotFromMap(createEmptyMap())
    game.eventLog.push(
      {
        id: 'e1',
        turn: 1,
        phase: 'events',
        type: 'turn-event',
        message: 'Событие хода: «Магнитная буря» — Дальность хода −1 (мин. 1)',
        timestamp: 1000,
      },
      {
        id: 'e2',
        turn: 1,
        phase: 'events',
        type: 'turn-event',
        message: 'Применено: «Магнитная буря»',
        timestamp: 2000,
      },
      {
        id: 'e3',
        turn: 2,
        phase: 'events',
        type: 'turn-event',
        message: 'Событие хода: «Теневая экономика» — Номинал фишек +2',
        timestamp: 3000,
      },
    )
    const history = getTurnEventHistory(game)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      turn: 2,
      eventId: 'shadow-economy',
      applied: false,
      drawnAt: 3000,
    })
    expect(history[1]).toMatchObject({
      turn: 1,
      eventId: 'magnetic-storm',
      applied: true,
      drawnAt: 1000,
      appliedAt: 2000,
    })
  })

  it('event deck template uses weighted copies (harsh cards rarer)', () => {
    const template = buildEventDeckTemplate()
    expect(template).toHaveLength(EVENT_DECK_SIZE)
    expect(EVENT_DECK_SIZE).toBeGreaterThan(14)
    expect(EVENT_DECK_COPIES['empty-void']).toBe(3)
    expect(EVENT_DECK_COPIES['ammo-detonation']).toBe(1)
    expect(EVENT_DECK_COPIES['stand-to-death']).toBe(1)
    expect(template.filter((id) => id === 'empty-void')).toHaveLength(3)
    expect(template.filter((id) => id === 'ammo-detonation')).toHaveLength(1)
  })

  it('drawRandomEvent is deterministic with fixed rng over weighted template', () => {
    expect(drawRandomEvent(() => 0)).toBe('magnetic-storm')
    const template = buildEventDeckTemplate()
    expect(drawRandomEvent(() => 0.999999)).toBe(template[template.length - 1])
  })

  it('drawNextEventFromDeck reshuffles when empty', () => {
    const game = gameSnapshotFromMap(createEmptyMap())
    game.eventDeck = ['empty-void']
    expect(drawNextEventFromDeck(game, () => 0)).toBe('empty-void')
    expect(game.eventDeck).toHaveLength(0)
    const next = drawNextEventFromDeck(game, () => 0)
    expect(next).toBeTruthy()
    expect(game.eventDeck!.length).toBe(EVENT_DECK_SIZE - 1)
  })

  it('ensureTurnEventForPhase draws from deck once per turn', () => {
    const game = gameSnapshotFromMap(createEmptyMap())
    game.phase = 'events'
    game.turnNumber = 3
    game.eventDeck = createShuffledEventDeck(() => 0.25)
    const beforeLen = game.eventDeck.length
    ensureTurnEventForPhase(game, () => 0.5)
    const first = game.turnEvent?.eventId
    expect(game.eventDeck.length).toBe(beforeLen - 1)
    ensureTurnEventForPhase(game, () => 0)
    expect(game.turnEvent?.eventId).toBe(first)
    expect(game.eventDeck.length).toBe(beforeLen - 1)
  })

  it('migrateLegacyEventId maps removed flip events to empty-void', () => {
    expect(migrateLegacyEventId('saboteurs-activation')).toBe('empty-void')
    expect(migrateLegacyEventId('peoples-donation')).toBe('empty-void')
  })

  it('magnetic storm: destroyer move 3→2, min 1', () => {
    const game = gameWithEvent('magnetic-storm')
    expect(getEffectiveMoveRange(game, 'destroyer')).toBe(2)
    expect(getEffectiveMoveRange(game, 'battleship')).toBe(1)
  })

  it('hyper gap: +1 move and hyper fireRange becomes 2–4', () => {
    const game = gameWithEvent('hyper-gap')
    expect(getEffectiveMoveRange(game, 'destroyer')).toBe(4)
    expect(getTurnModifiers(game).hyperFireRange).toBe(4)
    expect(getEffectiveFireRangeBounds(game, 'hyper')).toEqual({ min: 2, max: 4 })
  })

  it('rollCombatRound can fix all d6 via override', () => {
    const game = gameWithEvent('empty-void')
    game.cells[0].ships = [
      { id: 'd1', type: 'destroyer', ownerId: 'player-1' },
      { id: 'd2', type: 'destroyer', ownerId: 'player-2' },
    ]
    game.cells[0].controlOwnerId = 'player-2'
    const preview = buildCombatPreview(game, { q: 0, r: 0 }, 'player-1', [
      { id: 'a1', type: 'destroyer', ownerId: 'player-1' },
    ])
    expect(preview).not.toBeNull()
    const round = rollCombatRound(preview!, () => 0.99, 3)
    for (const roll of round.shipRolls) {
      if (roll.combatRolls.length) {
        expect(roll.combatRolls.every((v) => v === 3)).toBe(true)
      }
    }
  })

  it('shadow economy: token value +2', () => {
    const game = gameWithEvent('shadow-economy')
    expect(getEffectiveTokenValue(game, 3)).toBe(5)
  })

  it('local self-defense: cannot enter power center hex', () => {
    const game = gameWithEvent('local-self-defense')
    const dest = game.cells[0]
    dest.isPowerCenter = true
    expect(isMovementIntoCellBlocked(game, dest, '1,0', '0,0')).toBe(true)
    expect(isMovementIntoCellBlocked(game, dest, '0,0', '0,0')).toBe(false)
  })

  it('local self-defense: cannot enter cell with resource token', () => {
    const game = gameWithEvent('local-self-defense')
    const dest = game.cells[0]
    dest.resourceTokens = [{ type: 'credits', value: 2, faceUp: true }]
    expect(isMovementIntoCellBlocked(game, dest, '1,0', hexKey(0, 0))).toBe(true)
  })

  it('combat chaos: destruction order ignores priority tiers', () => {
    const ships: ShipUnit[] = [
      { id: 'bb', type: 'battleship', ownerId: 'p1' },
      { id: 'dd', type: 'destroyer', ownerId: 'p1' },
    ]
    const destroyed = selectShipsToDestroy(ships, 20, new Set(), ['bb', 'dd'], {
      ignoreDestructionPriority: true,
      destroyCostForType: (t) => (t === 'battleship' ? 9 : 3),
    })
    expect(destroyed[0]).toBe('bb')
  })

  it('hold formation: destroyCost +2', () => {
    const game = gameWithEvent('hold-formation')
    expect(getEffectiveDestroyCost(game, 'destroyer')).toBe(6)
  })

  it('production accident blocks extra marker purchases', () => {
    const game = gameWithEvent('production-accident')
    expect(getTurnModifiers(game).cannotBuyExtraMarkers).toBe(true)
    expect(getTurnModifiers(game).cannotBuildShipTypes).toEqual([])
  })

  it('ammo detonation blocks combat ships only', () => {
    const game = gameWithEvent('ammo-detonation')
    const blocked = getTurnModifiers(game).cannotBuildShipTypes
    expect(blocked).toContain('destroyer')
    expect(blocked).not.toContain('shield')
  })

  it('all for front limits production tokens to 3', () => {
    const game = gameWithEvent('all-for-front')
    expect(getTurnModifiers(game).maxProductionTokensPerPlayer).toBe(3)
  })

  it('mandatory-overtime limits to one production marker per owner region', () => {
    const game = gameWithEvent('mandatory-overtime')
    expect(getTurnModifiers(game).oneProductionMarkerPerRegion).toBe(true)
    const card = getEventCard('mandatory-overtime')
    expect(card.name).toBe('Нормирование производства')
    expect(card.description).toContain('Не больше одного маркера производства на регион')
  })

  it('mandatory-overtime strips extra production markers, keeping lowest id', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 2, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])
    game.productionMarkers = [
      {
        id: 'prod-b',
        ownerId: 'player-1',
        coord: { q: 1, r: 0 },
        targetRegionId: 'region-player-1-0,0',
      },
      {
        id: 'prod-a',
        ownerId: 'player-1',
        coord: { q: 0, r: 0 },
        targetRegionId: 'region-player-1-0,0',
      },
      {
        id: 'prod-c',
        ownerId: 'player-1',
        coord: { q: 2, r: 0 },
        targetRegionId: 'region-player-1-0,0',
      },
    ]
    const cellA = game.cells.find((c) => c.coord.q === 0 && c.coord.r === 0)!
    const cellB = game.cells.find((c) => c.coord.q === 1 && c.coord.r === 0)!
    const cellC = game.cells.find((c) => c.coord.q === 2 && c.coord.r === 0)!
    cellA.productionMarkerId = 'prod-a'
    cellB.productionMarkerId = 'prod-b'
    cellC.productionMarkerId = 'prod-c'
    game.productionMarkerResolvedThisTurn = false

    const messages = enforceOneProductionMarkerPerRegion(game)
    expect(messages.length).toBeGreaterThan(0)
    expect(game.productionMarkers.map((m) => m.id)).toEqual(['prod-a'])
    expect(cellA.productionMarkerId).toBe('prod-a')
    expect(cellB.productionMarkerId).toBeNull()
    expect(cellC.productionMarkerId).toBeNull()
    expect(game.productionMarkerResolvedThisTurn).toBeFalsy()
  })

  it('resolveTurnEvent applies mandatory-overtime by stripping extras', () => {
    const map = createEmptyMap()
    map.cells.push({ q: 1, r: 0, startPlayer: 1 }, { q: 2, r: 0, startPlayer: 1 })
    const game = gameSnapshotFromMap(map)
    setPlayerControl(game, 'player-1', [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ])
    game.phase = 'events'
    game.turnNumber = 1
    game.turnEvent = { eventId: 'mandatory-overtime', turnNumber: 1 }
    game.productionMarkers = [
      {
        id: 'prod-z',
        ownerId: 'player-1',
        coord: { q: 0, r: 0 },
        targetRegionId: 'stale',
      },
      {
        id: 'prod-m',
        ownerId: 'player-1',
        coord: { q: 1, r: 0 },
        targetRegionId: 'stale',
      },
    ]
    game.cells[0]!.productionMarkerId = 'prod-z'
    game.cells[1]!.productionMarkerId = 'prod-m'

    expect(resolveTurnEvent(game)).toEqual([])
    expect(game.productionMarkers.map((m) => m.id)).toEqual(['prod-m'])
    expect(game.turnEvent?.resolvedAt).toBeTruthy()
  })

  it('smoke: each event id produces modifiers or is no-op', () => {
    const ids: EventCardId[] = [
      'magnetic-storm',
      'empty-void',
      'stand-to-death',
      'production-accident',
      'ammo-detonation',
      'mandatory-overtime',
      'hyper-gap',
      'all-for-front',
      'shadow-economy',
      'hold-formation',
      'combat-chaos',
      'local-self-defense',
    ]
    for (const id of ids) {
      const game = gameWithEvent(id)
      expect(() => getTurnModifiers(game)).not.toThrow()
    }
  })
})
