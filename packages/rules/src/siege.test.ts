import { describe, expect, it } from 'vitest'
import { gameSnapshotFromMap, type GameSnapshot } from './save-file.js'
import { createEmptyMap } from './map.js'
import type { ShipType } from './types.js'
import {
  buildCombatPreview,
  combatPrepOf,
  rollCombatRound,
  collectSupportShips,
  isBombardmentDestination,
  buildCombatPreviewFromPending,
} from './combat.js'
import { applyGameActionOnSnapshot, getLegalActionsForSnapshot } from './movement.js'
import { addActionMarker } from './markers.js'
import { autoDiceTargetsFor } from './combat-targets.js'
import { applySiegeTick, siegeAt, siegeLossesOwedBy } from './siege.js'
import { getBuildableShipsForMarker } from './production.js'
import { applyTurnEndClaims } from './claim.js'
import { advanceGameSnapshot } from './turn.js'
import { applyVictoryAndDefeatChecks } from './victory.js'

function cellAt(game: GameSnapshot, q: number, r: number) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error(`cell ${q},${r} missing`)
  return cell
}

function addShip(game: GameSnapshot, q: number, r: number, ownerId: string, type: ShipType, id: string) {
  cellAt(game, q, r).ships.push({ id, type, ownerId })
}

function placeMarker(game: GameSnapshot, ownerId: string, q: number, r: number) {
  const phase = game.phase
  const active = game.activePlayerId
  game.phase = 'planning'
  game.activePlayerId = ownerId
  expect(addActionMarker(game, ownerId, { q, r })).toEqual([])
  game.phase = phase
  game.activePlayerId = active
}

function withRandom<T>(value: number, fn: () => T): T {
  const original = Math.random
  Math.random = () => value
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

/**
 * Линия клеток: (0,0) — центр власти атакующего, (1,0) — центр власти защитника,
 * (2,0) и (1,1) — пустые соседи, (3,0) — клетка третьего игрока.
 */
function siegeBoard() {
  const map = createEmptyMap('siege', 'Siege')
  map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 1, r: 1 }, { q: 3, r: 0 })
  const game = gameSnapshotFromMap(map)
  game.players.push({ id: 'player-3', name: 'Игрок 3', color: '#22c55e', isAi: false, eliminated: false })
  game.participatingPlayerIds = ['player-1', 'player-2', 'player-3']
  game.phase = 'actions'
  game.activePlayerId = 'player-1'
  game.turnNumber = 3
  const home = cellAt(game, 0, 0)
  home.isPowerCenter = true
  home.controlOwnerId = 'player-1'
  const target = cellAt(game, 1, 0)
  target.isPowerCenter = true
  target.controlOwnerId = 'player-2'
  // Второй центр защитника, чтобы потеря одного не выбивала его из игры.
  const spare = cellAt(game, 1, 1)
  spare.isPowerCenter = true
  spare.controlOwnerId = 'player-2'
  const third = cellAt(game, 3, 0)
  third.isPowerCenter = true
  third.controlOwnerId = 'player-3'
  return { map, game }
}

function besiege(garrison: ShipType[]) {
  const { map, game } = siegeBoard()
  addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr1')
  addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr2')
  garrison.forEach((type, i) => addShip(game, 1, 0, 'player-2', type, `gar-${i}`))
  placeMarker(game, 'player-1', 0, 0)

  const start = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
    from: { q: 0, r: 0 },
    moves: [
      { shipId: 'att-cr1', to: { q: 1, r: 0 } },
      { shipId: 'att-cr2', to: { q: 1, r: 0 } },
    ],
  })
  expect(start.errors).toEqual([])
  return { map, game }
}

