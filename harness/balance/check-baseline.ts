#!/usr/bin/env tsx
/**
 * Повторяет замер из файла `run.ts --out` с теми же сидом, числом партий, настройками и
 * раскладкой мест и сверяет итог: длину партии, победы по местам, исходы, бои, осады, ошибки.
 *
 *   pnpm balance:check harness/balance/baselines/before-bot-difficulty.json
 *   pnpm balance:check <файл> --map reference-duel --games 20
 *
 * Зачем: лёгкий бот — эталон для замеров баланса правил. Пока правила не менялись, правка
 * среднего и сложного уровня не должна сдвинуть ни одного числа в прогоне «все лёгкие»; если
 * сдвинула — задет общий код бота. После правки правил расхождение ожидаемо: тогда это просто
 * «было → стало» по ключевым полям. `--games` сокращает прогон (сверяются первые N партий —
 * числа тогда сравнимы только между собой, не с файлом).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DEFAULT_RUN_OPTIONS, runGame, seatIdsOf, type RunOptions } from './bot.js'
import { loadMap, REPO_ROOT } from './maps.js'
import { summarize, type Summary } from './metrics.js'
import { parseFlags } from './results.js'
import { mixSeed } from './rng.js'
import { seatDifficultyFor, type SeatingPlan } from './seating.js'

const { flags, positional } = parseFlags(process.argv.slice(2))
const file = positional[0]
if (!file) {
  process.stderr.write('Нужен файл замера: pnpm balance:check <файл.json> [--map карта] [--games N]\n')
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(resolve(REPO_ROOT, file), 'utf8')) as {
  seed: number
  games: number
  options: Partial<RunOptions>
  seating?: SeatingPlan
  summaries: Record<string, Summary>
}
const seating: SeatingPlan = baseline.seating
  ?? { kind: 'all', base: 'easy', mix: {}, rotate: false, levels: [], solo: null }
const games = Math.min(baseline.games, Number(flags.get('games')) || baseline.games)
const onlyMap = flags.get('map')

const key = (s: Summary) => ({
  turns: s.turns.mean.toFixed(3),
  seats: JSON.stringify(Object.fromEntries(Object.entries(s.winRateBySeat).sort())),
  reasons: JSON.stringify(Object.fromEntries(Object.entries(s.victoryReasons).sort())),
  battles: s.battles.perGame.toFixed(3),
  sieges: s.sieges.perGame.toFixed(3),
  errors: s.errors,
})

let same = true
for (const [mapId, recorded] of Object.entries(baseline.summaries)) {
  if (onlyMap && onlyMap !== mapId) continue
  const map = loadMap(mapId)
  const seats = seatIdsOf(map)
  const options: RunOptions = { ...DEFAULT_RUN_OPTIONS, ...baseline.options } as RunOptions
  const records = Array.from({ length: games }, (_, index) =>
    runGame(map, mixSeed(baseline.seed + index, map.id), { ...options, seatDifficulty: seatDifficultyFor(seating, seats, index) }))
  const now = key(summarize(records))
  const before = key(recorded)
  const equal = games === baseline.games && JSON.stringify(now) === JSON.stringify(before)
  same &&= equal
  console.log(`${mapId}: ${equal ? 'совпадает' : 'РАСХОДИТСЯ'} | ходов ${now.turns} (в файле ${before.turns}), боёв ${now.battles} (${before.battles}), осад ${now.sieges} (${before.sieges}), ошибок ${now.errors} (${before.errors})`)
  if (!equal) {
    console.log(`  победы по местам: ${now.seats} (в файле ${before.seats})`)
    console.log(`  исходы: ${now.reasons} (в файле ${before.reasons})`)
  }
}
console.log(same ? 'Все карты совпадают с файлом.' : 'Есть расхождения.')
process.exitCode = same ? 0 : 1
