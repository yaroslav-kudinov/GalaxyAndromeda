import type { GameSnapshot, HexCoord, MapDefinition, ShipPlacement, ShipType } from '@galaxy/rules'
import {
  SHIP_LABELS,
  getRegionForMarker,
  hexKey,
  validateProductionBatch,
  validateShipPlacements,
} from '@galaxy/rules'

export type ShipBuildOrder = { type: ShipType }

export function useProductionShipPick(
  snapshot: Ref<GameSnapshot | null>,
  map: Ref<MapDefinition | null>,
  playerId: Ref<string>,
) {
  const active = ref(false)
  const markerId = ref<string | null>(null)
  const orders = ref<ShipBuildOrder[]>([])
  const activeIndex = ref(0)
  const placements = ref<ShipPlacement[]>([])
  const error = ref<string | null>(null)

  const marker = computed(() => {
    if (!snapshot.value || !markerId.value) return null
    return snapshot.value.productionMarkers.find((m) => m.id === markerId.value) ?? null
  })

  const sourceKey = computed(() => {
    const m = marker.value
    return m ? hexKey(m.coord.q, m.coord.r) : null
  })

  const regionHexKeys = computed(() => {
    if (!snapshot.value || !map.value || !marker.value) return [] as string[]
    const region = getRegionForMarker(snapshot.value, map.value.id, marker.value)
    return region?.hexes ?? []
  })

  const activeOrder = computed(() => orders.value[activeIndex.value] ?? null)

  const allPlaced = computed(() => placements.value.length === orders.value.length)

  const activeShipLabel = computed(() => {
    const order = activeOrder.value
    return order ? SHIP_LABELS[order.type] : null
  })

  const bannerText = computed(() => {
    if (!active.value || !marker.value) return ''
    if (allPlaced.value) return 'Все корабли размещены — выполняем постройку…'
    const label = activeShipLabel.value ?? 'корабль'
    const pending = orders.value.length - placements.value.length
    const m = marker.value
    if (pending === 1) {
      return `Кликните клетку в регионе для «${label}» (маркер (${m.coord.q}, ${m.coord.r}))`
    }
    return `Кликните клетку для «${label}» · осталось ${pending} корабл(я/ей)`
  })

  const reachableKeys = computed(() => {
    if (!active.value || !snapshot.value || !map.value || !marker.value || allPlaced.value) {
      return [] as string[]
    }
    return regionHexKeys.value.filter((key) => canPlaceAtKey(key))
  })

  const destinationKeys = computed(() =>
    placements.value.map((p) => hexKey(p.coord.q, p.coord.r)),
  )

  function reset() {
    active.value = false
    markerId.value = null
    orders.value = []
    activeIndex.value = 0
    placements.value = []
    error.value = null
  }

  function start(id: string, shipOrders: ShipBuildOrder[]) {
    if (!shipOrders.length) return
    markerId.value = id
    orders.value = [...shipOrders]
    activeIndex.value = 0
    placements.value = []
    error.value = null
    active.value = true
  }

  function cancel() {
    reset()
  }

  function canPlaceAtKey(key: string): boolean {
    if (!snapshot.value || !map.value || !marker.value || !activeOrder.value) return false
    if (!regionHexKeys.value.includes(key)) return false

    const [q, r] = key.split(',').map(Number)
    const tentative: ShipPlacement[] = [
      ...placements.value,
      { type: activeOrder.value.type, coord: { q, r } },
    ]
    return (
      validateShipPlacements(snapshot.value, map.value.id, marker.value, tentative).length === 0
    )
  }

  function tryFinish(): { markerId: string; ships: ShipPlacement[] } | null {
    if (!snapshot.value || !map.value || !marker.value) return null
    if (!allPlaced.value) {
      activeIndex.value = placements.value.length
      return null
    }

    const plan = { markerId: marker.value.id, ships: [...placements.value] }
    const errors = validateProductionBatch(
      snapshot.value,
      map.value.id,
      playerId.value,
      plan,
    )
    if (errors.length) {
      error.value = errors[0] ?? null
      return null
    }

    const result = plan
    reset()
    return result
  }

  function assignPlacement(coord: HexCoord): { markerId: string; ships: ShipPlacement[] } | null {
    if (!activeOrder.value) return null
    placements.value = [
      ...placements.value,
      { type: activeOrder.value.type, coord },
    ]
    error.value = null
    activeIndex.value = placements.value.length
    return tryFinish()
  }

  function handleMapSelect(q: number, r: number): { markerId: string; ships: ShipPlacement[] } | null {
    if (!active.value || !marker.value || allPlaced.value) return null

    const key = hexKey(q, r)
    if (!canPlaceAtKey(key)) {
      error.value = 'На этой клетке нельзя разместить корабль'
      return null
    }

    return assignPlacement({ q, r })
  }

  return {
    active,
    markerId,
    marker,
    sourceKey,
    error,
    bannerText,
    reachableKeys,
    destinationKeys,
    orders,
    placements,
    activeIndex,
    activeShipLabel,
    allPlaced,
    regionHexKeys,
    start,
    cancel,
    handleMapSelect,
    tryFinish,
  }
}