describe('осада: установка', () => {
  it('вход на защищённый чужой центр власти предлагает осаду вместо штурма', () => {
    const { game } = besiege(['destroyer'])
    const prep = combatPrepOf(game.pendingCombat)
    expect(prep?.siegeAvailable).toBe(true)
    expect(getLegalActionsForSnapshot(game, 'siege', 'player-1').map((a) => a.id)).toContain('establish-siege')
  })

  it('осада: корабли входят без боя, маркер исполнен, осаждённого спрашивают о вылазке', () => {
    const { map, game } = besiege(['destroyer', 'destroyer'])
    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege').errors).toEqual([])

    const cell = cellAt(game, 1, 0)
    expect(cell.ships.filter((s) => s.ownerId === 'player-1')).toHaveLength(2)
    expect(cell.ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(2)
    expect(cell.controlOwnerId).toBe('player-2')
    expect(siegeAt(game, { q: 1, r: 0 })).toEqual({ besiegerId: 'player-1', besiegedId: 'player-2', sinceTurn: 3 })
    expect(game.actionMarkers.filter((m) => m.ownerId === 'player-1')).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)

    const response = combatPrepOf(game.pendingCombat)
    expect(game.pendingCombat?.attackerId).toBe('player-2')
    expect(response?.siegeResponse).toBe(true)
    expect(getLegalActionsForSnapshot(game, 'siege', 'player-2').map((a) => a.id)).toContain('cancel-combat-prep')

    // Осаждённый отказывается — осада стоит, боя нет.
    expect(applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep').errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
    expect(siegeAt(game, { q: 1, r: 0 })).toBeDefined()
    expect(game.eventLog.at(-1)?.message).toMatch(/не стал нападать/)
  })

  it('незащищённый чужой центр переходит при входе, как обычная клетка', () => {
    const { map, game } = siegeBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr1')
    placeMarker(game, 'player-1', 0, 0)
    const move = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: 0 },
      moves: [{ shipId: 'att-cr1', to: { q: 1, r: 0 } }],
    })
    expect(move.errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
  })

  it('центр, взятый набегом, приносит победу только в начале хода — до этого его можно отбить', () => {
    const { map, game } = siegeBoard()
    game.victoryPowerCenters = 2
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr1')
    placeMarker(game, 'player-1', 0, 0)
    applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: 0 },
      moves: [{ shipId: 'att-cr1', to: { q: 1, r: 0 } }],
    })
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
    expect(game.gameOver).toBeUndefined()

    game.phase = 'planning'
    applyVictoryAndDefeatChecks(game, map.id)
    expect(game.gameOver?.winnerId).toBe('player-1')
  })

  it('нейтральный центр при входе не переходит — его занимают захватом в начале хода', () => {
    const { map, game } = siegeBoard()
    cellAt(game, 1, 0).controlOwnerId = null
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr1')
    placeMarker(game, 'player-1', 0, 0)
    applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: 0 },
      moves: [{ shipId: 'att-cr1', to: { q: 1, r: 0 } }],
    })
    expect(cellAt(game, 1, 0).controlOwnerId).toBeNull()

    applyTurnEndClaims(game, map.id)
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
  })

  it('осаждающий подводит подкрепление без боя', () => {
    const { map, game } = besiege(['destroyer'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')

    game.actionMarkerResolvedThisTurn = false
    addShip(game, 0, 0, 'player-1', 'destroyer', 'reinforce')
    placeMarker(game, 'player-1', 0, 0)
    const move = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: 0 },
      moves: [{ shipId: 'reinforce', to: { q: 1, r: 0 } }],
    })
    expect(move.errors).toEqual([])
    expect(game.pendingCombat).toBeUndefined()
    expect(cellAt(game, 1, 0).ships.map((s) => s.id)).toContain('reinforce')
  })
})

