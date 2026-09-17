import type { ShipType } from '@galaxy/rules'

/**
 * Один корабль в заявке на постройку.
 *
 * Заявка собирается в окне маркера действия и уходит на страницу партии,
 * которая превращает её в размещения на клетке маркера.
 */
export type ShipBuildOrder = { type: ShipType }
