/**
 * Насколько каждый игрок близок к победе — для показа в интерфейсе.
 *
 * Победа берётся по центрам власти (раздел «Победа и поражение» рулбука).
 * Здесь только арифметика для показа: сколько центров власти у игрока и
 * сколько ему осталось до порога. Сам итог партии по-прежнему подводит
 * `victory.ts`, и решения этот модуль не принимает.
 *
 * Порог — поле карты `victoryPowerCenters` (ADR 015); у карт без него действует
 * запасное правило «строго больше половины». Само правило живёт в `victory.ts`.
 */
import type { GameSnapshot } from './save-file.js'
import type { MapDefinition } from './types.js'
import { victoryThresholdForSnapshot } from './victory.js'

/** Путь одного игрока к победе по центрам власти. */
export interface VictoryProgressEntry {
  playerId: string
  name: string
  color: string
  /** Центров власти под контролем сейчас */
  controlled: number
  /** Сколько центров власти осталось захватить до порога победы */
  remaining: number
  /** Порог уже набран */
  reached: boolean
  /** Игрок выбыл из партии — в гонке больше не участвует */
  eliminated: boolean
}

export interface VictoryProgress {
  /** Всего центров власти на карте */
  total: number
  /** Сколько центров власти нужно для победы */
  needed: number
  /** Игроки: сначала ближайшие к победе, выбывшие — в конце */
  entries: VictoryProgressEntry[]
}

function countPowerCentersOnMap(map: MapDefinition): number {
  return map.cells.reduce((n, cell) => n + (cell.isPowerCenter ? 1 : 0), 0)
}

/**
 * Сколько центров власти нужно для победы на этой карте: порог из карты, а если его нет —
 * строго больше половины всех центров власти.
 */
export function victoryThresholdFor(map: MapDefinition): number {
  const total = countPowerCentersOnMap(map)
  if (total <= 0) return 0
  if (map.victoryPowerCenters != null && map.victoryPowerCenters > 0) return map.victoryPowerCenters
  return Math.floor(total / 2) + 1
}

/**
 * Сколько центров власти у каждого игрока и сколько ему осталось до победы.
 *
 * Слоты карты, за которые никто не играет, пропускаются; выбывшие остаются в
 * списке отдельным состоянием, чтобы поле игроков было видно целиком. На карте
 * без центров власти победа по ним невозможна — список выходит пустым.
 */
export function victoryProgressForSnapshot(
  game: GameSnapshot,
  map: MapDefinition,
): VictoryProgress {
  const total = countPowerCentersOnMap(map)
  // Порог партии скопирован в снимок при старте: сверяемся с ним, а не с описанием карты.
  const needed = total > 0 ? victoryThresholdForSnapshot(game) : 0
  if (!needed) return { total, needed, entries: [] }

  // Считаем по живой доске, а не по описанию карты: контроль меняется в партии
  const controlledByPlayer = new Map<string, number>()
  for (const cell of game.cells) {
    if (!cell.isPowerCenter || !cell.controlOwnerId) continue
    controlledByPlayer.set(
      cell.controlOwnerId,
      (controlledByPlayer.get(cell.controlOwnerId) ?? 0) + 1,
    )
  }

  const participating = game.participatingPlayerIds?.length
    ? new Set(game.participatingPlayerIds)
    : null

  const entries = game.players
    .filter((player) => !participating || participating.has(player.id))
    .map((player) => {
      const controlled = controlledByPlayer.get(player.id) ?? 0
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        controlled,
        remaining: Math.max(0, needed - controlled),
        reached: controlled >= needed,
        eliminated: player.eliminated,
      }
    })

  // Ближе всех к победе — первым, выбывшие — в конце. Сортировка устойчивая,
  // поэтому при равенстве сохраняется порядок слотов карты.
  entries.sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1
    return b.controlled - a.controlled
  })

  return { total, needed, entries }
}