describe('осада: тик', () => {
  function establishedSiege(garrison: ShipType[]) {
    const { map, game } = besiege(garrison)
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    if (game.pendingCombat) applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')
    game.turnNumber += 1
    game.phase = 'planning'
    return { map, game }
  }

  it('в ход установки тика нет', () => {
    const { map, game } = besiege(['destroyer', 'destroyer'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applySiegeTick(game)
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(2)
  })

  it('однородный гарнизон теряет корабль сразу, без выбора', () => {
    const { game } = establishedSiege(['destroyer', 'destroyer'])
    applySiegeTick(game)
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(1)
    expect(siegeLossesOwedBy(game, 'player-2')).toEqual([])
    // Повторный вызов в том же ходу ничего не делает.
    applySiegeTick(game)
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(1)
  })

  it('смешанный гарнизон: осаждённый выбирает, какой корабль потерять', () => {
    const { map, game } = establishedSiege(['destroyer', 'cruiser'])
    game.activePlayerId = 'player-2'
    applySiegeTick(game)
    expect(siegeLossesOwedBy(game, 'player-2')).toEqual(['1,0'])
    expect(getLegalActionsForSnapshot(game, 'siege', 'player-2').map((a) => a.id)).toContain('execute-siege-losses')

    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'execute-siege-losses', { shipIds: ['att-cr1'] }).errors[0],
    ).toMatch(/гарнизона/)
    expect(
      applyGameActionOnSnapshot(game, map, 'player-2', 'execute-siege-losses', { shipIds: ['gar-1'] }).errors,
    ).toEqual([])
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2').map((s) => s.id)).toEqual(['gar-0'])
    expect(siegeLossesOwedBy(game, 'player-2')).toEqual([])
  })

  it('без выбора погибает самый дешёвый корабль', () => {
    const { map, game } = establishedSiege(['cruiser', 'destroyer'])
    game.activePlayerId = 'player-2'
    applySiegeTick(game)
    expect(applyGameActionOnSnapshot(game, map, 'player-2', 'execute-siege-losses').errors).toEqual([])
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2').map((s) => s.type)).toEqual(['cruiser'])
  })

  it('последний корабль гарнизона гибнет — центр переходит осаждающему', () => {
    const { game } = establishedSiege(['destroyer'])
    applySiegeTick(game)
    const cell = cellAt(game, 1, 0)
    expect(cell.ships.every((s) => s.ownerId === 'player-1')).toBe(true)
    expect(cell.controlOwnerId).toBe('player-1')
    expect(siegeAt(game, { q: 1, r: 0 })).toBeUndefined()
  })
})

