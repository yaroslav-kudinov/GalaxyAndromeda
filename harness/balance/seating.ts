/**
 * Как рассадить уровни ботов по местам партии.
 *
 * - `all` — один уровень на всех местах (`--difficulty`, по умолчанию лёгкий);
 * - `mix` — уровни по местам из `--mix player-1=hard`, остальным — `--difficulty`; с `--rotate`
 *   раскладка сдвигается на место от партии к партии;
 * - `solo` — одно место уровня `--solo` среди мест уровня `--difficulty` (по умолчанию среднего);
 *   место сдвигается от партии к партии. Это замер «против человека»: средний бот играет примерно
 *   как средний игрок, и доля побед одиночного места показывает, заметна ли разница уровней;
 * - `h2h` — уровни из `--h2h` чередуются по местам и сдвигаются от партии к партии: за серию
 *   каждый уровень сидит на каждом месте поровну, и преимущество места гасится.
 */

import { BOT_DIFFICULTIES, isBotDifficulty, type BotDifficulty } from '../../packages/rules/src/index.js'

export interface SeatingPlan {
  kind: 'all' | 'mix' | 'solo' | 'h2h'
  base: BotDifficulty
  mix: Record<string, BotDifficulty>
  rotate: boolean
  levels: BotDifficulty[]
  solo: BotDifficulty | null
}

function parseLevel(raw: string, flag: string): BotDifficulty {
  const value = raw.trim()
  if (!isBotDifficulty(value)) {
    throw new Error(`--${flag}: неизвестный уровень «${value}» (есть: ${BOT_DIFFICULTIES.join(', ')})`)
  }
  return value
}

export function parseSeating(flags: ReadonlyMap<string, string>): SeatingPlan {
  const solo = flags.has('solo') ? parseLevel(flags.get('solo')!, 'solo') : null
  const base = flags.has('difficulty') ? parseLevel(flags.get('difficulty')!, 'difficulty') : solo ? 'medium' : 'easy'
  const mix: Record<string, BotDifficulty> = {}
  for (const entry of (flags.get('mix') ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const [seat, level] = entry.split('=')
    if (!seat || !level) throw new Error(`--mix: не понял «${entry}», нужно место=уровень`)
    mix[seat.trim()] = parseLevel(level, 'mix')
  }
  const levels = (flags.get('h2h') ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    .map((level) => parseLevel(level, 'h2h'))
  if (levels.length === 1) throw new Error('--h2h: нужно хотя бы два уровня через запятую')
  const kind = levels.length ? 'h2h' : solo ? 'solo' : Object.keys(mix).length ? 'mix' : 'all'
  return { kind, base, mix, rotate: flags.has('rotate'), levels, solo }
}

/** Уровни по местам для партии номер `gameIndex`. */
export function seatDifficultyFor(plan: SeatingPlan, seats: readonly string[], gameIndex: number): Record<string, BotDifficulty> {
  const out: Record<string, BotDifficulty> = {}
  if (plan.kind === 'h2h') {
    seats.forEach((seat, index) => {
      out[seat] = plan.levels[(index + gameIndex) % plan.levels.length]!
    })
    return out
  }
  if (plan.kind === 'solo') {
    const soloSeat = gameIndex % seats.length
    seats.forEach((seat, index) => {
      out[seat] = index === soloSeat ? plan.solo! : plan.base
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

/** Короткое имя раскладки для меток замера: `solo-hard`, `h2h-hard-medium`, `all-medium`. */
export function seatingLabel(plan: SeatingPlan): string {
  if (plan.kind === 'h2h') return `h2h-${plan.levels.join('-')}`
  if (plan.kind === 'solo') return plan.base === 'medium' ? `solo-${plan.solo}` : `solo-${plan.solo}-among-${plan.base}`
  if (plan.kind === 'mix') return `mix-${Object.entries(plan.mix).map(([seat, level]) => `${seat}-${level}`).join('-')}`
  return `all-${plan.base}`
}
