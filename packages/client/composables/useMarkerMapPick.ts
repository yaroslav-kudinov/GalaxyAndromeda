import type { GameSnapshot, HexCoord, MapDefinition, ShipMovePlan } from '@galaxy/rules'
import {
  SHIP_LABELS,
  canDeclareControlForMove,
  getMovableShipsAtMarker,
  hexKey,
  validateDestinationForMove,
  validateMarkerMovement,
} from '@galaxy/rules'

export type MarkerPickAssignment = { to: HexCoord; declareControl: boolean }

export type PendingControlChoice = {
  shipId: string
  to: HexCoord
}

export function useMarkerMapPick(
  snapshot: Ref<GameSnapshot | null>,
  map: Ref<MapDefinition | null>,
  playerId: Ref<string>,
) {
  const active = ref(false)
  const source = ref<HexCoord | null>(null)
  const selectedShipIds = ref<string[]>([])
  const activeShipId = ref<string | null>(null)
  const assignments = ref<Record<string, MarkerPickAssignment>>({})
  const error = ref<string | null>(null)
  const pendingControlChoice = ref<PendingControlChoice | null>(null)

  const sourceKey = computed(() => {
    const s = source.value
    return s ? hexKey(s.q, s.r) : null
  })

  const shipOptions = computed(() => {
    if (!snapshot.value || !map.value || !source.value) return []
    return getMovableShipsAtMarker(snapshot.value, map.value, playerId.value, source.value)
  })

  const reachableKeys = computed(() => {
    if (!active.value || !activeShipId.value || pendingControlChoice.value) return [] as string[]
    const opt = shipOptions.value.find((o) => o.ship.id === activeShipId.value)
    return opt?.reachableKeys ?? []
  })

  const destinationKeys = computed(() =>
    Object.values(assignments.value).map((a) => hexKey(a.to.q, a.to.r)),
  )

  const allAssigned = computed(() =>
    selectedShipIds.value.every((id) => assignments.value[id] != null),
  )

  const activeShipLabel = computed(() => {
    if (!activeShipId.value) return null
    const ship = shipOptions.value.find((o) => o.ship.id === activeShipId.value)?.ship
    return ship ? SHIP_LABELS[ship.type] : null
  })

  const bannerText = computed(() => {
    if (!active.value || !source.value) return ''
    if (pendingControlChoice.value) {
      const { to } = pendingControlChoice.value
      return `Клетка (${to.q}, ${to.r}): занять её? Снабженец будет снят с карты.`
    }
    if (allAssigned.value) return 'Все корабли назначены — выполняем движение…'
    const label = activeShipLabel.value ?? 'корабль'
    const pending = selectedShipIds.value.filter((id) => !assignments.value[id]).length
    if (pending === 1) {
      return `Кликните клетку назначения для «${label}» (от (${source.value.q}, ${source.value.r}))`
    }
    return `Кликните клетку для «${label}» · осталось ${pending} корабл(я/ей)`
  })

  function reset() {
    active.value = false
    source.value = null
    selectedShipIds.value = []
    activeShipId.value = null
    assignments.value = {}
    error.value = null
    pendingControlChoice.value = null
  }

  function start(from: HexCoord, shipIds: string[]) {
    source.value = from
    selectedShipIds.value = [...shipIds]
    activeShipId.value = shipIds[0] ?? null
    assignments.value = {}
    error.value = null
    pendingControlChoice.value = null
    active.value = true
  }

  function cancel() {
    reset()
  }

  function cancelPendingControlChoice() {
    pendingControlChoice.value = null
    error.value = null
  }

  function destCell(coord: HexCoord) {
    if (!snapshot.value) return null
    const key = hexKey(coord.q, coord.r)
    return snapshot.value.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key) ?? null
  }

  function priorMovesFor(excludeShipId?: string): ShipMovePlan[] {
    return Object.entries(assignments.value)
      .filter(([shipId]) => shipId !== excludeShipId)
      .map(([shipId, plan]) => ({
        shipId,
        to: plan.to,
        declareControl: plan.declareControl,
      }))
  }

  function buildMoves(): ShipMovePlan[] {
    return selectedShipIds.value.map((id) => ({
      shipId: id,
      to: assignments.value[id]!.to,
      declareControl: assignments.value[id]!.declareControl || undefined,
    }))
  }

  function validateAll(): string | null {
    if (!snapshot.value || !map.value || !source.value) return 'Нет данных игры'
    const moves = buildMoves()
    const errors = validateMarkerMovement(
      snapshot.value,
      map.value,
      playerId.value,
      source.value,
      moves,
    )
    return errors[0] ?? null
  }

  function tryFinishPick(): { from: HexCoord; moves: ShipMovePlan[] } | null {
    const nextUnassigned = selectedShipIds.value.find((id) => !assignments.value[id])
    if (nextUnassigned) {
      activeShipId.value = nextUnassigned
      return null
    }

    const validationError = validateAll()
    if (validationError) {
      error.value = validationError
      return null
    }

    const from = source.value!
    const moves = buildMoves()
    reset()
    return { from, moves }
  }

  function assignShipDestination(shipId: string, to: HexCoord, declareControl: boolean) {
    assignments.value = {
      ...assignments.value,
      [shipId]: { to, declareControl },
    }
    error.value = null
    return tryFinishPick()
  }

  /** @returns from + moves when pick is complete and valid */
  function handleMapSelect(q: number, r: number): { from: HexCoord; moves: ShipMovePlan[] } | null {
    if (!active.value || !source.value || !activeShipId.value || pendingControlChoice.value) {
      return null
    }

    const shipOpt = shipOptions.value.find((o) => o.ship.id === activeShipId.value)
    if (!shipOpt) return null

    const to = { q, r }
    const errors = validateDestinationForMove(
      snapshot.value!,
      map.value!,
      playerId.value,
      shipOpt.ship,
      source.value,
      to,
      false,
      priorMovesFor(activeShipId.value),
    )
    if (errors.length) {
      error.value = errors[0] ?? null
      return null
    }

    const dest = destCell(to)
    if (dest && canDeclareControlForMove(shipOpt.ship, dest)) {
      pendingControlChoice.value = { shipId: activeShipId.value, to }
      error.value = null
      return null
    }

    return assignShipDestination(activeShipId.value, to, false)
  }

  function resolveControlChoice(occupy: boolean): { from: HexCoord; moves: ShipMovePlan[] } | null {
    const pending = pendingControlChoice.value
    if (!pending || !source.value) return null

    const shipOpt = shipOptions.value.find((o) => o.ship.id === pending.shipId)
    if (!shipOpt) return null

    const errors = validateDestinationForMove(
      snapshot.value!,
      map.value!,
      playerId.value,
      shipOpt.ship,
      source.value,
      pending.to,
      occupy,
      priorMovesFor(pending.shipId),
    )
    if (errors.length) {
      error.value = errors[0] ?? null
      pendingControlChoice.value = null
      return null
    }

    pendingControlChoice.value = null
    return assignShipDestination(pending.shipId, pending.to, occupy)
  }

  return {
    active,
    source,
    sourceKey,
    error,
    bannerText,
    reachableKeys,
    destinationKeys,
    assignments,
    selectedShipIds,
    activeShipId,
    activeShipLabel,
    allAssigned,
    shipOptions,
    pendingControlChoice,
    start,
    cancel,
    cancelPendingControlChoice,
    handleMapSelect,
    resolveControlChoice,
    destCell,
  }
}
