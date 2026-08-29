import type {
  BombardableShipOption,
  BombardmentPlan,
  GameSnapshot,
  HexCoord,
  MapDefinition,
  MovableShipOption,
  ShipMovePlan,
} from '@galaxy/rules'
import {
  SHIP_LABELS,
  canDeclareControlForMove,
  getBombardableShipsAtMarker,
  getMovableShipsAtMarker,
  hexKey,
  isCombatDestination,
  validateBombardmentTarget,
  validateDestinationForMove,
  validateMarkerBombardment,
  validateMarkerMovement,
} from '@galaxy/rules'
import {
  useActionOrderDraft,
  type MarkerActionMode,
  type MarkerPickAssignment,
} from '~/composables/useActionOrderDraft'

export type { MarkerPickAssignment, MarkerActionMode } from '~/composables/useActionOrderDraft'

export type PendingControlChoice = {
  shipId: string
  to: HexCoord
}

function isMovableShipOption(
  opt: MovableShipOption | BombardableShipOption,
): opt is MovableShipOption {
  return 'reachableKeys' in opt
}

function isBombardableShipOption(
  opt: MovableShipOption | BombardableShipOption,
): opt is BombardableShipOption {
  return 'targetKeys' in opt
}

export type MarkerOrderConfirmResult =
  | { kind: 'movement'; from: HexCoord; moves: ShipMovePlan[] }
  | { kind: 'bombardment'; from: HexCoord; bombardments: BombardmentPlan[] }

