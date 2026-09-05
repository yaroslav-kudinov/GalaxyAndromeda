/**
 * Normalize author .galaxy.json sources into maps/bundled/*.json (MapDefinition only)
 * and packages/client/public/maps/*.json for offline fallback.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeMapDefinition,
  parseGalaxySave,
  resolveMapPlayerCount,
  validateMapDefinition,
} from '@galaxy/rules'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

const BUNDLED = [
  { source: 'maps/bundled/duel.source.galaxy.json', outId: 'duel', outName: 'Дуэль', sortOrder: 1 },
  {
    source: 'maps/bundled/trio-start.source.galaxy.json',
    outId: 'trio-start',
    outName: 'Карта на троих (Старт)',
    sortOrder: 2,
  },
  {
    source: 'maps/bundled/maltese-cross-4.source.galaxy.json',
    outId: 'maltese-cross-4',
    outName: 'Мальтийский крест (4)',
    sortOrder: 3,
  },
]

const outDirs = [join(root, 'maps/bundled'), join(root, 'packages/client/public/maps')]
for (const dir of outDirs) mkdirSync(dir, { recursive: true })

const manifest = []

for (const entry of BUNDLED) {
  const raw = JSON.parse(readFileSync(join(root, entry.source), 'utf8'))
  const save = parseGalaxySave(raw)
  let map = normalizeMapDefinition({ ...save.map, id: entry.outId, name: entry.outName })
  const playerCount = resolveMapPlayerCount(map)
  map = { ...map, playerCount }
  const errors = validateMapDefinition(map)
  if (errors.length) {
    console.error(`${entry.outId}: validation failed`, errors)
    process.exit(1)
  }
  const json = JSON.stringify(map, null, 2)
  for (const dir of outDirs) {
    writeFileSync(join(dir, `${entry.outId}.json`), json, 'utf8')
  }
  manifest.push({ id: entry.outId, name: entry.outName, playerCount, sortOrder: entry.sortOrder })
  console.log(`OK ${entry.outId} (${playerCount} players, ${map.cells.length} cells)`)
}

writeFileSync(join(root, 'maps/bundled/manifest.json'), JSON.stringify({ maps: manifest }, null, 2), 'utf8')
