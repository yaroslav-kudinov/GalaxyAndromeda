#!/usr/bin/env tsx
/**
 * Замер скорости бота лобби: сколько занимает один вызов `planGreedyBotAction`.
 *
 *   pnpm balance:timing --map six-point-path --games 3
 *   pnpm balance:timing --map six-point-path --games 3 --difficulty hard
 *
 * Партия идёт так же, как в лобби сервера: на каждом шаге бот планирует одно действие на копии
 * состояния, действие применяется, и так до конца партии. Если ботам делать нечего, шаг
 * выручается как на сервере (снять бой одних ботов или передать ход). Без `--difficulty`
 * замеряются все три уровня по очереди, все места — одного уровня.
 */

import { performance } from 'node:perf_hooks'

import {
  applyGameActionOnSnapshot,
  beginMatchForParticipants,
  BOT_DIFFICULTIES,
  gameSnapshotFromMap,
  isBotDifficulty,
  planGreedyBotAction,
  type BotDifficulty,
  type MarkerAttempts,
} from '../../packages/rules/src/index.js'
import { seatIdsOf } from './bot.js'
import { loadMap } from './maps.js'
import { mixSeed, withSeededRandom } from './rng.js'

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] ?? fallback : fallback
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

interface TimingResult {
  calls: number
  median: number
  p95: number
  p99: number
  max: number
  finished: number
  turns: number[]
}

function measure(mapName: string, games: number, seed: number, difficulty: BotDifficulty): TimingResult {
  const map = loadMap(mapName)
  const seats = seatIdsOf(map)
  const options = { difficultyByPlayer: Object.fromEntries(seats.map((seat) => [seat, difficulty])) }
  const times: number[] = []
  const turns: number[] = []
  let finished = 0
  for (let g = 0; g < games; g += 1) {
    withSeededRandom(mixSeed(seed + g, map.id), () => {
      const game = gameSnapshotFromMap(map)
      beginMatchForParticipants(game, map.id, seats)
      const bots = new Set(seats)
      const attempts: MarkerAttempts = new Map()
      let turn = game.turnNumber
      // Как на сервере: номер хода сменился — счётчики попыток маркеров обнуляются.
      for (let step = 0; step < 40_000 && !game.gameOver; step += 1) {
        if (game.turnNumber !== turn) {
          turn = game.turnNumber
          attempts.clear()
        }
        const started = performance.now()
        const planned = planGreedyBotAction(game, map, bots, attempts, options)
        times.push(performance.now() - started)
        if (!planned) {
          if (game.pendingCombat) applyGameActionOnSnapshot(game, map, game.pendingCombat.attackerId, 'abort-combat')
          else if (game.activePlayerId) applyGameActionOnSnapshot(game, map, game.activePlayerId, 'advance-phase')
          continue
        }
        applyGameActionOnSnapshot(game, map, planned.playerId, planned.actionId, planned.params)
      }
      if (game.gameOver) finished += 1
      turns.push(game.turnNumber)
    })
  }
  times.sort((a, b) => a - b)
  return {
    calls: times.length,
    median: quantile(times, 0.5),
    p95: quantile(times, 0.95),
    p99: quantile(times, 0.99),
    max: times.at(-1) ?? 0,
    finished,
    turns,
  }
}

function main(): void {
  const mapName = flag('map', 'six-point-path')
  const games = Math.max(1, Number(flag('games', '3')))
  const seed = Number(flag('seed', '1'))
  const raw = flag('difficulty', '')
  const levels = raw ? [raw] : [...BOT_DIFFICULTIES]
  const lines = [
    `# Скорость planGreedyBotAction: ${mapName}, партий на уровень ${games}`,
    '',
    '| Уровень | Вызовов | Медиана, мс | p95, мс | p99, мс | Максимум, мс | Партий доиграно |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const level of levels) {
    if (!isBotDifficulty(level)) throw new Error(`Неизвестный уровень: ${level}`)
    const result = measure(mapName, games, seed, level)
    lines.push(
      `| ${level} | ${result.calls} | ${result.median.toFixed(2)} | ${result.p95.toFixed(2)} | `
        + `${result.p99.toFixed(2)} | ${result.max.toFixed(2)} | ${result.finished} из ${games} |`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

main()
