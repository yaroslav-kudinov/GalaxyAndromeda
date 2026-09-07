/**
 * Черновик генератора. Канон карты — экспорт редактора
 * `maps/bundled/six-point-path.source.galaxy.json`.
 * Не запускай этот скрипт, если не хочешь перезаписать канон.
 *
 * «Шестиконечный путь»: 6-fold разворот «Пятиконечного пути».
 * Дома — ромб 2 центра власти + кредиты 7 + производство 5.
 * Центр — небольшая ступица с прорехами; между игроками — точки интереса.
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexDistance } from '../../packages/rules/src/map.js'
import { rotateHex } from '../../packages/rules/src/hex-symmetry.js'
import {
  hexKey,
  normalizeMapDefinition,
  validateMapDefinition,
  type HexCoord,
  type MapCellDefinition,
  type MapDefinition,
} from '../../packages/rules/src/index.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

type Extra = Partial<Omit<MapCellDefinition, 'q' | 'r'>>
const extras = new Map<string, Extra>()

function dist0(q: number, r: number): number {
  return hexDistance({ q, r }, { q: 0, r: 0 })
}

function merge(q: number, r: number, extra: Extra): void {
  const k = hexKey(q, r)
  extras.set(k, { ...extras.get(k), ...extra })
}

function orbit(proto: HexCoord): HexCoord[] {
  return Array.from({ length: 6 }, (_, k) => rotateHex(proto, k))
}

function paintOrbit(proto: HexCoord, extra: Extra): void {
  for (const c of orbit(proto)) merge(c.q, c.r, extra)
}

const token = (type: 'credits' | 'production', value: number) => ({
  resourceToken: { type, value, faceUp: true as const },
})

// Дома: внутренний центр на дальности 5, внешний на 7, мост на кольце 6.
paintOrbit({ q: 5, r: 0 }, {})
paintOrbit({ q: 6, r: 0 }, {})
paintOrbit({ q: 6, r: -1 }, {})
paintOrbit({ q: 7, r: -1 }, {})
for (let k = 0; k < 6; k++) {
  const player = k + 1
  const inner = rotateHex({ q: 5, r: 0 }, k)
  const prod = rotateHex({ q: 6, r: 0 }, k)
  const cred = rotateHex({ q: 6, r: -1 }, k)
  const outer = rotateHex({ q: 7, r: -1 }, k)
  merge(inner.q, inner.r, { isPowerCenter: true, startPlayer: player })
  merge(prod.q, prod.r, { startPlayer: player, ...token('production', 5) })
  merge(cred.q, cred.r, { startPlayer: player, ...token('credits', 7) })
  merge(outer.q, outer.r, { isPowerCenter: true, startPlayer: player })
}

merge(0, 0, { isPowerCenter: true })
paintOrbit({ q: 3, r: 0 }, { isPowerCenter: true })

// Две фишки по 2 кредита у каждого дома, ближе к центру, зеркально оси старта (луч через внутренний центр).
paintOrbit({ q: 4, r: -1 }, token('credits', 2))
paintOrbit({ q: 3, r: 1 }, token('credits', 2))

// Точки интереса в шве между соседними домами.
paintOrbit({ q: 3, r: 2 }, token('credits', 6))
paintOrbit({ q: 2, r: 3 }, token('production', 5))

// Внешнее кольцо вокруг внешнего центра власти.
paintOrbit({ q: 7, r: 0 }, token('production', 2))
paintOrbit({ q: 7, r: -2 }, token('production', 2))
paintOrbit({ q: 8, r: -1 }, token('production', 5))
paintOrbit({ q: 9, r: 0 }, token('credits', 3))

const keepProtos: HexCoord[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 3, r: 0 },
  { q: 4, r: 0 },
  { q: 4, r: -1 },
  { q: 3, r: 1 },
  { q: 5, r: 0 },
  { q: 3, r: 2 },
  { q: 2, r: 3 },
  { q: 6, r: 0 },
  { q: 6, r: -1 },
  { q: 7, r: -1 },
]

const keepInner = new Set(keepProtos.flatMap((p) => orbit(p).map((c) => hexKey(c.q, c.r))))

function keepCell(q: number, r: number): boolean {
  const d = dist0(q, r)
  if (d >= 7 && d <= 9) return true
  if (d <= 1) return true
  return keepInner.has(hexKey(q, r))
}

const cells: MapCellDefinition[] = []
const seen = new Set<string>()

function addCell(q: number, r: number): void {
  const k = hexKey(q, r)
  if (seen.has(k) || !keepCell(q, r)) return
  seen.add(k)
  cells.push({ q, r, ...extras.get(k) })
}

for (let q = -9; q <= 9; q++) {
  for (let r = -9; r <= 9; r++) {
    if (dist0(q, r) <= 9) addCell(q, r)
  }
}

cells.sort((a, b) => a.r - b.r || a.q - b.q)

const map: MapDefinition = normalizeMapDefinition({
  id: 'six-point-path',
  name: 'Шестиконечный путь',
  playerCount: 6,
  cells,
})

const errors = validateMapDefinition(map)
if (errors.length) {
  console.error(errors)
  process.exit(1)
}

const dirs = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]
const keys = new Set(map.cells.map((c) => hexKey(c.q, c.r)))
const first = map.cells[0]!
const flood = new Set<string>()
const stack = [hexKey(first.q, first.r)]
while (stack.length) {
  const k = stack.pop()!
  if (flood.has(k)) continue
  flood.add(k)
  const [q, r] = k.split(',').map(Number)
  for (const d of dirs) {
    const n = hexKey(q + d.q, r + d.r)
    if (keys.has(n) && !flood.has(n)) stack.push(n)
  }
}
if (flood.size !== keys.size) {
  console.error(`Карта несвязна: ${flood.size} / ${keys.size}`)
  process.exit(1)
}

const json = JSON.stringify(map, null, 2)
const save = JSON.stringify(
  { format: 'galaxy-save', version: 1, savedAt: new Date().toISOString(), map },
  null,
  2,
)
writeFileSync(join(root, 'maps/bundled/six-point-path.json'), `${json}\n`, 'utf8')
writeFileSync(join(root, 'maps/bundled/six-point-path.source.galaxy.json'), `${save}\n`, 'utf8')
writeFileSync(join(root, 'packages/client/public/maps/six-point-path.json'), `${json}\n`, 'utf8')

const pcs = map.cells.filter((c) => c.isPowerCenter).length
const credits = map.cells.filter((c) => c.resourceToken?.type === 'credits').length
const prod = map.cells.filter((c) => c.resourceToken?.type === 'production').length
console.log(
  `OK six-point-path cells=${map.cells.length} PCs=${pcs} credits=${credits} production=${prod}`,
)
