#!/usr/bin/env tsx
/**
 * Прогон партий для замера баланса.
 *
 *   pnpm balance --map duel --games 200
 *   pnpm balance --map duel,maltese-cross-4 --games 100 --out harness/balance/baselines
 *   pnpm balance --map reference-duel --games 80 --difficulty hard
 *   pnpm balance --map reference-duel --games 80 --mix "player-1=hard,player-2=easy" --rotate
 *   pnpm balance --map reference-six-13 --games 80 --h2h hard,easy
 *
 * Пишет JSON со сводкой и печатает её человекочитаемо. Базовые замеры снимаются до любой
 * правки правил: без них все последующие числа — угадайка.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { BotDifficulty, DoctrineId } from '../../packages/rules/src/index.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOT_DIFFICULTIES, DOCTRINES, isBotDifficulty, normalizeMapDefinition } from '../../packages/rules/src/index.js'
import type { MapDefinition } from '../../packages/rules/src/index.js'
import { BOT_PROFILES } from '../../packages/rules/src/bot-strategy.js'
import { DEFAULT_RUN_OPTIONS, runGame, seatIdsOf } from './bot.js'
import type { RunOptions } from './bot.js'
import { summarize } from './metrics.js'
import type { GameRecord, Summary } from './metrics.js'
import { mixSeed } from './rng.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')

/**
 * Как рассадить уровни ботов по местам.
 *
 * - `all` — один уровень на всех местах (`--difficulty`);
 * - `mix` — уровни по местам из `--mix`, остальным — `--difficulty`; с `--rotate` раскладка
 *   сдвигается на место от партии к партии;
 * - `h2h` — уровни из `--h2h` чередуются по местам и сдвигаются от партии к партии: за серию
 *   каждый уровень сидит на каждом месте поровну, и преимущество места гасится.
 */
interface SeatingPlan {
  kind: 'all' | 'mix' | 'h2h'
  base: BotDifficulty
  mix: Record<string, BotDifficulty>
  rotate: boolean
  levels: BotDifficulty[]
}

interface Args {
  maps: string[]
  games: number
  seed: number
  options: RunOptions
  out: string | null
  label: string | null
  seating: SeatingPlan
}

function parseLevel(raw: string, flag: string): BotDifficulty {
  const value = raw.trim()
  if (!isBotDifficulty(value)) {
    throw new Error(`--${flag}: неизвестный уровень «${value}» (есть: ${BOT_DIFFICULTIES.join(', ')})`)
  }
  return value
}

