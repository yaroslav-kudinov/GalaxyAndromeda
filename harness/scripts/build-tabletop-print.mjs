/**
 * Сборка настольного print-and-play: HTML + PDF.
 * Usage: pnpm tabletop:print
 *        (или pnpm exec tsx harness/scripts/build-tabletop-print.mjs)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = join(ROOT, 'docs/tabletop')
const HTML_PATH = join(OUT_DIR, 'print-and-play.html')
const PDF_PATH = join(OUT_DIR, 'Galaxy-Andromeda-print-and-play.pdf')

async function loadRules() {
  const candidates = [
    '../../packages/rules/src/index.ts',
    '../../packages/rules/dist/index.js',
  ]
  const failures = []
  for (const relative of candidates) {
    try {
      return await import(new URL(relative, import.meta.url).href)
    } catch (e) {
      failures.push(`${relative}: ${e.message}`)
    }
  }
  throw new Error(`Не удалось загрузить @galaxy/rules.\n  ${failures.join('\n  ')}`)
}

const rules = await loadRules()

const {
  EVENT_CARDS,
  EVENT_DECK_COPIES,
  EVENT_DECK_SIZE,
  PLAYER_COLORS,
  PLAYER_LABELS,
  SHIP_LABELS,
  SHIP_TYPES,
  MAX_FLEET_SIZE_PER_PLAYER,
  SHIP_MOVE_RANGE,
  SHIP_PRODUCTION_COST,
  SHIP_PRODUCTION_REGION_MIN,
  SHIP_DESTROY_COST,
  SHIP_COMBAT_DICE,
  SHIP_SUPPORT_DICE,
  SHIP_SUPPORT_DIE_FACES,
  SHIP_FIRE_RANGE_BOUNDS,
  DESTRUCTION_PRIORITY,
  SHIELD_ABSORB_SELF,
  SHIELD_ABSORB_NEIGHBOR,
} = rules

const SHIP_GLYPHS = {
  destroyer: { body: 'M0,-6.2 L6.2,0 L0,6.2 L-6.2,0 Z' },
  cruiser: { body: 'M0,-7.8 L7.8,0 L0,7.8 L-7.8,0 Z', accent: 'M-3.9,-3.9 L3.9,3.9' },
  battleship: {
    body: 'M0,-9.4 L9.4,0 L0,9.4 L-9.4,0 Z',
    accent: 'M-5.6,-2.8 L2.8,5.6 M-2.8,-5.6 L5.6,2.8',
  },
  shield: { body: 'M0,9 L9,-6.5 L-9,-6.5 Z' },
  hyper: {
    body: 'M0,-10.5 L2.4,-2.4 L10.5,0 L2.4,2.4 L0,10.5 L-2.4,2.4 L-10.5,0 L-2.4,-2.4 Z',
  },
  supply: { body: 'M-7,-7 L7,-7 L7,7 L-7,7 Z' },
}

const PIP_LAYOUTS = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
  ],
  3: [
    { x: -0.52, y: -0.52 },
    { x: 0, y: 0 },
    { x: 0.52, y: 0.52 },
  ],
  4: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ],
  5: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0, y: 0 },
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ],
  6: [
    { x: -0.56, y: -0.72 },
    { x: -0.56, y: 0 },
    { x: -0.56, y: 0.72 },
    { x: 0.56, y: -0.72 },
    { x: 0.56, y: 0 },
    { x: 0.56, y: 0.72 },
  ],
  7: [
    { x: 0, y: 0 },
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 90)
      return { x: 0.68 * Math.cos(a), y: 0.68 * Math.sin(a) }
    }),
  ],
  8: [
    { x: -0.66, y: -0.66 },
    { x: 0, y: -0.66 },
    { x: 0.66, y: -0.66 },
    { x: -0.66, y: 0.66 },
    { x: 0, y: 0.66 },
    { x: 0.66, y: 0.66 },
    { x: -0.66, y: 0 },
    { x: 0.66, y: 0 },
  ],
  9: [
    { x: -0.66, y: -0.66 },
    { x: 0, y: -0.66 },
    { x: 0.66, y: -0.66 },
    { x: -0.66, y: 0 },
    { x: 0, y: 0 },
    { x: 0.66, y: 0 },
    { x: -0.66, y: 0.66 },
    { x: 0, y: 0.66 },
    { x: 0.66, y: 0.66 },
  ],
}

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function hexCenter(q, r, size) {
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + q / 2),
  }
}

function hexPoints(q, r, size) {
  const { x, y } = hexCenter(q, r, size)
  const pts = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i)
    pts.push(`${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

function loadMap(id) {
  return JSON.parse(readFileSync(join(ROOT, 'maps', `${id}.json`), 'utf8'))
}

function renderResourceGlyph(type, value, r = 11) {
  const pips = PIP_LAYOUTS[value] ?? PIP_LAYOUTS[1]
  const pip = type === 'credits' ? '#FACC15' : '#FB923C'
  const stroke = type === 'credits' ? '#854D0E' : '#9A3412'
  const spread = r * 0.52
  const pipR = r * 0.14
  const pipsSvg = pips
    .map((p) => {
      const px = p.x * spread
      const py = p.y * spread
      if (type === 'production') {
        const h = pipR * 0.88
        return `<rect x="${px - h}" y="${py - h}" width="${h * 2}" height="${h * 2}" fill="${pip}" stroke="${stroke}" stroke-width="0.4"/>`
      }
      return `<circle cx="${px}" cy="${py}" r="${pipR}" fill="${pip}" stroke="${stroke}" stroke-width="0.4"/>`
    })
    .join('')
  const body =
    type === 'production'
      ? `<rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="2" fill="#EDE8DC" stroke="#9C8B6E" stroke-width="1.2"/>`
      : `<circle r="${r}" fill="#EDE8DC" stroke="#9C8B6E" stroke-width="1.2"/>`
  return `${body}${pipsSvg}`
}

function renderShipGlyph(type, color, scale = 1) {
  const g = SHIP_GLYPHS[type]
  const accent = g.accent
    ? `<path d="${g.accent}" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="square"/>`
    : ''
  return `<g transform="scale(${scale})"><path d="${g.body}" fill="${color}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>${accent}</g>`
}

function renderMapSvg(map, { hexSize = 28, showSetup = true } = {}) {
  const cells = map.cells
  const centers = cells.map((c) => hexCenter(c.q, c.r, hexSize))
  const xs = centers.map((p) => p.x)
  const ys = centers.map((p) => p.y)
  const pad = hexSize * 1.2
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad
  const hexes = cells
    .map((c) => {
      const { x, y } = hexCenter(c.q, c.r, hexSize)
      const fill = c.startPlayer ? `${PLAYER_COLORS[c.startPlayer]}33` : '#f4f1ea'
      const stroke = c.startPlayer ? PLAYER_COLORS[c.startPlayer] : '#5b5346'
      const token = c.resourceToken
        ? `<g transform="translate(${x},${y + (c.isPowerCenter ? 4 : 0)})">${renderResourceGlyph(c.resourceToken.type, c.resourceToken.value, hexSize * 0.32)}</g>`
        : ''
      const crown = c.isPowerCenter
        ? `<g transform="translate(${x},${y - hexSize * 0.46})"><polygon points="0,-5.2 -5.4,3.2 -2.2,3.2 -2.2,6.2 2.2,6.2 2.2,3.2 5.4,3.2" fill="#EAB308" stroke="#854D0E" stroke-width="0.7"/></g>`
        : ''
      const ships = (c.startingShips ?? [])
        .map((s, i) => {
          const n = c.startingShips.length
          const ox = n === 1 ? 0 : (i - (n - 1) / 2) * (hexSize * 0.42)
          return `<g transform="translate(${x + ox},${y + hexSize * 0.42})">${renderShipGlyph(s.type, PLAYER_COLORS[s.player], hexSize / 38)}</g>`
        })
        .join('')
      const label = `<text x="${x}" y="${y + hexSize * 0.78}" text-anchor="middle" font-size="${Math.max(6, hexSize * 0.22)}" fill="#6b6358">${c.q},${c.r}</text>`
      return `<polygon points="${hexPoints(c.q, c.r, hexSize)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>${crown}${token}${showSetup ? ships : ''}${label}`
    })
    .join('')
  return `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg" class="map-svg">${hexes}</svg>`
}

function combatCell(type) {
  const n = SHIP_COMBAT_DICE[type]
  return n ? `${n}d6` : '—'
}

function supportCell(type) {
  const n = SHIP_SUPPORT_DICE[type]
  const faces = SHIP_SUPPORT_DIE_FACES[type]
  const bounds = SHIP_FIRE_RANGE_BOUNDS[type]
  if (type === 'shield') return `щит ${SHIELD_ABSORB_SELF} / сосед ${SHIELD_ABSORB_NEIGHBOR}`
  if (!n || !faces || !bounds) return '—'
  const range = bounds.min === bounds.max ? String(bounds.max) : `${bounds.min}–${bounds.max}`
  return `${n}d${faces}, дальн. ${range}`
}

function costCell(type) {
  const c = SHIP_PRODUCTION_COST[type]
  return `${c.credits} кред. + ${c.production} произв.`
}

function regionCell(type) {
  const min = SHIP_PRODUCTION_REGION_MIN[type]
  if (type === 'hyper') return `от ${min}`
  if (type === 'supply') return `${min}–2`
  return `${min}–${min + 1}`
}

function shipTableRows() {
  const order = ['destroyer', 'cruiser', 'battleship', 'shield', 'hyper', 'supply']
  return order
    .map((type) => {
      const cells = [
        SHIP_LABELS[type],
        SHIP_MOVE_RANGE[type],
        combatCell(type),
        supportCell(type),
        SHIP_DESTROY_COST[type],
        MAX_FLEET_SIZE_PER_PLAYER[type],
        costCell(type),
        regionCell(type),
      ]
      return `<tr>${cells.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`
    })
    .join('')
}

function eventRows() {
  const cards = [...EVENT_CARDS].sort(
    (a, b) => (EVENT_DECK_COPIES[b.id] ?? 1) - (EVENT_DECK_COPIES[a.id] ?? 1) || a.name.localeCompare(b.name, 'ru'),
  )
  return cards
    .map((c) => {
      const copies = EVENT_DECK_COPIES[c.id] ?? 1
      return `<tr><td>${esc(c.name)}</td><td class="num">${copies}</td><td>${esc(c.description)}</td></tr>`
    })
    .join('')
}

function eventCardFaces() {
  const faces = []
  for (const card of EVENT_CARDS) {
    const copies = EVENT_DECK_COPIES[card.id] ?? 1
    for (let i = 1; i <= copies; i++) {
      faces.push({ card, copy: i, copies })
    }
  }
  return faces
    .map(
      ({ card, copy, copies }) => `
<article class="event-card">
  <div class="event-card-inner">
    <p class="event-kicker">Событие · ${copy}/${copies}</p>
    <h3>${esc(card.name)}</h3>
    <p class="event-body">${esc(card.description)}</p>
    <p class="event-foot">Galaxy Andromeda · колода ${EVENT_DECK_SIZE}</p>
  </div>
</article>`,
    )
    .join('')
}

function eventCardBacks() {
  const n = EVENT_DECK_SIZE
  return Array.from({ length: n }, () => `
<article class="event-card event-back">
  <div class="event-card-inner">
    <p class="event-kicker">Galaxy Andromeda</p>
    <h3>Событие</h3>
    <p class="event-body">Снимите в фазе «События». Действует на всех до конца хода.</p>
  </div>
</article>`).join('')
}

function tokenChip(type, value, faceUp = true) {
  const label = type === 'credits' ? 'Кред.' : 'Произв.'
  const shape = type === 'production' ? 'square' : 'round'
  const faceClass = faceUp ? 'up' : 'down'
  const inner = faceUp
    ? `<svg viewBox="-14 -14 28 28">${renderResourceGlyph(type, value, 12)}</svg><span>${label} ${value}</span>`
    : `<span class="face-down-mark">✕</span><span>рубашка</span>`
  return `<div class="chip ${shape} ${faceClass} ${type}">${inner}</div>`
}

function resourceSheets() {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const maps = [loadMap('duel-2p'), loadMap('tts-reference')]
  const needed = { credits: {}, production: {} }
  for (const map of maps) {
    for (const cell of map.cells) {
      const t = cell.resourceToken
      if (!t) continue
      needed[t.type][t.value] = (needed[t.type][t.value] ?? 0) + 1
    }
  }
  const extras = 2
  const blocks = []
  for (const type of ['credits', 'production']) {
    const title = type === 'credits' ? 'Кредиты (круг)' : 'Производство (квадрат)'
    const chips = []
    for (const value of values) {
      const count = Math.max(needed[type][value] ?? 0, 1) + extras
      for (let i = 0; i < count; i++) chips.push(tokenChip(type, value, true))
    }
    for (let i = 0; i < 12; i++) chips.push(tokenChip(type, 1, false))
    blocks.push(`<h3>${title}</h3><div class="chip-grid">${chips.join('')}</div>`)
  }
  return blocks.join('')
}

function markerSheets() {
  const action = []
  const prod = []
  const control = []
  const order = []
  for (let p = 1; p <= 6; p++) {
    const color = PLAYER_COLORS[p]
    const name = PLAYER_LABELS[p]
    for (let i = 1; i <= 6; i++) {
      action.push(
        `<div class="marker action" style="--c:${color}"><span>Д${i}</span><small>${esc(name)}</small></div>`,
      )
    }
    for (let i = 1; i <= 3; i++) {
      prod.push(
        `<div class="marker production" style="--c:${color}"><span>П${i}</span><small>${esc(name)}</small></div>`,
      )
    }
    for (let i = 0; i < 18; i++) {
      control.push(`<div class="control-disc" style="--c:${color}" title="${esc(name)}"></div>`)
    }
    order.push(
      `<div class="order-chip" style="--c:${color}"><span>${p}</span><small>${esc(name)}</small></div>`,
    )
  }
  return `
<h3>Маркеры действия (6 на игрока)</h3>
<div class="marker-grid">${action.join('')}</div>
<h3>Маркеры производства (до 3 на игрока)</h3>
<div class="marker-grid">${prod.join('')}</div>
<h3>Жетоны контроля (клетка принадлежит цвету)</h3>
<div class="control-grid">${control.join('')}</div>
<h3>Жетоны порядка хода (перемешивать каждый игровой ход)</h3>
<div class="marker-grid">${order.join('')}</div>`
}

function shipSheets() {
  const blocks = []
  for (const type of SHIP_TYPES) {
    const cap = MAX_FLEET_SIZE_PER_PLAYER[type]
    const label = SHIP_LABELS[type]
    const tokens = []
    for (let p = 1; p <= 3; p++) {
      for (let i = 0; i < cap; i++) {
        tokens.push(`
<div class="ship-chit" style="--c:${PLAYER_COLORS[p]}">
  <svg viewBox="-12 -12 24 24">${renderShipGlyph(type, PLAYER_COLORS[p], 1)}</svg>
  <span>${esc(label)}</span>
  <small>${esc(PLAYER_LABELS[p])}</small>
</div>`)
      }
    }
    blocks.push(`<h3>${esc(label)} — полный лимит на 3 игроков (слоты 1–3). Для 4–6 игроков распечатайте лист ещё раз и перекрасьте.</h3><div class="ship-grid">${tokens.join('')}</div>`)
  }
  return blocks.join('')
}

function legendForMap(map) {
  const starts = new Map()
  let power = 0
  let tokens = 0
  for (const c of map.cells) {
    if (c.isPowerCenter) power++
    if (c.resourceToken) tokens++
    if (c.startPlayer) {
      const list = starts.get(c.startPlayer) ?? []
      list.push(`${c.q},${c.r}`)
      starts.set(c.startPlayer, list)
    }
  }
  const startLines = [...starts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, coords]) => `<li><span class="swatch" style="background:${PLAYER_COLORS[p]}"></span> ${esc(PLAYER_LABELS[p])}: ${coords.join('; ')}</li>`)
    .join('')
  const ships = map.cells.flatMap((c) =>
    (c.startingShips ?? []).map((s) => `${PLAYER_LABELS[s.player]}: ${SHIP_LABELS[s.type]} на ${c.q},${c.r}`),
  )
  const shipLine = ships.length
    ? `<p>Стартовые корабли: ${esc(ships.join('; '))}.</p>`
    : `<p>Стартовых кораблей в файле карты нет. За столом каждый ставит <strong>1 корабль снабжения и 1 эсминец</strong> на любую свою стартовую клетку (лучше с фишкой кредитов).</p>`
  return `
<ul class="map-meta">
  <li>Клеток: ${map.cells.length}</li>
  <li>Центров власти: ${power}</li>
  <li>Фишек ресурсов: ${tokens}</li>
</ul>
<p>Стартовые клетки:</p>
<ul class="start-list">${startLines}</ul>
${shipLine}`
}

const duel = loadMap('duel-2p')
const tts = loadMap('tts-reference')

const css = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", "Noto Sans", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.35;
  color: #1c1917;
  background: #fff;
}
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; page-break-after: avoid; }
h1 { font-size: 22pt; margin: 0 0 0.4em; }
h2 { font-size: 15pt; margin: 1.1em 0 0.4em; border-bottom: 1.5px solid #1c1917; padding-bottom: 0.15em; }
h3 { font-size: 12pt; margin: 0.9em 0 0.35em; }
p, li { orphans: 3; widows: 3; }
.cover { min-height: 90vh; display: flex; flex-direction: column; justify-content: center; }
.muted { color: #57534e; }
.note { background: #f5f0e6; border-left: 4px solid #b45309; padding: 0.5em 0.7em; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 0.4em 0 0.8em; }
th, td { border: 1px solid #a8a29e; padding: 0.22em 0.4em; vertical-align: top; }
th { background: #e7e5e4; text-align: left; }
td.num { text-align: center; width: 3em; }
ol, ul { margin: 0.3em 0 0.7em; padding-left: 1.3em; }
.page-break { break-before: page; page-break-before: always; }
.avoid-break { break-inside: avoid; page-break-inside: avoid; }
.map-wrap { width: 100%; }
.map-svg { width: 100%; height: auto; max-height: 230mm; }
.map-meta, .start-list { margin: 0.3em 0; }
.swatch { display: inline-block; width: 0.8em; height: 0.8em; border: 1px solid #111; vertical-align: middle; margin-right: 0.3em; }
.event-sheet { display: grid; grid-template-columns: repeat(3, 63mm); gap: 6mm; justify-content: center; }
.event-card {
  width: 63mm; height: 88mm; border: 0.4mm dashed #78716c; padding: 2mm;
  break-inside: avoid; page-break-inside: avoid;
}
.event-card-inner {
  height: 100%; border: 1.4pt solid #1c1917; border-radius: 3mm; padding: 4mm;
  display: flex; flex-direction: column;
}
.event-back .event-card-inner { background: #1e293b; color: #f8fafc; border-color: #0f172a; }
.event-kicker { font-size: 8pt; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 0.4em; }
.event-card h3 { font-size: 13pt; margin: 0 0 0.5em; border: 0; }
.event-body { flex: 1; font-size: 10.5pt; }
.event-foot { font-size: 8pt; color: #57534e; margin: 0; }
.event-back .event-foot, .event-back .event-kicker { color: #cbd5e1; }
.chip-grid, .ship-grid, .marker-grid, .control-grid {
  display: flex; flex-wrap: wrap; gap: 3mm; margin: 0.4em 0 1em;
}
.chip {
  width: 22mm; height: 26mm; border: 0.4mm dashed #78716c; display: flex;
  flex-direction: column; align-items: center; justify-content: center; font-size: 7.5pt;
  break-inside: avoid;
}
.chip svg { width: 16mm; height: 16mm; }
.chip.square svg { width: 15mm; height: 15mm; }
.chip.down { background: #334155; color: #e2e8f0; }
.face-down-mark { font-size: 16pt; line-height: 1; }
.ship-chit {
  width: 24mm; height: 28mm; border: 0.4mm dashed #78716c; background: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 7pt; text-align: center; break-inside: avoid;
}
.ship-chit svg { width: 14mm; height: 14mm; }
.marker {
  width: 22mm; height: 22mm; border: 0.5mm dashed #78716c; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--c); color: #fff; font-weight: 700; break-inside: avoid;
  text-shadow: 0 0 2px #000;
}
.marker.production { border-radius: 3mm; }
.marker small, .order-chip small, .ship-chit small { font-weight: 500; font-size: 6.5pt; }
.order-chip {
  width: 24mm; height: 16mm; border: 0.5mm dashed #78716c; background: var(--c);
  color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-weight: 700; break-inside: avoid;
}
.control-disc {
  width: 10mm; height: 10mm; border-radius: 50%; background: var(--c);
  border: 0.4mm dashed #111; break-inside: avoid;
}
.cut-hint { font-size: 9pt; color: #57534e; }
@page { size: A4; margin: 12mm; }
@media print {
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  a { color: inherit; text-decoration: none; }
}
`

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Galaxy Andromeda — print-and-play</title>
  <style>${css}</style>
</head>
<body>
<section class="cover">
  <p class="muted">Настольный снимок цифрового билда · 24 августа 2026</p>
  <h1>Galaxy Andromeda</h1>
  <p>Print-and-play: правила, карты поля, колода событий (${EVENT_DECK_SIZE} карт), фишки, маркеры и корабли.</p>
  <p>Баланс B+F. Источник механики: пакет <code>@galaxy/rules</code>. Цифровое лобби за столом не используется.</p>
  <p class="note">Карта «Всё для фронта» по движку: каждый игрок может потратить <strong>не более 3 фишек производства</strong> за ход (не «+3 фишки на карту»).</p>
</section>

<section>
  <h2>Как пользоваться комплектом</h2>
  <ol>
    <li>Распечатайте PDF в цвете на A4. Карты поля — на плотной бумаге.</li>
    <li>Разрежьте карты событий, фишки и маркеры по пунктиру.</li>
    <li>Нужны кубики: несколько <strong>d6</strong> (бой на клетке) и <strong>d4</strong> (поддержка и обстрел).</li>
    <li>Положите фишки ресурсов поверх напечатанных на карте — их нужно переворачивать.</li>
    <li>Корабли слотов 1–3 (синий, зелёный, красный) — полный лимит флота. Для 4–6 игроков допечатайте листы кораблей.</li>
  </ol>
</section>

<section>
  <h2>Подготовка партии</h2>
  <ol>
    <li>Выберите карту: дуэль (2 игрока) или TTS (3 игрока).</li>
    <li>Каждый берёт цвет слота и жетоны контроля. Положите контроль на все свои стартовые клетки.</li>
    <li>Поставьте стартовые корабли (на дуэли они уже показаны на карте; на TTS — снабжение + эсминец на домашнюю клетку).</li>
    <li>Перемешайте колоду событий.</li>
    <li>В начале каждого игрового хода перемешайте жетоны порядка хода — очередь на все четыре фазы.</li>
  </ol>
</section>

<section>
  <h2>Победа и поражение</h2>
  <p>Победа — любое одно условие. Проверка после смены контроля, боя и конца производства.</p>
  <ol>
    <li>4 отдельных связных региона, каждый не меньше 7 клеток.</li>
    <li>Строго больше половины всех центров власти на карте (включая нейтральные).</li>
    <li>Единственный невыбывший игрок с кораблями или контролем.</li>
  </ol>
  <p>Поражение: потеряны все ваши центры власти. Игрок выбывает.</p>
</section>

<section>
  <h2>Карта, контроль, снабжение</h2>
  <ul>
    <li>Соседство — только по граням. Регион — связная группа ваших клеток.</li>
    <li>Кредиты — круглые фишки 1–9. Производство — квадратные 1–9. Центр власти — корона на клетке, не фишка кредитов.</li>
    <li>Не больше 4 ваших кораблей на клетке и не больше 8 кораблей всего.</li>
    <li>Цепочка снабжения — все ваши соседние контролируемые клетки в одной связной группе. Оплату производства можно брать с любой клетки той же цепочки. Новые корабли — только в регион маркера.</li>
    <li><strong>Мирный вход</strong> на клетку без вражеского боевого флота захватывает контроль и снимает чужой маркер производства. Отступление контроль назначения не меняет.</li>
    <li>Движение: путь по существующим гексам, не через дыры, не через вражеские корабли/контроль; вход на врага — только последним шагом.</li>
    <li>Дальность поддержки и обстрела — осевое расстояние, не обход дыр.</li>
  </ul>
</section>

<section>
  <h2>Корабли</h2>
  <table>
    <thead>
      <tr>
        <th>Тип</th><th>Ход</th><th>Бой</th><th>Поддержка / обстрел</th>
        <th>Цена</th><th>Лимит</th><th>Стоимость</th><th>Регион</th>
      </tr>
    </thead>
    <tbody>${shipTableRows()}</tbody>
  </table>
  <p>Приоритет уничтожения: ${DESTRUCTION_PRIORITY.map((t) => SHIP_LABELS[t]).join(' → ')}.</p>
</section>

<section>
  <h2>Бой</h2>
  <p>Бой только если на клетке есть вражеский корабль не типа «корабль снабжения».</p>
  <ol>
    <li>Подготовка сторон. Третья сторона с поддержкой в дальности направляет все такие корабли атакующему, защитнику или никому.</li>
    <li>Пропуск приоритета до броска, без оплаты, только этот раунд: типы противника по цепочке среди присутствующих. Последний присутствующий тип пропускать нельзя. При победе каждый пропущенный тип дороже на +1.</li>
    <li>На клетке — d6, поддержка с дистанции — d4.</li>
    <li>Победитель — большая сумма. Очки уничтожения = разница сумм. Щиты проигравшего вычитаются. Победитель выбирает цели в бюджете и приоритете. Лишние очки сгорают.</li>
  </ol>
  <p>Пример: 15 против 7 → 8 очков; щит на клетке −4 → 4 на уничтожение.</p>
  <ul>
    <li>Пока никто не уничтожен — отступать нельзя.</li>
    <li>После первого уничтожения: атакующий, затем защитник — продолжить или отступить. Следующий раунд только если оба продолжили.</li>
    <li>Отступление: соседняя клетка без вражеских кораблей. Контроль назначения не меняется. «Стоять насмерть!» запрещает отступление.</li>
    <li>Маркер действия снимается, если на клетке не осталось кораблей владельца маркера.</li>
    <li>Победа атакующего в бою движением: корабли входят, контроль переходит, чужой маркер производства снимается.</li>
  </ul>
  <h3>Обстрел</h3>
  <ul>
    <li>Крейсер, линкор, гиперпространственное орудие — по клетке в дальности без входа. Орудие: строго 2–3.</li>
    <li>Несколько клеток за один маркер. Защитник не бросает. Очки = сумма броска. Клетка не захватывается.</li>
  </ul>
</section>

<section>
  <h2>Производство и маркеры</h2>
  <ul>
    <li>Оплата фишками лицом вверх из цепочки; потраченные — рубашкой вверх.</li>
    <li>За маркер: постройка или перезарядка, не оба. Перезарядка переворачивает все фишки цепочки лицом вверх.</li>
    <li>Маркеры действия: до 6, один на клетку с вашим кораблём.</li>
    <li>Маркер производства: регион от 3 клеток, один на регион. Второй маркер — при 3 регионах по 4+ клетки; третий — при 5 таких регионах.</li>
    <li>Снятие маркера в действиях или производстве считается ходом этого круга.</li>
  </ul>
</section>

<section>
  <h2>Фазы хода</h2>
  <p>События → Планирование → Действия → Производство. Очередь хода одна на весь игровой ход (перемешать жетоны в начале хода).</p>
  <ol>
    <li><strong>События.</strong> Верхняя карта колоды на всех. Пустая колода — полный комплект заново перемешать.</li>
    <li><strong>Планирование.</strong> По очереди маркеры действия, затем производства. Корабли не двигаются.</li>
    <li><strong>Действия.</strong> Пока есть маркеры действия: один маркер за ход — исполнить (ход и/или обстрел) или снять.</li>
    <li><strong>Производство.</strong> Пока есть маркеры: построить, перезарядить или снять. Пропустить нельзя.</li>
  </ol>
</section>

<section>
  <h2>Колода событий (${EVENT_DECK_SIZE} карт)</h2>
  <table>
    <thead><tr><th>Карта</th><th>Копий</th><th>Эффект</th></tr></thead>
    <tbody>${eventRows()}</tbody>
  </table>
</section>

<section class="page-break">
  <h2>Карта: ${esc(duel.name)}</h2>
  ${legendForMap(duel)}
  <div class="map-wrap">${renderMapSvg(duel, { hexSize: 34 })}</div>
</section>

<section class="page-break">
  <h2>Карта: ${esc(tts.name)}</h2>
  ${legendForMap(tts)}
  <div class="map-wrap">${renderMapSvg(tts, { hexSize: 22 })}</div>
</section>

<section class="page-break">
  <h2>Карты событий — лица</h2>
  <p class="cut-hint">Режьте по пунктиру. Рубашки — на следующем листе (при односторонней печати положите спина к спине и склейте).</p>
  <div class="event-sheet">${eventCardFaces()}</div>
</section>

<section class="page-break">
  <h2>Карты событий — рубашки</h2>
  <div class="event-sheet">${eventCardBacks()}</div>
</section>

<section class="page-break">
  <h2>Фишки ресурсов</h2>
  <p class="cut-hint">Лицом вверх — на карту по номиналу гекса. Рубашка закрывает потраченную или перевёрнутую фишку.</p>
  ${resourceSheets()}
</section>

<section class="page-break">
  <h2>Маркеры и контроль</h2>
  ${markerSheets()}
</section>

<section class="page-break">
  <h2>Корабли</h2>
  <p class="cut-hint">Силуэт как в цифровой версии. Полный лимит флота на игрока: эсминец 16, снабжение 10, крейсер 12, линкор 6, щитоносец 4, гиперпространственное орудие 2.</p>
  ${shipSheets()}
</section>
</body>
</html>
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(HTML_PATH, html, 'utf8')
console.log(`HTML: ${HTML_PATH}`)

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function printPdf() {
  const browser = findBrowser()
  if (!browser) {
    console.warn('Браузер Chrome/Edge не найден. Откройте HTML и сохраните как PDF вручную.')
    return false
  }
  const fileUrl = pathToFileURL(HTML_PATH).href
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      `--print-to-pdf=${PDF_PATH}`,
      fileUrl,
    ],
    { stdio: 'inherit' },
  )
  console.log(`PDF: ${PDF_PATH}`)
  return true
}

printPdf()
