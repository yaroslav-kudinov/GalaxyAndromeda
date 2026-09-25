/**
 * Карты для замеров: загрузка по имени и выбор набора по каталогу `maps/bundled/manifest.json`.
 *
 * Все скрипты харнесса ищут карту одинаково: замерные карты харнесса (`harness/balance/maps`),
 * официальные (`maps/bundled`), прочие (`maps`) и, наконец, прямой путь.
 *
 * Набор карт в `--map` задаётся именами через запятую или выборкой по каталогу:
 *
 * - `@published` — все опубликованные карты каталога;
 * - `@4+` — опубликованные на четверых и больше (сейчас 4, 5 и 6 игроков);
 * - `@4` — опубликованные ровно на четверых.
 *
 * Выборки и имена можно смешивать: `@4+,duel`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeMapDefinition, type MapDefinition } from '../../packages/rules/src/index.js'

export const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HARNESS_DIR, '../..')

export interface ManifestEntry {
  id: string
  name: string
  playerCount: number
  sortOrder?: number
  /** `false` — карта не показывается в каталоге (учебная). */
  published?: boolean
}

/** Каталог официальных карт в порядке `sortOrder`. */
export function bundledManifest(): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'maps/bundled/manifest.json'), 'utf8')) as { maps: ManifestEntry[] }
  return [...raw.maps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

function mapPathCandidates(name: string): string[] {
  return [
    resolve(HARNESS_DIR, 'maps', `${name}.json`),
    resolve(REPO_ROOT, 'maps/bundled', `${name}.json`),
    resolve(REPO_ROOT, 'maps', `${name}.json`),
    resolve(process.cwd(), name),
  ]
}

export function loadMap(name: string): MapDefinition {
  for (const path of mapPathCandidates(name)) {
    if (!existsSync(path)) continue
    return normalizeMapDefinition(JSON.parse(readFileSync(path, 'utf8')))
  }
  throw new Error(`Карта не найдена: ${name} (искал в harness/balance/maps, maps/bundled, maps и по прямому пути)`)
}

/** Раскрывает `--map`: имена и выборки каталога (`@published`, `@4+`, `@4`) в список имён карт. */
export function resolveMapNames(spec: string): string[] {
  const out: string[] = []
  const push = (name: string) => {
    if (!out.includes(name)) out.push(name)
  }
  for (const part of spec.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!part.startsWith('@')) {
      push(part)
      continue
    }
    const published = bundledManifest().filter((entry) => entry.published !== false)
    const selector = part.slice(1)
    if (selector === 'published') {
      published.forEach((entry) => push(entry.id))
      continue
    }
    const match = selector.match(/^(\d+)(\+?)$/)
    if (!match) throw new Error(`Не понял выборку карт «${part}»: есть @published, @N и @N+`)
    const players = Number(match[1])
    const orMore = match[2] === '+'
    const picked = published.filter((entry) => (orMore ? entry.playerCount >= players : entry.playerCount === players))
    if (picked.length === 0) throw new Error(`Выборка «${part}» не нашла ни одной опубликованной карты`)
    picked.forEach((entry) => push(entry.id))
  }
  return out
}