describe('осада: цикл хода', () => {
  it('тик срабатывает сам в начале следующего хода, до расчёта перезарядки', () => {
    const { map, game } = besiege(['destroyer', 'destroyer'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')
    game.actionMarkers = []
    for (const cell of game.cells) cell.actionMarkerId = null

    const turn = game.turnNumber
    for (let guard = 0; guard < 12 && !(game.phase === 'planning' && game.turnNumber > turn); guard++) {
      expect(advanceGameSnapshot(game, map.id)).toEqual([])
    }
    expect(game.turnNumber).toBe(turn + 1)
    expect(game.phase).toBe('planning')
    expect(cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2')).toHaveLength(1)
    expect(game.siegeTickTurn).toBe(turn + 1)
  })
})

describe('осада: действия сторон', () => {
  function establishedSiege(garrison: ShipType[]) {
    const { map, game } = besiege(garrison)
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')
    game.actionMarkerResolvedThisTurn = false
    return { map, game }
  }

  it('отступить можно только всем гарнизоном — центр теряется сразу', () => {
    const { map, game } = establishedSiege(['destroyer', 'destroyer'])
    game.activePlayerId = 'player-2'
    placeMarker(game, 'player-2', 1, 0)

    const partial = applyGameActionOnSnapshot(game, map, 'player-2', 'execute-marker-movement', {
      from: { q: 1, r: 0 },
      moves: [{ shipId: 'gar-0', to: { q: 2, r: 0 } }],
    })
    expect(partial.errors).toContain('Из осады можно только отступить всем гарнизоном')

    const full = applyGameActionOnSnapshot(game, map, 'player-2', 'execute-marker-movement', {
      from: { q: 1, r: 0 },
      moves: [
        { shipId: 'gar-0', to: { q: 2, r: 0 } },
        { shipId: 'gar-1', to: { q: 2, r: 0 } },
      ],
    })
    expect(full.errors).toEqual([])
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
    expect(siegeAt(game, { q: 1, r: 0 })).toBeUndefined()
    expect(cellAt(game, 2, 0).ships.map((s) => s.id).sort()).toEqual(['gar-0', 'gar-1'])
  })

  it('вылазка: маркер на своей клетке начинает бой с осаждающими', () => {
    const { map, game } = establishedSiege(['battleship'])
    game.activePlayerId = 'player-2'
    placeMarker(game, 'player-2', 1, 0)

    const start = applyGameActionOnSnapshot(game, map, 'player-2', 'execute-marker-assault', {
      from: { q: 1, r: 0 },
    })
    expect(start.errors).toEqual([])
    expect(game.pendingCombat?.phase).toBe('prep')
    expect(game.pendingCombat?.attackerId).toBe('player-2')
    expect(combatPrepOf(game.pendingCombat)?.assaultFrom).toEqual({ q: 1, r: 0 })
  })

  it('штурм осады: маркер гарнизона не мешает осаждающему поставить свой и начать бой', () => {
    const { map, game } = establishedSiege(['battleship'])
    placeMarker(game, 'player-2', 1, 0)
    placeMarker(game, 'player-1', 1, 0)
    expect(game.actionMarkers.filter((m) => m.coord.q === 1 && m.coord.r === 0)).toHaveLength(2)

    game.activePlayerId = 'player-1'
    const start = applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-assault', {
      from: { q: 1, r: 0 },
    })
    expect(start.errors).toEqual([])
    expect(game.pendingCombat?.attackerId).toBe('player-1')
    expect(combatPrepOf(game.pendingCombat)?.assaultFrom).toEqual({ q: 1, r: 0 })
  })

  it('исход штурма осады: гарнизон выбит — центр переходит осаждающему, осада снята', () => {
    const { map, game } = establishedSiege(['destroyer'])
    placeMarker(game, 'player-1', 1, 0)
    game.activePlayerId = 'player-1'

    const result = withRandom(0.99, () =>
      applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-assault', {
        from: { q: 1, r: 0 },
        combatOptions: {},
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.destroyedShipIds).toContain('gar-0')
    expect(cellAt(game, 1, 0).ships.every((s) => s.ownerId === 'player-1')).toBe(true)
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-1')
    expect(siegeAt(game, { q: 1, r: 0 })).toBeUndefined()
    expect(game.actionMarkers.filter((m) => m.ownerId === 'player-1')).toEqual([])
  })

  it('подкрепление владельца снимает осаду вместе с гарнизоном; перебросов крепости нет', () => {
    const { map, game } = establishedSiege(['cruiser'])
    addShip(game, 1, 1, 'player-2', 'cruiser', 'relief')
    placeMarker(game, 'player-2', 1, 1)
    game.activePlayerId = 'player-2'

    const start = applyGameActionOnSnapshot(game, map, 'player-2', 'execute-marker-movement', {
      from: { q: 1, r: 1 },
      moves: [{ shipId: 'relief', to: { q: 1, r: 0 } }],
    })
    expect(start.errors).toEqual([])
    expect(game.pendingCombat?.attackerId).toBe('player-2')
    const preview = buildCombatPreviewFromPending(game)!
    expect(preview.attacker.ships.map((s) => s.shipId).sort()).toEqual(['gar-0', 'relief'])
    expect(preview.siegeRerolls).toBeUndefined()
    expect(preview.attacker.rerollPool).toBeUndefined()
  })

  it('два маркера на осаждённой клетке: игрок снимает только свой, второй не ставит', () => {
    const { map, game } = establishedSiege(['battleship'])
    placeMarker(game, 'player-2', 1, 0)
    placeMarker(game, 'player-1', 1, 0)
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    expect(addActionMarker(game, 'player-1', { q: 1, r: 0 })).toEqual([
      'На клетке уже есть ваш маркер действия',
    ])

    expect(applyGameActionOnSnapshot(game, map, 'player-1', 'toggle-marker', {
      coord: { q: 1, r: 0 },
      kind: 'action',
    }).errors).toEqual([])
    const left = game.actionMarkers.filter((m) => m.coord.q === 1 && m.coord.r === 0)
    expect(left.map((m) => m.ownerId)).toEqual(['player-2'])
    expect(cellAt(game, 1, 0).actionMarkerId).toBe(left[0]!.id)
  })

  it('на клетке без чужих кораблей второй маркер по-прежнему не ставится', () => {
    const { game } = siegeBoard()
    // Пустой центр второго игрока с его маркером; на клетку вошёл крейсер первого.
    placeMarker(game, 'player-2', 1, 1)
    addShip(game, 1, 1, 'player-1', 'cruiser', 'p1-cr')
    game.phase = 'planning'
    game.activePlayerId = 'player-1'
    expect(addActionMarker(game, 'player-1', { q: 1, r: 1 })).toEqual([
      'На клетке уже есть маркер действия',
    ])
  })

  it('исход вылазки: линкор гарнизона выбивает крейсер, маркер потрачен, бой ждёт решения', () => {
    const { map, game } = establishedSiege(['battleship'])
    game.activePlayerId = 'player-2'
    placeMarker(game, 'player-2', 1, 0)

    // Гарнизон: 6,6,6 — все три кубика сосредоточены на первом крейсере. Осаждающие мажут.
    const values = [6, 6, 6, 1, 1, 1, 1]
    const original = Math.random
    Math.random = () => ((values.shift() ?? 1) - 1) / 6 + 0.01
    let result
    try {
      result = applyGameActionOnSnapshot(game, map, 'player-2', 'execute-marker-assault', {
        from: { q: 1, r: 0 },
        combatOptions: {},
      })
    } finally {
      Math.random = original
    }
    expect(result.errors).toEqual([])
    expect(result.combatResult?.destroyedShipIds).toEqual(['att-cr1'])
    expect(game.actionMarkers.filter((m) => m.ownerId === 'player-2')).toEqual([])
    expect(game.actionMarkerResolvedThisTurn).toBe(true)
    expect(game.pendingCombat?.phase).toBe('awaiting-continue')
    expect(game.pendingCombat?.damageByShipId).toEqual({})
    expect(siegeAt(game, { q: 1, r: 0 })?.besiegerId).toBe('player-1')
  })

  function withDice<T>(values: number[], fn: () => T): T {
    const queue = [...values]
    const original = Math.random
    Math.random = () => ((queue.shift() ?? 1) - 1) / 6 + 0.01
    try {
      return fn()
    } finally {
      Math.random = original
    }
  }

  it('осаждённый не строит в осаждённой клетке', () => {
    const { map, game } = establishedSiege(['destroyer'])
    game.activePlayerId = 'player-2'
    placeMarker(game, 'player-2', 1, 0)
    const marker = game.actionMarkers.find((m) => m.ownerId === 'player-2')!
    const options = getBuildableShipsForMarker(game, map.id, 'player-2', marker.id)
    expect(options.every((o) => o.disabledReason === 'Клетка в осаде: строить здесь нельзя')).toBe(true)
  })

  it('в осаждённую клетку не стреляют, из неё не поддерживают', () => {
    const { game } = establishedSiege(['cruiser'])
    expect(isBombardmentDestination(game, 'player-3', { q: 1, r: 0 })).toBe(false)
    // Крейсер гарнизона рядом с клеткой (2,0) не поддерживает бой на ней.
    expect(collectSupportShips(game, { q: 2, r: 0 }, 'player-2').map((s) => s.shipId)).not.toContain('gar-0')
  })

  it('крепость: гарнизон, которого штурмуют, перебрасывает все промахи — не больше двух проходов', () => {
    const { game } = establishedSiege(['cruiser', 'cruiser', 'cruiser'])
    const besiegers = cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-1')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-1', besiegers)!
    expect(preview.defenderId).toBe('player-2')
    expect(preview.defender.rerollPool).toBe(2)
    expect(preview.attacker.rerollPool).toBeUndefined()
    expect(preview.siegeRerolls?.pool).toBe(2)

    // Осаждающие 1,1,1,1; гарнизон 1×6; проход 1: 1,1,1,1,1,6; проход 2: 6,6,1,1,1 — и всё.
    const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6, 1, 1, 1, 6, 6, 6]
    const round = rollCombatRound(preview, {}, {}, () => ((values.shift() ?? 1) - 1) / 6 + 0.01)
    const garrisonDice = round.shipRolls.filter((r) => r.side === 'defender').flatMap((r) => r.dice)
    expect(garrisonDice).toHaveLength(6)
    expect(garrisonDice.every((d) => d.rerolls?.length)).toBe(true)
    expect(garrisonDice.filter((d) => d.hit)).toHaveLength(3)
    // Третьего прохода нет: три последние шестёрки остались неброшенными.
    expect(values).toEqual([6, 6, 6])
  })

  it('крепость: в вылазке гарнизон промахи не перебрасывает', () => {
    const { game } = establishedSiege(['cruiser', 'cruiser'])
    const garrison = cellAt(game, 1, 0).ships.filter((s) => s.ownerId === 'player-2')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-2', garrison)!
    expect(preview.siegeRerolls).toBeUndefined()
    expect(preview.attacker.rerollPool).toBeUndefined()
    expect(preview.defender.rerollPool).toBeUndefined()
  })
})