function parseSeating(flags: Map<string, string>): SeatingPlan {
  const base = flags.has('difficulty') ? parseLevel(flags.get('difficulty')!, 'difficulty') : 'easy'
  const mix: Record<string, BotDifficulty> = {}
  for (const entry of (flags.get('mix') ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const [seat, level] = entry.split('=')
    if (!seat || !level) throw new Error(`--mix: не понял «${entry}», нужно место=уровень`)
    mix[seat.trim()] = parseLevel(level, 'mix')
  }
  const levels = (flags.get('h2h') ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    .map((level) => parseLevel(level, 'h2h'))
  if (levels.length === 1) throw new Error('--h2h: нужно хотя бы два уровня через запятую')
  const kind = levels.length ? 'h2h' : Object.keys(mix).length ? 'mix' : 'all'
  return { kind, base, mix, rotate: flags.has('rotate'), levels }
}

/** Уровни по местам для партии номер `gameIndex`. */
function seatDifficultyFor(plan: SeatingPlan, seats: readonly string[], gameIndex: number): Record<string, BotDifficulty> {
  const out: Record<string, BotDifficulty> = {}
  if (plan.kind === 'h2h') {
    seats.forEach((seat, index) => {
      out[seat] = plan.levels[(index + gameIndex) % plan.levels.length]!
    })
    return out
  }
  if (plan.kind === 'mix') {
    const assigned = seats.map((seat) => plan.mix[seat] ?? plan.base)
    seats.forEach((seat, index) => {
      const shift = plan.rotate ? gameIndex % seats.length : 0
      out[seat] = assigned[(index - shift + seats.length) % seats.length]!
    })
    return out
  }
  for (const seat of seats) out[seat] = plan.base
  return out
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
      doctrines: !flags.has('noDoctrines'),
      forcedDoctrine: (flags.get('doctrine') as DoctrineId | undefined) ?? null,
      deviantDoctrine: (flags.get('deviant') as DoctrineId | undefined) ?? null,
      doctrineWindow: flags.has('doctrineWindow')
        ? Math.max(1, Math.floor(number('doctrineWindow', 5)))
        : undefined,
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
    seating: parseSeating(flags),
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
  if (summary.deviantWinRate != null) {
    lines.push(`Особая доктрина: побед ${percent(summary.deviantWinRate)} (справедливо — ${percent(1 / Math.max(1, records[0]?.playerIds.length ?? 2))})`)
  }
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
  lines.push(
    `Осад за партию: ${num(summary.sieges.perGame)}; доля взятых из завершённых: ${percent(summary.sieges.capturedShare)}`,
  )
  const doctrineLabels: Record<string, string> = {
    expansion: 'экспансия',
    production: 'производство',
    maneuvers: 'манёвры',
    attack: 'атака',
    defense: 'оборона',
    none: 'без доктрины',
  }
  for (const [window, shares] of Object.entries(summary.doctrinesByWindow).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(
      `Доктрины с хода ${window}: `
        + Object.entries(shares)
          .sort((a, b) => b[1] - a[1])
          .map(([id, share]) => `${doctrineLabels[id] ?? id} ${percent(share)}`)
          .join(', '),
    )
  }
  lines.push('Исходы: ' + (Object.entries(summary.victoryReasons)
    .map(([reason, n]) => `${reason} ${n}`).join(', ') || '—'))
  const levels = Object.entries(summary.winRateByDifficulty)
  if (levels.length > 1 || levels.some(([level]) => level !== 'easy')) {
    lines.push('Победы по уровням ботов: ' + levels
      .sort((a, b) => BOT_DIFFICULTIES.indexOf(a[0] as BotDifficulty) - BOT_DIFFICULTIES.indexOf(b[0] as BotDifficulty))
      .map(([level, result]) =>
        `${level} ${percent(result.winRate)} (${result.wins} из ${summary.games - summary.errors}, `
          + `при равной силе ${percent(result.fairShare)})`)
      .join(', '))
  }
  if (summary.bot.errors || summary.bot.planRejects) {
    lines.push(
      `Сбои оценки бота: ${summary.bot.errors}, отказы движка в плане: ${summary.bot.planRejects}`
        + (summary.bot.samples.length ? ` — ${summary.bot.samples.join(' | ')}` : ''),
    )
  }

  const errors = records.filter((r) => r.error)
  if (errors.length) {
    const unique = [...new Set(errors.map((r) => r.error!))].slice(0, 3)
    lines.push('')
    lines.push(`Ошибки (${errors.length}): ${unique.join(' | ')}`)
  }
  return lines.join('\n')
}

/**
 * Подбор чисел доктрин без правки правил: `--tune maneuvers.claimLimit=-2,attack.claimLimit=-1`.
 * Меняет таблицу только в этом процессе.
 */
function applyDoctrineTuning(raw: string | undefined): void {
  if (!raw) return
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    // Значение — число, true/false или список классов через «|».
    const match = entry.match(/^(\w+)\.(\w+)=([\w|-]+)$/)
    const doctrine = match && DOCTRINES.find((candidate) => candidate.id === match[1])
    if (!match || !doctrine) throw new Error(`Не понял настройку доктрины: ${entry}`)
    const raw = match[3]!
    const value = raw === 'true'
      ? true
      : raw === 'false'
        ? false
        : /^-?\d+$/.test(raw)
          ? Number(raw)
          : raw.split('|')
    ;(doctrine as unknown as Record<string, unknown>)[match[2]!] = value
  }
}

/**
 * Подбор поведения ботов без правки кода: `--botTune hard.defenseShare=0.5,hard.reserveMarkers=false`.
 * Меняет профиль уровня только в этом процессе — чтобы замерить вклад каждой черты.
 */
function applyBotTuning(raw: string | undefined): void {
  if (!raw) return
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = entry.match(/^(medium|hard)\.(\w+)=([\w.-]+)$/)
    const profile = match ? BOT_PROFILES[match[1] as 'medium' | 'hard'] : null
    if (!match || !profile || !(match[2]! in profile)) throw new Error(`Не понял настройку бота: ${entry}`)
    const value = match[3] === 'true' ? true : match[3] === 'false' ? false : Number(match[3])
    ;(profile as unknown as Record<string, unknown>)[match[2]!] = value
  }
}

function main(): void {
  const tuneIndex = process.argv.indexOf('--tune')
  applyDoctrineTuning(tuneIndex > 0 ? process.argv[tuneIndex + 1] : undefined)
  const botTuneIndex = process.argv.indexOf('--botTune')
  applyBotTuning(botTuneIndex > 0 ? process.argv[botTuneIndex + 1] : undefined)
  const args = parseArgs(process.argv.slice(2))
  const blocks: string[] = []
  const payload: Record<string, { summary: Summary; records: GameRecord[] }> = {}

  for (const name of args.maps) {
    const map = loadMap(name)
    const seats = seatIdsOf(map)
    const records: GameRecord[] = []
    for (let i = 0; i < args.games; i += 1) {
      const seatDifficulty = seatDifficultyFor(args.seating, seats, i)
      records.push(runGame(map, mixSeed(args.seed + i, map.id), { ...args.options, seatDifficulty }))
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
      `${JSON.stringify({ label: stamp, seed: args.seed, games: args.games, options: args.options, seating: args.seating, summaries }, null, 2)}\n`,
      'utf8',
    )
    writeFileSync(resolve(dir, `${stamp}.md`), `${text}\n`, 'utf8')
    process.stdout.write(`\nЗаписано: ${resolve(dir, `${stamp}.json`)}\n`)
  }
}

main()
