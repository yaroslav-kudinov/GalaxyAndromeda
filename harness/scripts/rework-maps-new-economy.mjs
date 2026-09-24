/**
 * Переделка официальных карт под новое ядро (ADR 015–020): меньше центров власти, порог
 * победы 6, фишки номиналом 2–5 примерно на 35–40 % клеток. Геометрия, стартовые позиции и
 * флоты не меняются.
 *
 * Правит авторские исходники `maps/bundled/*.source.galaxy.json`; игровые копии собирает
 * `node harness/scripts/import-bundled-maps.mjs`.
 *
 * Usage: node harness/scripts/rework-maps-new-economy.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DRY = process.argv.includes('--dry')

/**
 * Что делать с каждой картой.
 * - `removePowerCenters` — центры, которые снимаются (симметричными группами);
 * - `split` — дробить крупные фишки на соседние пустые клетки (карта бедна фишками);
 *   иначе крупные срезаются до пяти (карта и так густо покрыта);
 * - `splitFives` — дробить и пятёрки (3 + 2), если без этого фишек меньше трети клеток.
 */
const PLAN = {
  duel: {
    removePowerCenters: ['0,0', '1,0', '-3,-4', '-7,4'],
    split: true,
    splitFives: true,
  },
  'trio-start': {
    // Стартовых центров и так по одному. Снять ещё группу из трёх — партия упирается в лимит
    // ходов (замер: 97 % партий при 9 центрах), поэтому центры не трогаем.
    removePowerCenters: [],
    split: false,
  },
  'maltese-cross-4': {
    removePowerCenters: ['-5,8', '5,-8', '-3,8', '3,-8'],
    split: false,
  },
  'five-point-path': {
    // У каждого игрока по два стартовых центра — снимается ближний к середине карты.
    removeNearStartPowerCenter: true,
    split: true,
    splitFives: true,
  },
  'six-point-path': {
    removePowerCenters: ['0,-5', '-5,0', '-5,5', '0,5', '5,0', '5,-5'],
    split: true,
    splitFives: false,
  },
}

const VICTORY_THRESHOLD = 6
const key = (c) => `${c.q},${c.r}`
const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2

/** 12 преобразований гексовой сетки вокруг начала координат. */
function transforms() {
  const rot = ([x, y, z]) => [-z, -x, -y]
  const refl = ([x, y, z]) => [x, z, y]
  const out = []
  for (let f = 0; f < 2; f++) {
    for (let k = 0; k < 6; k++) {
      out.push((q, r) => {
        let c = [q, r, -q - r]
        if (f) c = refl(c)
        for (let i = 0; i < k; i++) c = rot(c)
        return { q: c[0], r: c[1] }
      })
    }
  }
  return out
}

/** Симметрии исходной карты: переводят клетки в клетки с тем же содержимым. */
function symmetriesOf(cells) {
  const byKey = new Map(cells.map((c) => [key(c), c]))
  const sig = (c) => [
    c.isPowerCenter ? 'P' : '',
    c.resourceToken ? `${c.resourceToken.type}${c.resourceToken.value}` : '',
    c.startPlayer != null ? 'S' : '',
    (c.startingShips ?? []).map((s) => s.type).sort().join(''),
  ].join('|')
  return transforms().filter((t) =>
    cells.every((c) => {
      const image = byKey.get(key(t(c.q, c.r)))
      return image && sig(image) === sig(c)
    }),
  )
}

function splitValue(value, splitFives) {
  if (value <= 1) return [2]
  if (value < 5) return [value]
  if (value === 5) return splitFives ? [3, 2] : [5]
  if (value === 6) return [3, 3]
  if (value === 7) return [4, 3]
  if (value === 8) return [4, 4]
  return [5, 4]
}

