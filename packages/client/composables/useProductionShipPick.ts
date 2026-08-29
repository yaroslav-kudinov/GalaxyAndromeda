import type { GameSnapshot, HexCoord, MapDefinition, ShipPlacement, ShipType } from '@galaxy/rules'
import {
  SHIP_LABELS,
  getRegionForMarker,
  hexKey,
  validateProductionBatch,
  validateShipPlacements,
} from '@galaxy/rules'
import { buildProductionOrderSlots } from '~/utils/production-order-slots'

export type ShipBuildOrder = { type: ShipType }

export function useProductionShipPick(
  snapshot: Ref<GameSnapshot | null>,
  map: Ref<MapDefinition | null>,
  playerId: Ref<string>,
) {
  const active = ref(false)
  const confirming = ref(false)
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

  const allPlaced = computed(() =>
    orders.value.length > 0 && placements.value.length === orders.value.length,
  )

  const activeShipLabel = computed(() => {
    const order = activeOrder.value
    return order ? SHIP_LABELS[order.type] : null
  })

  const orderSlots = computed(() =>
    buildProductionOrderSlots(orders.value, placements.value, {
      confirming: confirming.value,
    }),
  )

  const bannerText = computed(() => {
    if (!active.value || !marker.value || confirming.value) return ''
    const label = activeShipLabel.value ?? 'корабль'
    const pending = orders.value.length - placements.value.length
    const m = marker.value
    if (allPlaced.value) {
      return 'Все корабли на клетке маркера. Можно поменять расстановку или подтвердить постройку.'
    }
    if (pending === 1) {
      return `Кликните клетку маркера (${m.coord.q}, ${m.coord.r}) для «${label}»`
    }
    return `Кликните клетку маркера (${m.coord.q}, ${m.coord.r}) для «${label}» · осталось ${pending} кораблей`
  })

  const reachableKeys = computed(() => {
    if (!active.value || !snapshot.value || !map.value || !marker.value || allPlaced.value || confirming.value) {
      return [] as string[]
    }
    const key = sourceKey.value
    if (!key || !canPlaceAtKey(key)) return [] as string[]
    return [key]
  })

  const destinationKeys = computed(() =>
    placements.value.map((p) => hexKey(p.coord.q, p.coord.r)),
  )

  function reset() {
    active.value = false
    confirming.value = false
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
    confirming.value = false
    active.value = true
  }

  function cancel() {
    reset()
  }

  function canPlaceAtKey(key: string): boolean {
    if (!snapshot.value || !map.value || !marker.value || !activeOrder.value) return false
    if (key !== sourceKey.value) return false

    const [q, r] = key.split(',').map(Number)
    const tentative: ShipPlacement[] = [
      ...placements.value,
      { type: activeOrder.value.type, coord: { q, r } },
    ]
    return (
      validateShipPlacements(snapshot.value, map.value.id, marker.value, tentative).length === 0
    )
  }

  function validatedPlan(): { markerId: string; ships: ShipPlacement[] } | null {
    if (!snapshot.value || !map.value || !marker.value) return null
    if (!allPlaced.value) return null

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
    return plan
  }

  function enterConfirm(): boolean {
    if (!allPlaced.value) return false
    const plan = validatedPlan()
    if (!plan) return false
    error.value = null
    confirming.value = true
    return true
  }

  function backToPlacement() {
    confirming.value = false
    error.value = null
  }

  function confirm(): { markerId: string; ships: ShipPlacement[] } | null {
    if (!confirming.value) return null
    const plan = validatedPlan()
    if (!plan) return null
    reset()
    return plan
  }

  function undoFromIndex(index: number) {
    if (confirming.value) return
    if (index < 0 || index >= placements.value.length) return
    placements.value = placements.value.slice(0, index)
    activeIndex.value = placements.value.length
    error.value = null
  }

  function assignPlacement(coord: HexCoord): null {
    if (!activeOrder.value) return null
    placements.value = [
      ...placements.value,
      { type: activeOrder.value.type, coord },
    ]
    error.value = null
    activeIndex.value = placements.value.length
    if (allPlaced.value) enterConfirm()
    return null
  }

  function handleMapSelect(q: number, r: number): { markerId: string; ships: ShipPlacement[] } | null {
    if (!active.value || !marker.value || confirming.value || allPlaced.value) return null

    const key = hexKey(q, r)
    if (!canPlaceAtKey(key)) {
      error.value = 'На этой клетке нельзя разместить корабль'
      return null
    }

    return assignPlacement({ q, r })
  }

  /** Совместимость: раньше завершало заявку само. Теперь только вход в подтверждение. */
  function tryFinish(): { markerId: string; ships: ShipPlacement[] } | null {
    if (confirming.value) return confirm()
    enterConfirm()
    return null
  }

  return {
    active,
    confirming,
    markerId,
    marker,
    sourceKey,
    error,
    bannerText,
    reachableKeys,
    destinationKeys,
    orders,
    placements,
    orderSlots,
    activeIndex,
    activeShipLabel,
    allPlaced,
    regionHexKeys,
    start,
    cancel,
    handleMapSelect,
    tryFinish,
    confirm,
    backToPlacement,
    enterConfirm,
    undoFromIndex,
  }
}
