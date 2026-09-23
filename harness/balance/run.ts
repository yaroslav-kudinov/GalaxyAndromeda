#!/usr/bin/env tsx
/**
 * Прогон партий для замера баланса.
 *
 *   pnpm balance --map duel --games 200
 *   pnpm balance --map duel,maltese-cross-4 --games 100 --out harness/balance/baselines
 *
 * Пишет JSON со сводкой и печатает её человекочитаемо. Базовые замеры снимаются до любой
 * правки правил: без них все последующие числа — угадайка.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeMapDefinition } from '../../packages/rules/src/index.js'
import type { MapDefinition } from '../../packages/rules/src/index.js'
import { DEFAULT_RUN_OPTIONS, runGame } from './bot.js'
import type { RunOptions } from './bot.js'
import { summarize } from './metrics.js'
import type { GameRecord, Summary } from './metrics.js'
import { mixSeed } from './rng.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')

interface Args {
  maps: string[]
  games: number
  seed: number
  options: RunOptions
  out: string | null
  label: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq > 0) flags.set(token.slice(2, eq), token.slice(eq + 1))
    else flags.set(token.slice(2), argv[i + 1] ?? '')
  }

  const number = (key: string, fallback: number): number => {
    const raw = flags.get(key)
    const value = raw == null ? Number.NaN : Number(raw)
    return Number.isFinite(value) ? value : fallback
  }

  return {
    maps: (flags.get('map') ?? 'duel').split(',').map((s) => s.trim()).filter(Boolean),
    games: Math.max(1, Math.floor(number('games', 50))),
    seed: Math.floor(number('seed', 1)),
    options: {
      ...DEFAULT_RUN_OPTIONS,
      maxTurns: Math.max(1, Math.floor(number('maxTurns', DEFAULT_RUN_OPTIONS.maxTurns))),
      handicapCells: Math.max(0, Math.floor(number('handicap', DEFAULT_RUN_OPTIONS.handicapCells))),
      maxSteps: Math.max(1000, Math.floor(number('maxSteps', DEFAULT_RUN_OPTIONS.maxSteps))),
      turnLimit: flags.has('noTurnLimit')
        ? null
        : flags.has('turnLimit')
          ? Math.max(1, Math.floor(number('turnLimit', 15)))
          : undefined,
      victoryPowerCenters: flags.has('victory')
        ? Math.max(1, Math.floor(number('victory', 6)))
        : null,
    },
    out: flags.get('out') ?? null,
    label: flags.get('label') ?? null,
  }
}

function loadMap(name: string): MapDefinition {
  const candidates = [
    resolve(HERE, 'maps', `${name}.json`),
    resolve(REPO_ROOT, 'maps/bundled', `${name}.json`),
    resolve(REPO_ROOT, 'maps', `${name}.json`),
    resolve(process.cwd(), name),
  ]
  for (const path of candidates) {
    try {
      return normalizeMapDefinition(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      continue
    }
  }
  throw new Error(`Карта не найдена: ${name} (искал в harness/balance/maps, maps/bundled, maps и по прямому пути)`)
}

function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function report(mapId: string, summary: Summary, records: readonly GameRecord[]): string {
  const lines: string[] = []
  lines.push(`## ${mapId}`)
  lines.push('')
  lines.push(`Партий: ${summary.games}, из них с ошибкой: ${summary.errors}`)
  lines.push(
    `Длина партии: среднее ${num(summary.turns.mean)}, медиана ${summary.turns.median}, `
      + `p10 ${summary.turns.p10}, p90 ${summary.turns.p90}`,
  )
  lines.push(`Упёрлись в потолок ходов: ${percent(summary.hitTurnCapShare)}`)
  lines.push(`Смен лидера за партию: ${num(summary.meanLeadChanges)}`)
  lines.push(
    `Точка невозврата: ход ${num(summary.pointOfNoReturn.mean)} `
      + `(${percent(summary.pointOfNoReturn.meanShareOfGame)} длины партии)`,
  )
  lines.push(`Пережог кошелька: ${num(summary.wasteRatio)} (1,00 — без потерь)`)
  lines.push(`Выбор лимита захвата при 3+ центрах: ${percent(summary.claimUtilisationAt3Plus)}`)
  lines.push(
    `Первое выбывание: ход ${summary.meanEliminationTurn == null ? '—' : num(summary.meanEliminationTurn)}`,
  )
  if (summary.handicap.winRate != null) {
    lines.push('')
    lines.push(
      `Фора: победа форового ${percent(summary.handicap.winRate)}, `
        + `усиление отрыва (ход 3 → 10) ${num(summary.handicap.amplification)} `
        + '(больше 1 — игра разгоняет отрыв)',
    )
  }
  lines.push('')

  const giniEntries = Object.entries(summary.giniByTurn)
  if (giniEntries.length) {
    lines.push(`Джини по территории: ${giniEntries.map(([t, v]) => `ход ${t} — ${num(v)}`).join(', ')}`)
  }

  const unlocks = Object.entries(summary.firstUnlockTurn)
  if (unlocks.length) {
    lines.push(`Первое открытие класса: ${unlocks.map(([t, v]) => `${t} — ход ${num(v, 1)}`).join(', ')}`)
  }

  lines.push('')
  lines.push('Винрейт по месту: ' + (Object.entries(summary.winRateBySeat)
    .map(([id, v]) => `${id} ${percent(v)}`).join(', ') || '—'))
  lines.push('Винрейт по позиции в очереди: ' + (Object.entries(summary.winRateByOrderPosition)
    .map(([pos, v]) => `#${Number(pos) + 1} ${percent(v)}`).join(', ') || '—'))
  const battleOutcomeLabels: Record<string, string> = {
    attacker: 'атакующий',
    defender: 'защитник',
    retreat: 'отступление',
    mutual: 'взаимно',
    none: 'без исхода',
  }
  lines.push(
    `Боёв за партию: ${num(summary.battles.perGame)}, обстрелов: ${num(summary.battles.bombardmentsPerGame)}; `
      + 'исходы: ' + (Object.entries(summary.battles.outcomes)
        .map(([key, share]) => `${battleOutcomeLabels[key] ?? key} ${percent(share)}`)
        .join(', ') || '—'),
  )
  lines.push(
    `Потери за бой по цене: атакующий ${num(summary.battles.meanAttackerLossValue)}, `
      + `защитник ${num(summary.battles.meanDefenderLossValue)}`,
  )
  lines.push('Исходы: ' + (Object.entries(summary.victoryReasons)
    .map(([reason, n]) => `${reason} ${n}`).join(', ') || '—'))

  const errors = records.filter((r) => r.error)
  if (errors.length) {
    const unique = [...new Set(errors.map((r) => r.error!))].slice(0, 3)
    lines.push('')
    lines.push(`Ошибки (${errors.length}): ${unique.join(' | ')}`)
  }
  return lines.join('\n')
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const blocks: string[] = []
  const payload: Record<string, { summary: Summary; records: GameRecord[] }> = {}

  for (const name of args.maps) {
    const map = loadMap(name)
    const records: GameRecord[] = []
    for (let i = 0; i < args.games; i += 1) {
      records.push(runGame(map, mixSeed(args.seed + i, map.id), args.options))
    }
    const summary = summarize(records)
    payload[map.id] = { summary, records }
    blocks.push(report(map.id, summary, records))
  }

  const header = args.label ? `# Замер баланса: ${args.label}` : '# Замер баланса'
  const text = [header, '', ...blocks].join('\n\n')
  process.stdout.write(`${text}\n`)

  if (args.out) {
    const dir = resolve(REPO_ROOT, args.out)
    mkdirSync(dir, { recursive: true })
    const stamp = args.label ?? 'run'
    // Партии целиком не сохраняем — только сводки: иначе файл растёт на мегабайты.
    const summaries = Object.fromEntries(
      Object.entries(payload).map(([mapId, value]) => [mapId, value.summary]),
    )
    writeFileSync(
      resolve(dir, `${stamp}.json`),
      `${JSON.stringify({ label: stamp, seed: args.seed, games: args.games, options: args.options, summaries }, null, 2)}\n`,
      'utf8',
    )
    writeFileSync(resolve(dir, `${stamp}.md`), `${text}\n`, 'utf8')
    process.stdout.write(`\nЗаписано: ${resolve(dir, `${stamp}.json`)}\n`)
  }
}

main()
