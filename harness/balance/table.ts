#!/usr/bin/env tsx
/**
 * Сводные таблицы по каталогу замеров (или одному файлу `run.ts --out`):
 *
 *   pnpm balance:table harness/balance/out/before
 *   pnpm balance:table harness/balance/out/before --sections wins,behavior
 *
 * Разделы: `wins` (победы по уровням), `behavior` (набеги, штурмы, отбитые и открытые центры),
 * `near` (остановлен ли почти победитель), `economy` (экономика по уровням).
 */

import { resolve } from 'node:path'

import { REPO_ROOT } from './maps.js'
import { loadResults, parseFlags, parseSections, renderTables } from './results.js'

const { flags, positional } = parseFlags(process.argv.slice(2))
const dir = positional[0]
if (!dir) {
  process.stderr.write('Нужен каталог замеров: pnpm balance:table <каталог> [--sections wins,behavior,near,economy]\n')
  process.exit(1)
}
const entries = [...loadResults(resolve(REPO_ROOT, dir)).values()]
process.stdout.write(`${renderTables(entries, parseSections(flags.get('sections')))}\n`)
