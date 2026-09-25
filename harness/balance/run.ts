#!/usr/bin/env tsx
/**
 * Прогон партий для замера баланса.
 *
 *   pnpm balance --map duel --games 200
 *   pnpm balance --map duel,maltese-cross-4 --games 100 --out harness/balance/baselines
 *   pnpm balance --map reference-duel --games 80 --difficulty hard
 *   pnpm balance --map reference-duel --games 80 --mix "player-1=hard,player-2=easy" --rotate
 *   pnpm balance --map reference-six-13 --games 80 --h2h hard,easy
 *   pnpm balance --map @4+ --games 150 --seed 41 --solo hard      # одно место сложного среди средних
 *
 * `--map` понимает выборки каталога `maps/bundled/manifest.json`: `@published`, `@4+`, `@4`.
 *
 * Пишет JSON со сводкой и печатает её человекочитаемо. Базовые замеры снимаются до любой
 * правки правил: без них все последующие числа — угадайка.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import type { BotDifficulty, DoctrineId } from '../../packages/rules/src/index.js'
import { resolve } from 'node:path'

import { BOT_DIFFICULTIES } from '../../packages/rules/src/index.js'
import { DEFAULT_RUN_OPTIONS, runGame, seatIdsOf } from './bot.js'
import type { RunOptions } from './bot.js'
import { loadMap, REPO_ROOT, resolveMapNames } from './maps.js'
import { summarize, BEHAVIOR_LABELS } from './metrics.js'
import type { GameRecord, Summary } from './metrics.js'
import { mixSeed } from './rng.js'
import { parseSeating, seatDifficultyFor, type SeatingPlan } from './seating.js'
import { applyBotTuning, applyDoctrineTuning } from './tuning.js'

interface Args {
  maps: string[]
  games: number
  seed: number
  options: RunOptions
  out: string | null
  label: string | null
  seating: SeatingPlan
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
    maps: resolveMapNames(flags.get('map') ?? 'duel'),
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
        `${level} ${percent(result.winRate)} (${result.wins} из ${result.decided} партий с его участием, `
          + `при равной силе ${percent(result.fairShare)}; на место ${percent(result.winsPerSeat)}, `
          + `к справедливой ×${num(result.perSeatVsFair)})`)
      .join(', '))
  }
  const economy = Object.entries(summary.economyByDifficulty)
  if (economy.length > 1 || economy.some(([level]) => level !== 'easy')) {
    lines.push('Экономика по уровням (среднее на место):')
    for (const [level, item] of economy.sort((a, b) =>
      BOT_DIFFICULTIES.indexOf(a[0] as BotDifficulty) - BOT_DIFFICULTIES.indexOf(b[0] as BotDifficulty))) {
      lines.push(
        `- ${level}: клеток ${num(item.meanCells, 1)} по ходу (ход 5 — ${num(item.cellsAtTurn5, 1)}, конец — ${num(item.cellsAtEnd, 1)}), `
          + `наибольший регион ${num(item.largestRegionAtEnd, 1)}, регионов от 3 клеток ${num(item.productionRegionsAtEnd, 1)}, `
          + `клеток с фишками ${num(item.tokenCellsAtEnd, 1)}; центров ${num(item.meanPowerCenters, 2)} по ходу `
          + `(ход 3 — ${num(item.powerCentersAtTurn3, 2)}, ход 5 — ${num(item.powerCentersAtTurn5, 2)}); `
          + `построек ${num(item.buildsPerGame, 1)}, кораблей построено ${num(item.shipsBuiltPerGame, 1)}, `
          + `номинал ${num(item.tokensSpentPerGame, 1)} (${num(item.tokensSpentPerTurn, 2)} за ход); `
          + `бюджет перезарядки 0 — ${percent(item.budgetZeroShare)} ходов, из них с фишками лицом вниз — ${percent(item.starvedShare)}; `
          + `деньги лицом вверх ${num(item.meanFaceUpValue, 1)} (в мелких регионах ${num(item.meanStrandedValue, 1)}); кораблей в конце ${num(item.shipsAtEnd, 1)}`,
      )
    }
  }
  const behavior = Object.entries(summary.behaviorByDifficulty)
  if (behavior.length > 1 || behavior.some(([level]) => level !== 'easy')) {
    lines.push('Поведение по уровням (на место за партию; открытые центры — за ход):')
    for (const [level, item] of behavior.sort((a, b) =>
      BOT_DIFFICULTIES.indexOf(a[0] as BotDifficulty) - BOT_DIFFICULTIES.indexOf(b[0] as BotDifficulty))) {
      lines.push(`- ${level}: ` + BEHAVIOR_LABELS
        .map(([key, label, digits]) => `${label} ${num(item[key], digits)}`)
        .join(', '))
    }
  }
  const near = summary.nearWins
  if (near.all.episodes > 0) {
    const part = (item: { episodes: number; stopped: number; share: number; otherWon: number }) =>
      `${percent(item.share)} (${item.stopped} из ${item.episodes}; из них раньше победил другой — ${item.otherWon})`
    lines.push(
      `Почти победителя остановили: ${part(near.all)}; `
        + Object.entries(near.byLevel).map(([level, item]) => `он ${level} — ${part(item)}`).join(', ')
        + `; в партии есть другой высокий — ${part(near.withOtherHard)}, нет — ${part(near.withoutOtherHard)}`,
    )
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
