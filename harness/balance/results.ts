/**
 * Чтение каталога замеров (`<метка>.json`, которые пишет `run.ts --out`) и таблицы по ним в
 * markdown: победы по уровням, поведение, экономика, остановленные почти победители.
 *
 * Имя замера — имя файла без `.json`; если в файле несколько карт, к имени добавляется карта.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { BEHAVIOR_LABELS, type Summary } from './metrics.js'

export const LEVELS = ['easy', 'medium', 'hard'] as const

export interface ResultEntry {
  name: string
  mapId: string
  games: number
  seed: number
  seating?: { kind: string; base?: string; solo?: string | null; levels?: string[] }
  summary: Summary
}

/** Все замеры каталога (или одного файла) по именам. */
export function loadResults(path: string): Map<string, ResultEntry> {
  const out = new Map<string, ResultEntry>()
  if (!existsSync(path)) throw new Error(`Нет каталога замеров: ${path}`)
  const files = statSync(path).isDirectory()
    ? readdirSync(path).filter((file) => file.endsWith('.json')).sort().map((file) => resolve(path, file))
    : [resolve(path)]
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data?.summaries) continue
    const base = file.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.json$/, '')
    const maps = Object.entries<Summary>(data.summaries)
    for (const [mapId, summary] of maps) {
      const name = maps.length > 1 ? `${base} · ${mapId}` : base
      out.set(name, { name, mapId, games: data.games ?? summary.games, seed: data.seed, seating: data.seating, summary })
    }
  }
  return out
}

export const pct = (value: number | null | undefined, digits = 0): string =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

export const num = (value: number | null | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)

/** «побед на место (×к справедливой доле)» для уровня или пусто, если уровня в замере нет. */
export function winCell(summary: Summary | undefined, level: string): string {
  const result = summary?.winRateByDifficulty?.[level]
  if (!result) return ''
  return `${pct(result.winsPerSeat)} ×${num(result.perSeatVsFair, 2)}`
}

export type Section = 'wins' | 'behavior' | 'economy' | 'near'

export const ALL_SECTIONS: readonly Section[] = ['wins', 'behavior', 'near', 'economy']

function winsTable(entries: readonly ResultEntry[]): string[] {
  const lines = [
    `| замер | партий | ходов | ошибок / сбоев | ${LEVELS.map((level) => `${level}: побед на место ×к справедливой`).join(' | ')} |`,
    `|---|---|---|---|${LEVELS.map(() => '---').join('|')}|`,
  ]
  for (const entry of entries) {
    const s = entry.summary
    const bot = s.bot?.errors || s.bot?.planRejects ? ` / ${s.bot.errors}+${s.bot.planRejects}` : ''
    lines.push(`| ${entry.name} | ${s.games} | ${num(s.turns.mean)} | ${s.errors}${bot} | ${LEVELS.map((level) => winCell(s, level)).join(' | ')} |`)
  }
  return lines
}

function behaviorTable(entries: readonly ResultEntry[]): string[] {
  const lines = [
    `| замер | уровень | ${BEHAVIOR_LABELS.map(([, label]) => label).join(' | ')} |`,
    `|---|---|${BEHAVIOR_LABELS.map(() => '---').join('|')}|`,
  ]
  for (const entry of entries) {
    for (const level of LEVELS) {
      const item = entry.summary.behaviorByDifficulty?.[level]
      if (!item) continue
      lines.push(`| ${entry.name} | ${level} | ${BEHAVIOR_LABELS.map(([key, , digits]) => num(item[key], digits)).join(' | ')} |`)
    }
  }
  return lines
}

function nearTable(entries: readonly ResultEntry[]): string[] {
  const lines = [
    '| замер | почти победитель | эпизодов | остановлен | из них раньше победил другой |',
    '|---|---|---|---|---|',
  ]
  for (const entry of entries) {
    for (const level of LEVELS) {
      const item = entry.summary.nearWins?.byLevel?.[level]
      if (!item?.episodes) continue
      lines.push(`| ${entry.name} | ${level} | ${item.episodes} | ${pct(item.share)} | ${item.otherWon ?? '—'} |`)
    }
  }
  return lines
}

function economyTable(entries: readonly ResultEntry[]): string[] {
  const lines = [
    '| замер | уровень | клеток по ходу | регион в конце | клеток с фишками | центров ход 3 | центров ход 5 | построек | кораблей построено | номинал за ход | бюджет 0 | деньги лицом вверх / в мелких регионах |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const entry of entries) {
    for (const level of LEVELS) {
      const e = entry.summary.economyByDifficulty?.[level]
      if (!e) continue
      lines.push(
        `| ${entry.name} | ${level} | ${num(e.meanCells)} | ${num(e.largestRegionAtEnd)} | ${num(e.tokenCellsAtEnd)} `
          + `| ${num(e.powerCentersAtTurn3, 2)} | ${num(e.powerCentersAtTurn5, 2)} | ${num(e.buildsPerGame)} | ${num(e.shipsBuiltPerGame)} `
          + `| ${num(e.tokensSpentPerTurn, 2)} | ${pct(e.budgetZeroShare)} | ${num(e.meanFaceUpValue)} / ${num(e.meanStrandedValue)} |`,
      )
    }
  }
  return lines
}

/** Сводные таблицы по замерам: по одной на раздел. */
export function renderTables(entries: readonly ResultEntry[], sections: readonly Section[] = ALL_SECTIONS): string {
  const blocks: string[] = []
  const titles: Record<Section, string> = {
    wins: '## Победы по уровням',
    behavior: '## Поведение по уровням (на место за партию; открытые центры — за ход)',
    near: '## Почти победитель: остановлен ли в ближайшие два хода',
    economy: '## Экономика по уровням (среднее на место)',
  }
  const render: Record<Section, (list: readonly ResultEntry[]) => string[]> = {
    wins: winsTable,
    behavior: behaviorTable,
    near: nearTable,
    economy: economyTable,
  }
  for (const section of sections) blocks.push([titles[section], '', ...render[section](entries)].join('\n'))
  return blocks.join('\n\n')
}

export function parseSections(raw: string | undefined): Section[] {
  if (!raw) return [...ALL_SECTIONS]
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean)
  for (const item of list) {
    if (!ALL_SECTIONS.includes(item as Section)) throw new Error(`Нет раздела «${item}»: есть ${ALL_SECTIONS.join(', ')}`)
  }
  return list as Section[]
}

/** Разбор `--флаг значение` и `--флаг=значение`; позиционные аргументы — отдельно. */
export function parseFlags(argv: readonly string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const eq = token.indexOf('=')
    if (eq > 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1))
      continue
    }
    const next = argv[i + 1]
    if (next != null && !next.startsWith('--')) {
      flags.set(token.slice(2), next)
      i += 1
    } else {
      flags.set(token.slice(2), '')
    }
  }
  return { flags, positional }
}
