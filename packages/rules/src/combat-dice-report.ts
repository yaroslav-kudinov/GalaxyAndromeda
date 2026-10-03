/**
 * Расшифровка кубиков стороны: откуда взялся каждый кубик в бою.
 *
 * Игрок видит «кубиков 3» и не понимает, из чего сложилась тройка: сколько дал корабль на
 * клетке боя, сколько пришло поддержкой с соседней клетки, сколько добавил авианосец. Эта
 * разбивка отвечает на вопрос и сразу показывает, если в прогноз попал не весь флот.
 */

import { type HexCoord, type ShipType } from './types.js'
import {
  combatSideShooters,
  type CombatPreview,
  type CombatRole,
  type CombatSidePreview,
} from './combat.js'

/** Один корабль в расшифровке кубиков. */
export interface CombatDiceSource {
  shipId: string
  type: ShipType
  ownerId: string
  /** 0 — стреляет с клетки боя; больше — поддержка или обстрел с расстояния. */
  distance: number
  /** Откуда стреляет, если не с клетки боя. */
  fromCoord?: HexCoord
  /** Кубиков всего, включая прибавку авианосца. */
  dice: number
  /** Из них от авианосца. */
  bonusDice: number
  /** Нужное на кубике значение. */
  threshold: number
}

/** Корабль в бою, который кубиков не даёт, — его тоже надо назвать, иначе он «пропал». */
export interface CombatSilentShip {
  shipId: string
  type: ShipType
  ownerId: string
  /** Почему не стреляет: класс без оружия (авианосец) или цель слишком близко (гиперорудие). */
  reason: 'no-weapon' | 'too-close' | 'destroyed'
}

export interface CombatDiceReport {
  role: CombatRole
  sources: CombatDiceSource[]
  silent: CombatSilentShip[]
  /** Кубиков всего — ровно столько сторона бросит в раунде. */
  total: number
}

/**
 * Разбивка кубиков стороны по кораблям. Порядок тот же, в каком сторона собирает кубики в
 * настоящем раунде: сначала корабли на клетке боя, затем поддержка.
 */
export function combatDiceReport(
  preview: CombatPreview,
  role: CombatRole,
  damageByShipId: Readonly<Record<string, number>> = {},
): CombatDiceReport {
  const side: CombatSidePreview = role === 'attacker' ? preview.attacker : preview.defender
  const silenced = preview.trigger === 'bombardment' && role === 'defender'
  const supportFrom = new Map(side.supportingShips.map((s) => [s.shipId, s.fromCoord]))

  const sources: CombatDiceSource[] = silenced
    ? []
    : combatSideShooters(side, damageByShipId).map((shooter) => {
        const bonusDice = side.ships.find((s) => s.shipId === shooter.shipId)?.bonusDice ?? 0
        const fromCoord = supportFrom.get(shooter.shipId)
        return {
          shipId: shooter.shipId,
          type: shooter.type,
          ownerId: shooter.ownerId,
          distance: shooter.distance,
          ...(fromCoord ? { fromCoord: { ...fromCoord } } : {}),
          dice: shooter.dice,
          bonusDice,
          threshold: shooter.threshold,
        }
      })

  const silent: CombatSilentShip[] = []
  for (const ship of side.ships) {
    if ((damageByShipId[ship.shipId] ?? ship.damage) >= ship.hull) {
      silent.push({ shipId: ship.shipId, type: ship.type, ownerId: ship.ownerId, reason: 'destroyed' })
      continue
    }
    if (silenced || ship.dice > 0) continue
    silent.push({
      shipId: ship.shipId,
      type: ship.type,
      ownerId: ship.ownerId,
      // Авианосец безоружен по классу; гиперорудию мешает минимальная дальность — цель в упор.
      reason: ship.type === 'carrier' ? 'no-weapon' : 'too-close',
    })
  }

  return {
    role,
    sources,
    silent,
    total: sources.reduce((sum, source) => sum + source.dice, 0),
  }
}
