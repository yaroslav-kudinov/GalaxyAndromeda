import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  greedyBotStep,
  setBotErrorListener,
  tryPlaceMarker,
  type BotDifficulty,
  type MarkerAttempts,
} from './greedy-bot.js'
import { analyzeSituation, BOT_PROFILES, cellGoalValue, economicValue, isCalmPowerCenter } from './bot-strategy.js'
import { beginMatchForParticipants } from './match-start.js'
import { applyGameActionOnSnapshot } from './movement.js'
import { createEmptyMap } from './map.js'
import { addActionMarker } from './markers.js'
import { normalizeMapDefinition } from './map-editor.js'
import { gameSnapshotFromMap, type GameSnapshot } from './save-file.js'
import type { ShipType } from './types.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function bundled(name: string) {
  const map = normalizeMapDefinition(JSON.parse(readFileSync(resolve(root, `maps/bundled/${name}.json`), 'utf8')))
  const game = gameSnapshotFromMap(map)
  const seats = game.players
    .filter((player) => game.cells.some((cell) => cell.controlOwnerId === player.id))
    .map((player) => player.id)
  beginMatchForParticipants(game, map.id, seats)
  return { map, game, seats }
}

/** Детерминированный `Math.random` на время партии: тест не должен зависеть от удачи. */
function withSeed<T>(seed: number, fn: () => T): T {
  let state = seed >>> 0
  const original = Math.random
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

/** Партия одних ботов до конца — так же, как их водит сервер лобби. */
function playOut(name: string, levels: readonly BotDifficulty[], seed: number) {
  return withSeed(seed, () => {
    const { map, game, seats } = bundled(name)
    const difficultyByPlayer = Object.fromEntries(seats.map((seat, index) => [seat, levels[index % levels.length]!]))
    const attempts: MarkerAttempts = new Map()
    const errors: string[] = []
    setBotErrorListener((error, where) => errors.push(`${where}: ${error instanceof Error ? error.message : String(error)}`))
    try {
      let stuck = 0
      for (let step = 0; step < 40_000 && !game.gameOver; step += 1) {
        const before = JSON.stringify([game.turnNumber, game.phase, game.activePlayerId, game.actionMarkers.length, game.pendingCombat?.phase])
        greedyBotStep(game, map, new Set(seats), attempts, { difficultyByPlayer })
        const after = JSON.stringify([game.turnNumber, game.phase, game.activePlayerId, game.actionMarkers.length, game.pendingCombat?.phase])
        stuck = before === after ? stuck + 1 : 0
        // Сервер снимает зависший бой одних ботов; здесь то же самое.
        if (stuck > 300 && game.pendingCombat) {
          applyGameActionOnSnapshot(game, map, game.pendingCombat.attackerId, 'abort-combat')
          stuck = 0
        }
      }
    } finally {
      setBotErrorListener(null)
    }
    return { game, errors }
  })
}

describe('уровни ботов: партия целиком', () => {
  it.each([
    ['duel', ['medium'] as BotDifficulty[]],
    ['duel', ['hard'] as BotDifficulty[]],
    ['trio-start', ['easy', 'medium', 'hard'] as BotDifficulty[]],
  ])('%s, уровни %j: партия доходит до конца, оценка не расходится с правилами', (name, levels) => {
    const { game, errors } = playOut(name, levels, 7)
    expect(game.gameOver).toBeTruthy()
    expect(errors).toEqual([])
  })
})

function cellAt(game: GameSnapshot, q: number, r: number) {
  const cell = game.cells.find((c) => c.coord.q === q && c.coord.r === r)
  if (!cell) throw new Error(`cell ${q},${r} missing`)
  return cell
}

function addShip(game: GameSnapshot, q: number, r: number, ownerId: string, type: ShipType, id: string) {
  cellAt(game, q, r).ships.push({ id, type, ownerId })
}

/** Полоса клеток (0..14, 0) и (0..14, 1): своих — две клетки слева, дальше нейтраль. */
function stripBoard() {
  const map = createEmptyMap('strip', 'Strip')
  map.cells = []
  for (let q = 0; q <= 14; q += 1) map.cells.push({ q, r: 0 }, { q, r: 1 })
  const game = gameSnapshotFromMap(map)
  game.participatingPlayerIds = ['player-1', 'player-2']
  game.turnNumber = 1
  game.victoryPowerCenters = 6
  const home = cellAt(game, 0, 0)
  home.isPowerCenter = true
  home.controlOwnerId = 'player-1'
  cellAt(game, 0, 1).controlOwnerId = 'player-1'
  const rival = cellAt(game, 14, 1)
  rival.isPowerCenter = true
  rival.controlOwnerId = 'player-2'
  addShip(game, 0, 0, 'player-1', 'destroyer', 'p1-d1')
  addShip(game, 14, 1, 'player-2', 'destroyer', 'p2-d1')
  for (const [q, r] of [[1, 0], [6, 0]] as const) {
    cellAt(game, q, r).resourceTokens = [{ type: 'credits', value: 3 }]
  }
  return { map, game }
}

describe('уровни ботов: экономика', () => {
  it('клетка, которая растит свой регион до постройки, дороже одиночной клетки вдали', () => {
    const { game } = stripBoard()
    const situation = analyzeSituation(game, 'player-1', BOT_PROFILES.medium)
    expect(situation.modes.develop).toBeGreaterThan(0.5)
    // (1,0) касается своего региона из двух клеток и делает его регионом постройки.
    expect(economicValue(situation, '1,0', 3)).toBeGreaterThan(economicValue(situation, '6,0', 3) + 10)
    expect(cellGoalValue(situation, '1,0')).toBeGreaterThan(cellGoalValue(situation, '6,0'))
  })

  it('неоспариваемый центр в режиме развития ценится ниже оспариваемого', () => {
    const { game } = stripBoard()
    cellAt(game, 3, 0).isPowerCenter = true
    const calm = analyzeSituation(game, 'player-1', BOT_PROFILES.medium)
    expect(isCalmPowerCenter(calm, '3,0')).toBe(true)
    const calmValue = cellGoalValue(calm, '3,0')

    // Корабль соперника рядом: центр надо брать сейчас, иначе его займут.
    addShip(game, 5, 0, 'player-2', 'destroyer', 'p2-d2')
    const contested = analyzeSituation(game, 'player-1', BOT_PROFILES.medium)
    expect(isCalmPowerCenter(contested, '3,0')).toBe(false)
    expect(cellGoalValue(contested, '3,0')).toBeGreaterThan(calmValue)
  })

  it('без экономического развития центр не откладывается', () => {
    const { game } = stripBoard()
    cellAt(game, 3, 0).isPowerCenter = true
    const profile = { ...BOT_PROFILES.medium, economy: 0 }
    const situation = analyzeSituation(game, 'player-1', profile)
    expect(situation.modes.develop).toBe(0)
    expect(isCalmPowerCenter(situation, '3,0')).toBe(false)
  })
})

describe('уровни ботов: осада', () => {
  it('осаждающий ставит свой маркер на клетку, где уже стоит маркер гарнизона, и штурмует', () => {
    const map = createEmptyMap('siege', 'Siege')
    map.cells.push({ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 1, r: 1 })
    const game = gameSnapshotFromMap(map)
    game.participatingPlayerIds = ['player-1', 'player-2']
    game.turnNumber = 4
    game.victoryPowerCenters = 6
    const home = cellAt(game, 0, 0)
    home.isPowerCenter = true
    home.controlOwnerId = 'player-1'
    const target = cellAt(game, 1, 0)
    target.isPowerCenter = true
    target.controlOwnerId = 'player-2'
    const spare = cellAt(game, 2, 0)
    spare.isPowerCenter = true
    spare.controlOwnerId = 'player-2'
    for (let i = 0; i < 3; i += 1) addShip(game, 1, 0, 'player-1', 'battleship', `att-${i}`)
    addShip(game, 1, 0, 'player-2', 'destroyer', 'gar-1')
    addShip(game, 1, 0, 'player-2', 'destroyer', 'gar-2')
    game.sieges = { '1,0': { besiegerId: 'player-1', besiegedId: 'player-2', sinceTurn: 3 } }
    game.phase = 'planning'
    game.activePlayerId = 'player-2'
    expect(addActionMarker(game, 'player-2', { q: 1, r: 0 })).toEqual([])
    game.activePlayerId = 'player-1'

    expect(tryPlaceMarker(game, map, 'player-1', 'medium')).toBe(true)
    const mine = game.actionMarkers.filter((marker) => marker.ownerId === 'player-1')
    expect(mine.map((marker) => marker.coord)).toContainEqual({ q: 1, r: 0 })
  })
})