describe('осада: третий игрок', () => {
  it('вошедший в осаждённую клетку бьётся с осаждающим и продолжает осаду', () => {
    const { map, game } = besiege(['battleship'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')

    addShip(game, 2, 0, 'player-3', 'battleship', 'third-bb1')
    addShip(game, 2, 0, 'player-3', 'battleship', 'third-bb2')
    const preview = buildCombatPreview(game, { q: 1, r: 0 }, 'player-3', [
      { id: 'third-bb1', type: 'battleship', ownerId: 'player-3' },
      { id: 'third-bb2', type: 'battleship', ownerId: 'player-3' },
    ])!
    expect(preview.defenderId).toBe('player-1')
    expect(preview.defender.ships.every((s) => s.ownerId === 'player-1')).toBe(true)

    game.activePlayerId = 'player-3'
    game.actionMarkerResolvedThisTurn = false
    placeMarker(game, 'player-3', 2, 0)
    const result = withRandom(5 / 6, () =>
      applyGameActionOnSnapshot(game, map, 'player-3', 'execute-marker-movement', {
        from: { q: 2, r: 0 },
        moves: [
          { shipId: 'third-bb1', to: { q: 1, r: 0 } },
          { shipId: 'third-bb2', to: { q: 1, r: 0 } },
        ],
        combatOptions: {},
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.combatResult?.attackerWon).toBe(true)
    expect(siegeAt(game, { q: 1, r: 0 })?.besiegerId).toBe('player-3')
    expect(cellAt(game, 1, 0).controlOwnerId).toBe('player-2')
    // Победитель решает судьбу осады; пока не решил, партия ждёт.
    expect(game.siegeContinuationChoice).toEqual({ cellKey: '1,0', playerId: 'player-3' })
  })

  function thirdPartyWon() {
    const { map, game } = besiege(['battleship'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')
    addShip(game, 2, 0, 'player-3', 'battleship', 'third-bb1')
    addShip(game, 2, 0, 'player-3', 'battleship', 'third-bb2')
    game.activePlayerId = 'player-3'
    game.actionMarkerResolvedThisTurn = false
    placeMarker(game, 'player-3', 2, 0)
    withRandom(5 / 6, () =>
      applyGameActionOnSnapshot(game, map, 'player-3', 'execute-marker-movement', {
        from: { q: 2, r: 0 },
        moves: [
          { shipId: 'third-bb1', to: { q: 1, r: 0 } },
          { shipId: 'third-bb2', to: { q: 1, r: 0 } },
        ],
        combatOptions: {},
      }),
    )
    return { map, game }
  }

  it('победитель продолжает осаду — гарнизон снова спрашивают о вылазке', () => {
    const { map, game } = thirdPartyWon()
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'advance-phase').errors[0]).toMatch(/осаду/)
    expect(applyGameActionOnSnapshot(game, map, 'player-2', 'resolve-siege-continuation', { continue: true }).errors[0])
      .toMatch(/победитель/)
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'resolve-siege-continuation', { continue: true }).errors)
      .toEqual([])
    expect(game.siegeContinuationChoice).toBeUndefined()
    expect(siegeAt(game, { q: 1, r: 0 })).toEqual({ besiegerId: 'player-3', besiegedId: 'player-2', sinceTurn: game.turnNumber })
    expect(game.pendingCombat?.attackerId).toBe('player-2')
    expect(combatPrepOf(game.pendingCombat)?.siegeResponse).toBe(true)
  })

  it('сдавшийся победитель судьбу осады не решает — партия его не ждёт', () => {
    const { map, game } = thirdPartyWon()
    expect(game.siegeContinuationChoice?.playerId).toBe('player-3')
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'surrender').errors).toEqual([])
    expect(game.siegeContinuationChoice).toBeUndefined()
  })

  it('победитель отходит на соседнюю клетку — осада снята', () => {
    const { map, game } = thirdPartyWon()
    const survivors = cellAt(game, 1, 0).ships.filter((ship) => ship.ownerId === 'player-3').map((ship) => ship.id).sort()
    expect(survivors.length).toBeGreaterThan(0)
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'resolve-siege-continuation', {
      continue: false,
      retreatTo: { q: 3, r: 0 },
    }).errors[0]).toMatch(/соседнюю/)
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'resolve-siege-continuation', {
      continue: false,
      retreatTo: { q: 2, r: 0 },
    }).errors).toEqual([])
    expect(siegeAt(game, { q: 1, r: 0 })).toBeUndefined()
    expect(cellAt(game, 2, 0).ships.map((ship) => ship.id).sort()).toEqual(survivors)
    expect(cellAt(game, 1, 0).ships.every((ship) => ship.ownerId === 'player-2')).toBe(true)
  })

  it('гарнизон выбирает сторону в бою третьего игрока с осаждающим и бьётся на клетке', () => {
    const { map, game } = besiege(['battleship'])
    applyGameActionOnSnapshot(game, map, 'player-1', 'establish-siege')
    applyGameActionOnSnapshot(game, map, 'player-2', 'cancel-combat-prep')
    addShip(game, 2, 0, 'player-3', 'battleship', 'third-bb1')
    game.activePlayerId = 'player-3'
    game.actionMarkerResolvedThisTurn = false
    placeMarker(game, 'player-3', 2, 0)
    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'execute-marker-movement', {
      from: { q: 2, r: 0 },
      moves: [{ shipId: 'third-bb1', to: { q: 1, r: 0 } }],
    }).errors).toEqual([])

    const before = buildCombatPreviewFromPending(game)!
    const garrison = before.supportCandidates?.find((candidate) => candidate.playerId === 'player-2')
    expect(garrison?.garrisonShipIds).toEqual(['gar-0'])
    expect(before.attacker.ships.map((ship) => ship.shipId)).toEqual(['third-bb1'])

    expect(applyGameActionOnSnapshot(game, map, 'player-2', 'update-combat-prep', {
      ready: true,
      supportSide: 'attacker',
    }).errors).toEqual([])
    const after = buildCombatPreviewFromPending(game)!
    expect(after.attacker.ships.map((ship) => ship.shipId).sort()).toEqual(['gar-0', 'third-bb1'])
    // Гарнизон вмешался в чужой бой сам — бонуса крепости нет.
    expect(after.siegeRerolls).toBeUndefined()
  })
})

