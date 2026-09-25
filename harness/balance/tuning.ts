/**
 * Подбор чисел без правки кода: профили уровней ботов (`--botTune`) и таблица доктрин (`--tune`).
 * Меняют таблицы только в текущем процессе — чтобы замерить вклад каждой черты.
 */

import { DOCTRINES } from '../../packages/rules/src/index.js'
import { BOT_PROFILES } from '../../packages/rules/src/bot-strategy.js'

/** `--botTune hard.denyShare=0.5,hard.reserveMarkers=false`. */
export function applyBotTuning(raw: string | undefined): void {
  if (!raw) return
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = entry.match(/^(medium|hard)\.(\w+)=([\w.-]+)$/)
    const profile = match ? BOT_PROFILES[match[1] as 'medium' | 'hard'] : null
    if (!match || !profile || !(match[2]! in profile)) throw new Error(`Не понял настройку бота: ${entry}`)
    const value = match[3] === 'true' ? true : match[3] === 'false' ? false : Number(match[3])
    ;(profile as unknown as Record<string, unknown>)[match[2]!] = value
  }
}

/** `--tune maneuvers.claimLimit=-2,attack.claimLimit=-1`; значение — число, true/false или классы через «|». */
export function applyDoctrineTuning(raw: string | undefined): void {
  if (!raw) return
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = entry.match(/^(\w+)\.(\w+)=([\w|-]+)$/)
    const doctrine = match && DOCTRINES.find((candidate) => candidate.id === match[1])
    if (!match || !doctrine) throw new Error(`Не понял настройку доктрины: ${entry}`)
    const text = match[3]!
    const value = text === 'true'
      ? true
      : text === 'false'
        ? false
        : /^-?\d+$/.test(text)
          ? Number(text)
          : text.split('|')
    ;(doctrine as unknown as Record<string, unknown>)[match[2]!] = value
  }
}
