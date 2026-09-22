/**
 * Детерминизм для прогонов баланса.
 *
 * Движок не протягивает генератор случайных чисел через публичные действия: бой
 * (`movement.ts`), событие хода и перезарядка зовут `Math.random` напрямую, а идентификаторы
 * кораблей строятся на `Date.now()`. Тянуть `rng` через весь контракт ради харнесса — слишком
 * инвазивно, поэтому подменяем `Math.random` на время прогона. Это код харнесса, в продакшен
 * он не попадает.
 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Смешивает произвольную строку в сид — чтобы партии на разных картах не совпадали. */
export function mixSeed(seed: number, text: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Выполняет `fn` с подменённым `Math.random`. Восстанавливает оригинал даже при исключении,
 * иначе одна упавшая партия испортила бы весь прогон.
 */
export function withSeededRandom<T>(seed: number, fn: (rng: Rng) => T): T {
  const rng = mulberry32(seed)
  const original = Math.random
  Math.random = rng
  try {
    return fn(rng)
  } finally {
    Math.random = original
  }
}

export function pickWeighted<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(rng() * items.length)]
}
