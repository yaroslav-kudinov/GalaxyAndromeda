import { trimGameEventLog } from './event-log.js'
import type { GameSnapshot } from './save-file.js'

export type ResourceRechargeTurns = 1 | 2 | 3

export const DEFAULT_RESOURCE_RECHARGE_TURNS: ResourceRechargeTurns = 2

/** @deprecated миграция старых сейвов; новые партии используют resourceRechargeTurnsRemaining */
export type ResourceRechargeInterval = ResourceRechargeTurns

export const DEFAULT_RESOURCE_RECHARGE_INTERVAL: ResourceRechargeInterval =
  DEFAULT_RESOURCE_RECHARGE_TURNS

export function normalizeResourceRechargeTurns(value: unknown): ResourceRechargeTurns | null {
  if (value === 1 || value === 2 || value === 3) return value
  return null
}

/** @deprecated используйте normalizeResourceRechargeTurns */
export function normalizeResourceRechargeInterval(value: unknown): ResourceRechargeInterval {
  return normalizeResourceRechargeTurns(value) ?? DEFAULT_RESOURCE_RECHARGE_TURNS
}

export function rollResourceRechargeTurns(rng: () => number = Math.random): ResourceRechargeTurns {
  const roll = Math.floor(rng() * 3)
  if (roll <= 0) return 1
  if (roll === 1) return 2
  return 3
}

function pluralTurns(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ход'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'хода'
  return 'ходов'
}

/** Текст для игрока: когда будет следующая автоперезарядка. */
export function formatResourceRechargePlayerHint(turnsRemaining: ResourceRechargeTurns): string {
  if (turnsRemaining === 1) {
    return 'Перезарядка фишек — в конце этого хода'
  }
  return `Перезарядка фишек через ${turnsRemaining} ${pluralTurns(turnsRemaining)}`
}

/** Крупный баннер: «До перезарядки ресурсов — N ходов». */
export function formatResourceRechargeBannerText(turnsRemaining: ResourceRechargeTurns): string {
  return `До перезарядки ресурсов — ${turnsRemaining} ${pluralTurns(turnsRemaining)}`
}

/** Переносит сохранённое значение или legacy-поле; случайный бросок не делает. */
export function migrateResourceRechargeSchedule(game: GameSnapshot): ResourceRechargeTurns | undefined {
  const current = normalizeResourceRechargeTurns(game.resourceRechargeTurnsRemaining)
  if (current != null) {
    game.resourceRechargeTurnsRemaining = current
    return current
  }

  const legacy = normalizeResourceRechargeTurns(
    (game as GameSnapshot & { resourceRechargeInterval?: unknown }).resourceRechargeInterval,
  )
  if (legacy != null) {
    game.resourceRechargeTurnsRemaining = legacy
    return legacy
  }

  delete game.resourceRechargeTurnsRemaining
  return undefined
}

/** Явный бросок интервала 1–3 (старт партии или сброс после перезарядки). */
export function rollNewResourceRechargeSchedule(
  game: GameSnapshot,
  rng: () => number = Math.random,
): ResourceRechargeTurns {
  const next = rollResourceRechargeTurns(rng)
  game.resourceRechargeTurnsRemaining = next
  return next
}

/**
 * @deprecated Используйте migrateResourceRechargeSchedule (без броска) или rollNewResourceRechargeSchedule.
 */
export function ensureResourceRechargeSchedule(
  game: GameSnapshot,
  _rng: () => number = Math.random,
): ResourceRechargeTurns | undefined {
  return migrateResourceRechargeSchedule(game)
}

/** Переворачивает все face-down фишки на контролируемых клетках. */
export function applyAutomaticResourceRecharge(game: GameSnapshot): number {
  let flipped = 0
  for (const cell of game.cells) {
    if (!cell.controlOwnerId) continue
    for (const token of cell.resourceTokens) {
      if (token.faceUp === false) {
        token.faceUp = true
        flipped += 1
      }
    }
  }
  return flipped
}

function appendRechargeScheduleEvent(
  game: GameSnapshot,
  message: string,
  type: 'recharge' | 'system' = 'recharge',
): void {
  game.eventLog.push({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: game.turnNumber,
    phase: game.phase,
    type,
    message,
    timestamp: Date.now(),
  })
  trimGameEventLog(game)
}

/**
 * В конце полного хода (переход «Действия» → «События»): уменьшает счётчик
 * или перезаряжает фишки и бросает новый интервал 1–3 хода.
 */
export function maybeApplyAutomaticResourceRecharge(
  game: GameSnapshot,
  rng: () => number = Math.random,
): void {
  const remaining = migrateResourceRechargeSchedule(game)
  if (remaining == null) return

  if (remaining > 1) {
    game.resourceRechargeTurnsRemaining = (remaining - 1) as ResourceRechargeTurns
    return
  }

  const flipped = applyAutomaticResourceRecharge(game)
  const next = rollNewResourceRechargeSchedule(game, rng)

  if (flipped > 0) {
    appendRechargeScheduleEvent(
      game,
      `Автоперезарядка фишек: перевёрнуто ${flipped}. Следующая через ${next} ${pluralTurns(next)}.`,
    )
  } else {
    appendRechargeScheduleEvent(
      game,
      `Автоперезарядка: перевёрнутых фишек не было. Следующая через ${next} ${pluralTurns(next)}.`,
      'system',
    )
  }
}