function rework(id, plan) {
  const file = join(root, 'maps/bundled', `${id}.source.galaxy.json`)
  const raw = readFileSync(file, 'utf8')
  const save = JSON.parse(raw)
  const cells = save.map.cells
  const byKey = new Map(cells.map((c) => [key(c), c]))
  const syms = symmetriesOf(cells)
  const starts = cells.filter((c) => c.startPlayer != null)
  const nearestStart = (c) =>
    starts.reduce((best, s) => (dist(s, c) < dist(best, c) ? s : best), starts[0])
  const center = { q: 0, r: 0 }

  // 1. Центры власти.
  const remove = new Set(plan.removePowerCenters ?? [])
  if (plan.removeNearStartPowerCenter) {
    const byPlayer = new Map()
    for (const c of starts) {
      if (!c.isPowerCenter) continue
      const list = byPlayer.get(c.startPlayer) ?? []
      list.push(c)
      byPlayer.set(c.startPlayer, list)
    }
    for (const list of byPlayer.values()) {
      if (list.length < 2) continue
      list.sort((a, b) => dist(a, center) - dist(b, center))
      remove.add(key(list[0]))
    }
  }
  for (const k of remove) {
    const c = byKey.get(k)
    if (!c?.isPowerCenter) throw new Error(`${id}: ${k} — не центр власти`)
    delete c.isPowerCenter
  }
  save.map.victoryPowerCenters = VICTORY_THRESHOLD

  // 2. Фишки: решение принимается для представителя группы симметрии и повторяется в образах.
  const taken = new Set(cells.filter((c) => c.resourceToken).map(key))
  const done = new Set()
  const ordered = [...cells].filter((c) => c.resourceToken).sort((a, b) => key(a).localeCompare(key(b)))
  for (const rep of ordered) {
    if (done.has(key(rep))) continue
    // Образы представителя: для каждого — все преобразования, которые в него переводят.
    // Если их несколько (фишка лежит на оси симметрии), часть фишки можно положить только на
    // клетку, которую они все переводят в одну и ту же — иначе симметрия сломается.
    const images = new Map()
    for (const t of syms) {
      const img = key(t(rep.q, rep.r))
      images.set(img, [...(images.get(img) ?? []), t])
    }
    for (const k of images.keys()) done.add(k)
    const imageOf = (ts, n) => {
      const keys = new Set(ts.map((t) => key(t(n.q, n.r))))
      return keys.size === 1 ? [...keys][0] : null
    }

    const token = rep.resourceToken
    const isStart = rep.startPlayer != null
    // Стартовый капитал не меняется: «кредиты 7» делится внутри своих стартовых клеток.
    let parts = isStart
      ? (token.value > 5 ? splitValue(token.value, false) : [Math.max(2, token.value)])
      : plan.split
        ? splitValue(token.value, plan.splitFives)
        : [Math.min(5, Math.max(2, token.value))]

    const extra = parts.slice(1)
    const targets = []
    for (const value of extra) {
      const sector = nearestStart(rep)
      // Сначала соседи; если все заняты — клетки через одну.
      const ring = (radius) => cells.filter((n) => dist(n, rep) === radius)
      const candidates = [...ring(1), ...ring(2)]
        .filter((n) => (isStart ? n.startPlayer === rep.startPlayer : n.startPlayer == null))
        .sort((a, b) =>
          dist(a, rep) - dist(b, rep)
          || Number(nearestStart(b) === sector) - Number(nearestStart(a) === sector)
          || Math.abs(dist(a, sector) - dist(rep, sector)) - Math.abs(dist(b, sector) - dist(rep, sector))
          || key(a).localeCompare(key(b)))
      // Сосед годится, только если его образы однозначны, различны и свободны.
      const pick = candidates.find((n) => {
        const keys = [...images.values()].map((ts) => imageOf(ts, n))
        return keys.every((k) => k && byKey.has(k) && !taken.has(k)) && new Set(keys).size === keys.length
      })
      if (!pick) {
        // Дробить некуда — крупная фишка срезается до пяти.
        parts = [Math.min(5, parts[0] + extra.slice(extra.indexOf(value)).reduce((a, b) => a + b, 0))]
        targets.length = 0
        break
      }
      targets.push({ cell: pick, value })
      for (const ts of images.values()) taken.add(imageOf(ts, pick))
    }

    for (const [imgKey, ts] of images) {
      const img = byKey.get(imgKey)
      img.resourceToken = { ...img.resourceToken, value: parts[0], faceUp: true }
      for (const target of targets) {
        const cell = byKey.get(imageOf(ts, target.cell))
        cell.resourceToken = { type: token.type, value: target.value, faceUp: true }
      }
    }
  }

  const tokens = cells.filter((c) => c.resourceToken)
  const total = (type) => tokens.filter((c) => c.resourceToken.type === type).reduce((s, c) => s + c.resourceToken.value, 0)
  const values = {}
  for (const c of tokens) values[c.resourceToken.value] = (values[c.resourceToken.value] ?? 0) + 1
  console.log(
    `${id}: центров ${cells.filter((c) => c.isPowerCenter).length}, фишек ${tokens.length}`
      + ` (${Math.round((tokens.length / cells.length) * 100)} %), кредиты ${total('credits')},`
      + ` производство ${total('production')}, номиналы ${JSON.stringify(values)}, симметрий ${syms.length}`,
  )
  if (!DRY) writeFileSync(file, JSON.stringify(save, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
}

for (const [id, plan] of Object.entries(PLAN)) rework(id, plan)
