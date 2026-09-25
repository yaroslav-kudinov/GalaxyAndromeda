#!/usr/bin/env tsx
/**
 * Разбор одной партии: объяснения решений среднего и высокого уровня (`setBotTraceListener`) и
 * снимок каждого места в конце каждого хода.
 *
 *   pnpm balance:trace --map maltese-cross-4 --solo hard --game 3
 *   pnpm balance:trace --map duel --mix player-1=hard,player-2=medium --who player-1
 *
 * Раскладка мест — те же флаги, что у `run.ts` (`--difficulty`, `--mix`, `--solo`, `--h2h`).
 * `--seed` и `--game` выбирают ту же партию, что `run.ts --seed S` сыграл бы под номером
 * `game` (с нуля): сид партии — `mixSeed(seed + game, карта)`. `--who` — строки одного места.
 * `--botTune` — подбор профиля, как у `run.ts`.
 */

import { setBotTraceListener } from '../../packages/rules/src/index.js'
import { DEFAULT_RUN_OPTIONS, runGame, seatIdsOf } from './bot.js'
import { loadMap } from './maps.js'
import { parseFlags } from './results.js'
import { mixSeed } from './rng.js'
import { parseSeating, seatDifficultyFor } from './seating.js'
import { applyBotTuning } from './tuning.js'

const { flags } = parseFlags(process.argv.slice(2))
const map = loadMap(flags.get('map') || 'duel')
const seed = Number(flags.get('seed') || 1)
const gameIndex = Number(flags.get('game') || 0)
const who = flags.get('who') || ''
applyBotTuning(flags.get('botTune'))

const seatDifficulty = seatDifficultyFor(parseSeating(flags), seatIdsOf(map), gameIndex)
console.log(`${map.id}, партия ${gameIndex}, сид ${seed}: ${Object.entries(seatDifficulty).map(([seat, level]) => `${seat}=${level}`).join(', ')}`)
setBotTraceListener((playerId, text) => {
  if (!who || who === playerId) console.log(`${playerId}: ${text}`)
})
try {
  const record = runGame(map, mixSeed(seed + gameIndex, map.id), { ...DEFAULT_RUN_OPTIONS, seatDifficulty })
  for (const sample of record.samples) {
    console.log(
      `ход ${sample.turn}: `
        + Object.entries(sample.byPlayer)
          .map(([id, p]) => `${id} центров ${p.powerCenters} клеток ${p.cells} кораблей ${p.ships} денег ${p.faceUpValue} регион ${p.largestRegion} бюджет ${p.rechargeBudget}`)
          .join(' | '),
    )
  }
  for (const [id, counters] of Object.entries(record.behavior ?? {})) {
    console.log(`${id} (${seatDifficulty[id]}): ${JSON.stringify(counters)}`)
  }
  console.log(`победитель ${record.winnerId ?? '—'} (${record.reason ?? 'нет'}), ходов ${record.turns}, боёв ${record.battles.length}${record.error ? `, ошибка: ${record.error}` : ''}`)
} finally {
  setBotTraceListener(null)
}
