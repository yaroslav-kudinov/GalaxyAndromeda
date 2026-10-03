import { describe, expect, it } from 'vitest'
import { createEmptyMap } from './map.js'
import { beginMatchForParticipants, DEFAULT_TURN_LIMIT, TUTORIAL_TURN_LIMIT } from './match-start.js'
import { gameSnapshotFromMap } from './save-file.js'
import { advanceGameSnapshot, beginTurnPlanning, isMatchStalled } from './turn.js'
import { finishStalledMatch, isTurnLimitReached } from './victory.js'
import type { MapDefinition } from './types.js'

/** Карта без центров власти: выбывание по центрам не вмешивается в проверку тупика. */
function corridor(): MapDefinition {
  const map = createEmptyMap('stalled', 'Тупик')
  map.cells = [
    { q: 0, r: 0, startPlayer: 1 },
    { q: 1, r: 0 },
    { q: 2, r: 0, startPlayer: 2 },
  ]
  return map
}

/** Партия, в которой у игроков есть корабли и контроль — обычный ход. */
function livingMatch() {
  const map = corridor()
  const game = gameSnapshotFromMap(map)
  for (const cell of game.cells) {
    if (cell.controlOwnerId) {
      cell.ships.push({
        id: `dd-${cell.coord.q}`,
        type: 'destroyer',
        ownerId: cell.controlOwnerId,
      })
    }
  }
  game.participatingPlayerIds = ['player-1', 'player-2']
  return { map, game }
}

/** Всё снято с карты: ни кораблей, ни контроля — играть некому и нечем. */
function emptyBoardMatch() {
  const { map, game } = livingMatch()
  for (const cell of game.cells) {
    cell.ships = []
    cell.controlOwnerId = null
  }
  return { map, game }
}

describe('партия, в которой играть некому', () => {
  it('обычный ход тупиком не считается', () => {
    const { map, game } = livingMatch()
    expect(isMatchStalled(game, map.id)).toBe(false)
  })

  it('без кораблей и контроля у всех оставшихся — тупик', () => {
    const { map, game } = emptyBoardMatch()
    expect(isMatchStalled(game, map.id)).toBe(true)
  })

  it('пока хоть у кого-то остался корабль — не тупик', () => {
    const { map, game } = emptyBoardMatch()
    game.cells[0]!.ships.push({ id: 'dd-1', type: 'destroyer', ownerId: 'player-1' })
    expect(isMatchStalled(game, map.id)).toBe(false)
  })

  it('начало хода закрывает такую партию, а не растит счётчик ходов', () => {
    const { map, game } = emptyBoardMatch()
    beginTurnPlanning(game, map.id)
    expect(game.gameOver?.reason).toBe('stalemate')
    // Ни у кого нет ни флота, ни контроля: победителя выбирать не из кого.
    expect(game.gameOver?.winnerId).toBeNull()
  })

  it('оставшийся контроль решает тупик в пользу владельца', () => {
    const { map, game } = emptyBoardMatch()
    // Контроль над клеткой без центра власти маркер поставить не даёт: ход всё равно пустой,
    // но при дележе партии такой игрок ведёт по клеткам.
    game.cells[1]!.controlOwnerId = 'player-2'
    expect(isMatchStalled(game, map.id)).toBe(true)
    expect(finishStalledMatch(game, map.id)).toEqual({ winnerId: 'player-2', reason: 'stalemate' })
  })

  it('передача хода из пустой фазы действий завершает партию', () => {
    const { map, game } = emptyBoardMatch()
    game.phase = 'actions'
    game.activePlayerId = 'player-1'
    expect(advanceGameSnapshot(game, map.id)).toEqual([])
    expect(game.gameOver?.reason).toBe('stalemate')
    expect(game.turnNumber).toBeLessThanOrEqual(2)
  })

  it('завершённую партию повторная проверка не переписывает', () => {
    const { map, game } = emptyBoardMatch()
    game.gameOver = { winnerId: 'player-1', reason: 'last_standing' }
    expect(isMatchStalled(game, map.id)).toBe(false)
    expect(finishStalledMatch(game, map.id)).toEqual({ winnerId: 'player-1', reason: 'last_standing' })
  })
})

describe('предел ходов учебной партии', () => {
  it('учебной партии задаётся предел, а не бесконечность', () => {
    const map = corridor()
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'], {
      turnLimit: TUTORIAL_TURN_LIMIT,
      matchSeed: null,
      doctrineWindow: null,
    })
    expect(game.turnLimit).toBe(TUTORIAL_TURN_LIMIT)
    expect(TUTORIAL_TURN_LIMIT).toBeGreaterThan(DEFAULT_TURN_LIMIT)

    game.turnNumber = TUTORIAL_TURN_LIMIT
    expect(isTurnLimitReached(game)).toBe(false)
    game.turnNumber = TUTORIAL_TURN_LIMIT + 1
    expect(isTurnLimitReached(game)).toBe(true)
  })

  it('без предела счётчик ходов не останавливается ничем', () => {
    const map = corridor()
    const game = gameSnapshotFromMap(map)
    beginMatchForParticipants(game, map.id, ['player-1', 'player-2'], { turnLimit: null })
    expect(game.turnLimit).toBeUndefined()
    game.turnNumber = 10_000
    expect(isTurnLimitReached(game)).toBe(false)
  })
})