describe('поддержка третьего игрока', () => {
  it('выбрал сторону, потом «Готов» с целями — готовность принимается, цели сохраняются', () => {
    const { map, game } = siegeBoard()
    addShip(game, 0, 0, 'player-1', 'cruiser', 'att-cr')
    addShip(game, 1, 0, 'player-2', 'cruiser', 'def-cr')
    addShip(game, 2, 0, 'player-3', 'cruiser', 'sup-cr')
    placeMarker(game, 'player-1', 0, 0)
    applyGameActionOnSnapshot(game, map, 'player-1', 'execute-marker-movement', {
      from: { q: 0, r: 0 },
      moves: [{ shipId: 'att-cr', to: { q: 1, r: 0 } }],
    })
    expect(game.pendingCombat?.phase).toBe('prep')

    expect(applyGameActionOnSnapshot(game, map, 'player-3', 'update-combat-prep', {
      ready: false,
      supportSide: 'attacker',
    }).errors).toEqual([])
    const withSide = buildCombatPreviewFromPending(game)!
    const diceTargets = autoDiceTargetsFor(withSide, 'player-3', {})
    expect(Object.keys(diceTargets)).toEqual(['sup-cr'])

    const ready = applyGameActionOnSnapshot(game, map, 'player-3', 'update-combat-prep', {
      ready: true,
      diceTargets,
    })
    expect(ready.errors).toEqual([])
    expect(combatPrepOf(game.pendingCombat)?.readyBy['player-3']).toBe(true)
  })
})
