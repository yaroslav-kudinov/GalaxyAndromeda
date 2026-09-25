#!/usr/bin/env tsx
/**
 * «Было → стало» по двум каталогам замеров с одинаковыми именами (обычно два прогона
 * `suite.ts` с разными метками до и после правки):
 *
 *   pnpm balance:compare harness/balance/out/before harness/balance/out/after
 *   pnpm balance:compare <было> <стало> --json harness/balance/baselines/<имя>.json
 *
 * Печатает победы по уровням, поведение и экономику «было → стало». С `--json` пишет компактную
 * выжимку обоих прогонов (победы, поведение, экономика, почти победители) — её и стоит класть в
 * `baselines/`, а не полные сводки.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { BEHAVIOR_LABELS, type Summary } from './metrics.js'
import { REPO_ROOT } from './maps.js'
import { LEVELS, loadResults, num, parseFlags, pct, winCell, type ResultEntry } from './results.js'

const { flags, positional } = parseFlags(process.argv.slice(2))
const [beforeDir, afterDir] = positional
if (!beforeDir || !afterDir) {
  process.stderr.write('Нужны два каталога: pnpm balance:compare <было> <стало> [--json файл]\n')
  process.exit(1)
}
const before = loadResults(resolve(REPO_ROOT, beforeDir))
const after = loadResults(resolve(REPO_ROOT, afterDir))
const names = [...after.keys()].filter((name) => before.has(name))
const onlyAfter = [...after.keys()].filter((name) => !before.has(name))

const arrow = (a: string, b: string) => (a || b ? `${a || '—'} → ${b || '—'}` : '')
const lines: string[] = []

lines.push('## Победы по уровням: побед на место ×к справедливой доле · центров в среднем по ходу, было → стало')
lines.push('')
lines.push(`| замер | партий | ходов | ${LEVELS.join(' | ')} |`)
lines.push(`|---|---|---|${LEVELS.map(() => '---').join('|')}|`)
for (const name of names) {
  const a = before.get(name)!.summary
  const b = after.get(name)!.summary
  lines.push(
    `| ${name} | ${a.games} → ${b.games} | ${num(a.turns.mean)} → ${num(b.turns.mean)} | `
      + `${LEVELS.map((level) => arrow(winCell(a, level), winCell(b, level))).join(' | ')} |`,
  )
}

lines.push('')
lines.push('## Поведение по уровням, было → стало (на место за партию; открытые центры — за ход)')
lines.push('')
lines.push(`| замер | уровень | ${BEHAVIOR_LABELS.map(([, label]) => label).join(' | ')} |`)
lines.push(`|---|---|${BEHAVIOR_LABELS.map(() => '---').join('|')}|`)
for (const name of names) {
  for (const level of LEVELS) {
    const a = before.get(name)!.summary.behaviorByDifficulty?.[level]
    const b = after.get(name)!.summary.behaviorByDifficulty?.[level]
    if (!a && !b) continue
    lines.push(`| ${name} | ${level} | ${BEHAVIOR_LABELS.map(([key, , digits]) => arrow(a ? num(a[key], digits) : '', b ? num(b[key], digits) : '')).join(' | ')} |`)
  }
}

lines.push('')
lines.push('## Экономика по уровням, было → стало (среднее на место)')
lines.push('')
lines.push('| замер | уровень | клеток по ходу | регион в конце | центров ход 5 | кораблей построено | номинал за ход | бюджет 0 |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const name of names) {
  for (const level of LEVELS) {
    const a = before.get(name)!.summary.economyByDifficulty?.[level]
    const b = after.get(name)!.summary.economyByDifficulty?.[level]
    if (!a && !b) continue
    const cell = (pick: (e: NonNullable<typeof a>) => string) => arrow(a ? pick(a) : '', b ? pick(b) : '')
    lines.push(
      `| ${name} | ${level} | ${cell((e) => num(e.meanCells))} | ${cell((e) => num(e.largestRegionAtEnd))} `
        + `| ${cell((e) => num(e.powerCentersAtTurn5, 2))} | ${cell((e) => num(e.shipsBuiltPerGame))} `
        + `| ${cell((e) => num(e.tokensSpentPerTurn, 2))} | ${cell((e) => pct(e.budgetZeroShare))} |`,
    )
  }
}
if (onlyAfter.length) {
  lines.push('')
  lines.push(`Только в «стало»: ${onlyAfter.join(', ')}`)
}
process.stdout.write(`${lines.join('\n')}\n`)

const jsonOut = flags.get('json')
if (jsonOut) {
  const lite = (entry: ResultEntry | undefined) => {
    if (!entry) return null
    const s: Summary = entry.summary
    return {
      map: entry.mapId,
      games: s.games,
      seed: entry.seed,
      seating: entry.seating,
      turns: s.turns,
      errors: s.errors,
      bot: { errors: s.bot.errors, planRejects: s.bot.planRejects },
      winRateByDifficulty: s.winRateByDifficulty,
      behaviorByDifficulty: s.behaviorByDifficulty,
      economyByDifficulty: s.economyByDifficulty,
      nearWins: s.nearWins,
    }
  }
  const all = [...new Set([...before.keys(), ...after.keys()])]
  const payload = Object.fromEntries(all.map((name) => [name, { before: lite(before.get(name)), after: lite(after.get(name)) }]))
  const path = resolve(REPO_ROOT, jsonOut)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ before: beforeDir, after: afterDir, results: payload }, null, 2)}\n`, 'utf8')
  process.stdout.write(`\nЗаписано: ${path}\n`)
}
