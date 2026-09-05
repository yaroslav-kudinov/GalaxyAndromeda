import type { ShipType } from './types.js'

/** Дальность хода по `packages/rules/data/ships.yaml` */
export const SHIP_MOVE_RANGE: Record<ShipType, number> = {
  destroyer: 3,
  cruiser: 2,
  battleship: 1,
  shield: 2,
  carrier: 1,
  hyper: 1,
}

export interface ShipProductionCost {
  credits: number
  production: number
}

/** Стоимость постройки по `packages/rules/data/ships.yaml` */
export const SHIP_PRODUCTION_COST: Record<ShipType, ShipProductionCost> = {
  destroyer: { credits: 2, production: 2 },
  cruiser: { credits: 5, production: 3 },
  battleship: { credits: 7, production: 6 },
  shield: { credits: 3, production: 4 },
  carrier: { credits: 6, production: 5 },
  hyper: { credits: 12, production: 12 },
}

/**
 * Минимальный размер региона для постройки (`ships.yaml` → productionRegionSize[0]).
 * Верхняя граница в yaml — справочная, не ограничивает постройку.
 */
export const SHIP_PRODUCTION_REGION_MIN: Record<ShipType, number> = {
  destroyer: 3,
  cruiser: 5,
  battleship: 18,
  shield: 12,
  carrier: 12,
  hyper: 21,
}

export function getShipMoveRange(type: ShipType): number {
  return SHIP_MOVE_RANGE[type]
}

export function getShipProductionCost(type: ShipType): ShipProductionCost {
  return SHIP_PRODUCTION_COST[type]
}

export function getShipProductionRegionMin(type: ShipType): number {
  return SHIP_PRODUCTION_REGION_MIN[type]
}

export function canBuildShipInRegionSize(type: ShipType, regionSize: number): boolean {
  return regionSize >= getShipProductionRegionMin(type)
}