export function useMarkerMapPick(
  snapshot: Ref<GameSnapshot | null>,
  map: Ref<MapDefinition | null>,
  playerId: Ref<string>,
) {
  const active = ref(false)
  const mode = ref<MarkerActionMode>('movement')
  const source = ref<HexCoord | null>(null)
  const selectedShipIds = ref<string[]>([])
  const activeShipId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const pendingControlChoice = ref<PendingControlChoice | null>(null)

  const orderDraft = useActionOrderDraft(snapshot, playerId, source, selectedShipIds, mode)

  const sourceKey = computed(() => {
    const s = source.value
    return s ? hexKey(s.q, s.r) : null
  })

  const movableShipOptions = computed(() => {
    if (!snapshot.value || !map.value || !source.value || mode.value === 'bombardment') {
      return []
    }
    return getMovableShipsAtMarker(snapshot.value, map.value, playerId.value, source.value)
  })

  const bombardableShipOptions = computed(() => {
    if (!snapshot.value || !map.value || !source.value || mode.value !== 'bombardment') {
      return []
    }
    return getBombardableShipsAtMarker(
      snapshot.value,
      map.value,
      playerId.value,
      source.value,
    )
  })

  const shipOptions = computed(() =>
    mode.value === 'bombardment' ? bombardableShipOptions.value : movableShipOptions.value,
  )

  const bombardmentTargetKeys = computed(() => {
    if (mode.value !== 'bombardment') return [] as string[]
    const shipId = activeShipId.value ?? selectedShipIds.value.find((id) => !orderDraft.assignments.value[id])
    if (!shipId) return [] as string[]
    const opt = bombardableShipOptions.value.find((o) => o.ship.id === shipId)
    if (!opt || !isBombardableShipOption(opt)) return []
    return [...opt.targetKeys]
  })

  const reachableKeys = computed(() => {
    if (!active.value || pendingControlChoice.value) return [] as string[]

    if (mode.value === 'bombardment') {
      return bombardmentTargetKeys.value
    }

    if (!activeShipId.value) return [] as string[]
    const opt = movableShipOptions.value.find((o) => o.ship.id === activeShipId.value)
    if (!opt) return []
    return [...opt.reachableKeys, ...opt.combatReachableKeys]
  })

  const contestedKeys = computed(() => {
    if (!active.value) return [] as string[]

    if (mode.value === 'bombardment') {
      return bombardmentTargetKeys.value
    }

    if (!activeShipId.value) return [] as string[]
    const opt = movableShipOptions.value.find((o) => o.ship.id === activeShipId.value)
    return opt?.combatReachableKeys ?? []
  })

  const allAssigned = computed(() => orderDraft.orderReady.value)

  const activeShipLabel = computed(() => {
    if (mode.value === 'bombardment') {
      const shipId = activeShipId.value
      if (!shipId) return 'обстрел'
      const opt = bombardableShipOptions.value.find((o) => o.ship.id === shipId)
      return opt ? `обстрел · ${opt.ship.type}` : 'обстрел'
    }
    if (!activeShipId.value) return null
    const ship = movableShipOptions.value.find((o) => o.ship.id === activeShipId.value)?.ship
    return ship ? SHIP_LABELS[ship.type] : null
  })

  const confirmButtonLabel = computed(() => {
    if (mode.value === 'bombardment' && orderDraft.hasPendingCombat.value) {
      return 'Начать бой (обстрел)'
    }
    if (orderDraft.hasPendingCombat.value) return 'Начать бой'
    if (mode.value === 'bombardment') return 'Подтвердить обстрел'
    return 'Подтвердить'
  })

  const bannerText = computed(() => {
    if (!active.value || !source.value) return ''

    if (mode.value === 'bombardment' && orderDraft.orderReady.value) {
      const t = orderDraft.bombardmentTarget.value
      return `Приказ обстрела готов — цель (${t?.q}, ${t?.r}). Проверьте превью и подтвердите.`
    }

    if (mode.value !== 'bombardment' && orderDraft.orderReady.value) {
      if (orderDraft.hasPendingCombat.value) {
        const c = orderDraft.pendingCombatCoord.value
        return `Приказ готов — бой на (${c?.q}, ${c?.r}). Проверьте превью и нажмите «Начать бой».`
      }
      return 'Все корабли назначены — нажмите «Подтвердить» для выполнения хода.'
    }
    if (pendingControlChoice.value) {
      const { to } = pendingControlChoice.value
      return `Клетка (${to.q}, ${to.r}): занять её? Снабженец будет снят с карты.`
    }
    // Выбор назначения / цели: текст собирается в шаблоне с подсветкой имени корабля.
    return ''
  })

  /** Корабль для подсветки в баннере при выборе клетки назначения. */
  const bannerShip = computed(() => {
    if (!active.value || !source.value) return null
    if (pendingControlChoice.value || orderDraft.orderReady.value) return null
    if (mode.value === 'bombardment') {
      const shipId =
        activeShipId.value
        ?? selectedShipIds.value.find((id) => !orderDraft.assignments.value[id])
      if (!shipId) return null
      const opt = bombardableShipOptions.value.find((o) => o.ship.id === shipId)
      return opt?.ship ?? null
    }
    if (!activeShipId.value) return null
    return movableShipOptions.value.find((o) => o.ship.id === activeShipId.value)?.ship ?? null
  })

  const bannerShipName = computed(() => {
    const ship = bannerShip.value
    return ship ? (SHIP_LABELS[ship.type] ?? String(ship.type)) : null
  })

  const bannerShipType = computed(() => bannerShip.value?.type ?? null)

  const bannerDestinationMeta = computed(() => {
    if (!active.value || !source.value || !bannerShipName.value) return null
    const pending = selectedShipIds.value.filter((id) => !orderDraft.assignments.value[id]).length
    return {
      source: source.value,
      pending,
      single: pending === 1,
      bombardment: mode.value === 'bombardment',
    }
  })

  function reset() {
    active.value = false
    mode.value = 'movement'
    source.value = null
    selectedShipIds.value = []
    activeShipId.value = null
    error.value = null
    pendingControlChoice.value = null
    orderDraft.clear()
  }

  function start(from: HexCoord, shipIds: string[], pickMode: MarkerActionMode = 'movement') {
    source.value = from
    mode.value = pickMode
    selectedShipIds.value = [...shipIds]
    activeShipId.value = shipIds[0] ?? null
    error.value = null
    pendingControlChoice.value = null
    orderDraft.clear()
    active.value = true
  }

  function cancel() {
    reset()
  }

  function afterBattleModalClosed() {
    error.value = null
  }

  function destCell(coord: HexCoord) {
    if (!snapshot.value) return null
    const key = hexKey(coord.q, coord.r)
    return snapshot.value.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key) ?? null
  }

  function priorMovesFor(excludeShipId?: string): ShipMovePlan[] {
    return Object.entries(orderDraft.assignments.value)
      .filter(([shipId]) => shipId !== excludeShipId)
      .map(([shipId, plan]) => ({
        shipId,
        to: plan.to,
        declareControl: plan.declareControl,
      }))
  }

  function buildMoves(): ShipMovePlan[] {
    return orderDraft.buildMoves()
  }

  function buildBombardments(): BombardmentPlan[] {
    return orderDraft.buildBombardments()
  }

  function validateAll(): string | null {
    if (!snapshot.value || !map.value || !source.value) return 'Нет данных игры'

    if (mode.value === 'bombardment') {
      const errors = validateMarkerBombardment(
        snapshot.value,
        map.value,
        playerId.value,
        source.value,
        buildBombardments(),
      )
      return errors[0] ?? null
    }

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

  function advanceToNextShip() {
    const nextUnassigned = selectedShipIds.value.find((id) => !orderDraft.assignments.value[id])
    activeShipId.value = nextUnassigned ?? null
  }

  function assignShipDestination(shipId: string, to: HexCoord, declareControl: boolean) {
    orderDraft.pushUndoSnapshot(activeShipId.value, pendingControlChoice.value)
    orderDraft.setAssignment(shipId, to, declareControl)
    error.value = null
    advanceToNextShip()
  }

  function tryConfirmOrder(): MarkerOrderConfirmResult | null {
    if (!orderDraft.orderReady.value) return null

    const validationError = validateAll()
    if (validationError) {
      error.value = validationError
      return null
    }

    const from = source.value!
    if (mode.value === 'bombardment') {
      const bombardments = buildBombardments()
      reset()
      return { kind: 'bombardment', from, bombardments }
    }

    const moves = buildMoves()
    reset()
    return { kind: 'movement', from, moves }
  }

  function handleBombardmentSelect(q: number, r: number): null {
    if (!snapshot.value || !source.value) return null

    const shipId =
      activeShipId.value
      ?? selectedShipIds.value.find((id) => !orderDraft.assignments.value[id])
    if (!shipId) return null

    const to = { q, r }
    const toKey = hexKey(q, r)
    const opt = bombardableShipOptions.value.find((o) => o.ship.id === shipId)
    if (!opt || !isBombardableShipOption(opt) || !opt.targetKeys.includes(toKey)) {
      error.value = 'Эта клетка недоступна для обстрела выбранным кораблём'
      return null
    }

    const errors = validateBombardmentTarget(
      snapshot.value,
      playerId.value,
      source.value,
      opt.ship,
      to,
    )
    if (errors.length) {
      error.value = errors[0] ?? null
      return null
    }

    orderDraft.pushUndoSnapshot(activeShipId.value, null)
    orderDraft.setBombardmentTarget(to, shipId)
    error.value = null
    advanceToNextShip()
    return null
  }

  function handleMapSelect(q: number, r: number): null {
    if (!active.value || !source.value || pendingControlChoice.value) return null
    if (orderDraft.orderReady.value) return null

    if (mode.value === 'bombardment') {
      return handleBombardmentSelect(q, r)
    }

    if (!activeShipId.value) return null

    const shipOpt = movableShipOptions.value.find((o) => o.ship.id === activeShipId.value)
    if (!shipOpt) return null

    const to = { q, r }
    const toKey = hexKey(q, r)
    const isCombat =
      shipOpt.combatReachableKeys.includes(toKey)
      || isCombatDestination(snapshot.value!, playerId.value, to)

    if (isCombat && orderDraft.wouldViolateSingleCombatRule(to, activeShipId.value)) {
      error.value = orderDraft.ONE_BATTLE_PER_MARKER_MSG
      return null
    }

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

    if (isCombat) {
      assignShipDestination(activeShipId.value, to, false)
      return null
    }

    const dest = destCell(to)
    if (dest && canDeclareControlForMove(snapshot.value!, shipOpt.ship, dest)) {
      orderDraft.pushUndoSnapshot(activeShipId.value, pendingControlChoice.value)
      pendingControlChoice.value = { shipId: activeShipId.value, to }
      error.value = null
      return null
    }

    assignShipDestination(activeShipId.value, to, false)
    return null
  }

  function resolveControlChoice(occupy: boolean): null {
    const pending = pendingControlChoice.value
    if (!pending || !source.value) return null

    const shipOpt = movableShipOptions.value.find((o) => o.ship.id === pending.shipId)
    if (!shipOpt) return null

    if (
      occupy === false
      && isCombatDestination(snapshot.value!, playerId.value, pending.to)
      && orderDraft.wouldViolateSingleCombatRule(pending.to, pending.shipId)
    ) {
      error.value = orderDraft.ONE_BATTLE_PER_MARKER_MSG
      pendingControlChoice.value = null
      return null
    }

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
    assignShipDestination(pending.shipId, pending.to, occupy)
    return null
  }

  function cancelPendingControlChoice() {
    pendingControlChoice.value = null
    error.value = null
  }

  function undoLastAction(): boolean {
    if (pendingControlChoice.value) {
      pendingControlChoice.value = null
      error.value = null
      return true
    }

    const restored = orderDraft.undoLast()
    if (!restored) return false

    activeShipId.value = restored.activeShipId
    pendingControlChoice.value = restored.pendingControlChoice
    error.value = null
    return true
  }

  return {
    active,
    mode,
    source,
    sourceKey,
    error,
    bannerText,
    bannerShipName,
    bannerShipType,
    bannerDestinationMeta,
    confirmButtonLabel,
    reachableKeys,
    contestedKeys,
    destinationKeys: orderDraft.destinationKeys,
    contestedDestinationKeys: orderDraft.contestedDestinationKeys,
    previewMoves: orderDraft.draftMoves,
    assignments: orderDraft.assignments,
    bombardmentTarget: orderDraft.bombardmentTarget,
    selectedShipIds,
    activeShipId,
    activeShipLabel,
    allAssigned,
    orderReady: orderDraft.orderReady,
    hasPendingCombat: orderDraft.hasPendingCombat,
    shipOptions,
    pendingControlChoice,
    combatPreview: orderDraft.orderCombatPreview,
    roundOneOdds: orderDraft.roundOneOdds,
    start,
    cancel,
    cancelPendingControlChoice,
    afterBattleModalClosed,
    handleMapSelect,
    resolveControlChoice,
    tryConfirmOrder,
    undoLastAction,
    canUndo: orderDraft.canUndo,
    destCell,
  }
}
