import type { HexCoord, ShipPlacement, ShipType } from '@galaxy/rules'

export interface ProductionOrderSlot {
  index: number
  type: ShipType
  placed: boolean
  active: boolean
  coord: HexCoord | null
}

export interface ProductionPreviewShip {
  q: number
  r: number
  type: ShipType
  player: number
}

export function buildProductionOrderSlots(
  orders: { type: ShipType }[],
  placements: ShipPlacement[],
  options?: { confirming?: boolean },
): ProductionOrderSlot[] {
  const confirming = options?.confirming === true
  return orders.map((order, index) => ({
    index,
    type: order.type,
    placed: index < placements.length,
    active: !confirming && index === placements.length,
    coord: placements[index]?.coord ?? null,
  }))
}

export function placementsToPreviewShips(
  placements: ShipPlacement[],
  playerSlot: number,
): ProductionPreviewShip[] {
  return placements.map((placement) => ({
    q: placement.coord.q,
    r: placement.coord.r,
    type: placement.type,
    player: playerSlot,
  }))
}
