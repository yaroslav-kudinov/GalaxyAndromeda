import type {
  BombardmentPlan,
  CombatPreview,
  GameSnapshot,
  HexCoord,
  RoundOneOutcomeOdds,
  ShipMovePlan,
} from '@galaxy/rules'
import {
  ONE_BATTLE_PER_MARKER_MSG,
  buildBombardmentPreview,
  buildCombatPreview,
  detectCombatsFromMoves,
  estimateRoundOneOutcome,
  getCombatDestinationKeysFromMoves,
  hexKey,
  isCombatDestination,
} from '@galaxy/rules'

export type MarkerActionMode = 'movement' | 'bombardment' | 'build' | 'sacrifice'

export type DraftMovePreview = {
  shipId: string
  from: HexCoord
  to: HexCoord
  combat: boolean
}

export type MarkerPickAssignment = { to: HexCoord; declareControl: boolean }

type DraftSnapshot = {
  assignments: Record<string, MarkerPickAssignment>
  bombardmentTarget: HexCoord | null
  activeShipId: string | null
  pendingControlChoice: { shipId: string; to: HexCoord } | null
}

export function useActionOrderDraft(
  snapshot: Ref<GameSnapshot | null>,
  playerId: Ref<string>,
  source: Ref<HexCoord | null>,
  selectedShipIds: Ref<string[]>,
  mode: Ref<MarkerActionMode>,
) {
  const assignments = ref<Record<string, MarkerPickAssignment>>({})
  const bombardmentTarget = ref<HexCoord | null>(null)
  const undoStack = ref<DraftSnapshot[]>([])

  const orderReady = computed(() => {
    if (selectedShipIds.value.length === 0) return false
    if (mode.value === 'bombardment') {
      return selectedShipIds.value.every((id) => assignments.value[id] != null)
    }
    return selectedShipIds.value.every((id) => assignments.value[id] != null)
  })

  const draftMoves = computed((): DraftMovePreview[] => {
    const from = source.value
    if (!from) return []

    if (mode.value === 'bombardment') {
      return selectedShipIds.value
        .filter((id) => assignments.value[id] != null)
        .map((shipId) => {
          const to = assignments.value[shipId]!.to
          return {
            shipId,
            from: { ...from },
            to: { ...to },
            combat: snapshot.value
              ? isCombatDestination(snapshot.value, playerId.value, to)
              : true,
          }
        })
    }

    return Object.entries(assignments.value).map(([shipId, a]) => ({
      shipId,
      from: { ...from },
      to: { ...a.to },
      combat: snapshot.value
        ? isCombatDestination(snapshot.value, playerId.value, a.to)
        : false,
    }))
  })

  const hasPendingCombat = computed(() => draftMoves.value.some((m) => m.combat))

  const pendingCombatCoord = computed((): HexCoord | null => {
    const combat = draftMoves.value.find((m) => m.combat)
    return combat ? { ...combat.to } : null
  })

  const destinationKeys = computed(() =>
    Object.values(assignments.value).map((a) => hexKey(a.to.q, a.to.r)),
  )

  const contestedDestinationKeys = computed(() =>
    draftMoves.value.filter((m) => m.combat).map((m) => hexKey(m.to.q, m.to.r)),
  )

  const orderCombatPreview = computed((): CombatPreview | null => {
    if (!snapshot.value || !pendingCombatCoord.value || !source.value) return null
    const coord = pendingCombatCoord.value
    const fromCell = snapshot.value.cells.find(
      (c) => hexKey(c.coord.q, c.coord.r) === hexKey(source.value!.q, source.value!.r),
    )
    if (!fromCell) return null

    if (mode.value === 'bombardment') {
      const bombardingShips = fromCell.ships.filter((s) =>
        selectedShipIds.value.includes(s.id),
      )
      return buildBombardmentPreview(
        snapshot.value,
        coord,
        playerId.value,
        bombardingShips,
        source.value,
      )
    }

    const incomingIds = draftMoves.value
      .filter((m) => m.combat && hexKey(m.to.q, m.to.r) === hexKey(coord.q, coord.r))
      .map((m) => m.shipId)
    const incomingShips = fromCell.ships.filter((s) => incomingIds.includes(s.id))
    return buildCombatPreview(snapshot.value, coord, playerId.value, incomingShips)
  })

  const roundOneOdds = computed((): RoundOneOutcomeOdds | null => {
    const preview = orderCombatPreview.value
    if (!preview) return null
    return estimateRoundOneOutcome(preview)
  })

  function pushUndoSnapshot(
    activeShipId: string | null,
    pendingControl: DraftSnapshot['pendingControlChoice'],
  ) {
    undoStack.value.push({
      assignments: { ...assignments.value },
      bombardmentTarget: bombardmentTarget.value
        ? { ...bombardmentTarget.value }
        : null,
      activeShipId,
      pendingControlChoice: pendingControl ? { ...pendingControl } : null,
    })
  }

  function clear() {
    assignments.value = {}
    bombardmentTarget.value = null
    undoStack.value = []
  }

  function wouldViolateSingleCombatRule(to: HexCoord, excludeShipId?: string): boolean {
    if (!snapshot.value || mode.value === 'bombardment') return false

    const priorMoves: ShipMovePlan[] = Object.entries(assignments.value)
      .filter(([shipId]) => shipId !== excludeShipId)
      .map(([shipId, plan]) => ({
        shipId,
        to: plan.to,
        declareControl: plan.declareControl,
      }))

    const candidateMoves = [...priorMoves, { shipId: excludeShipId ?? '_draft', to }]
    return getCombatDestinationKeysFromMoves(
      snapshot.value,
      candidateMoves,
      playerId.value,
    ).length > 1
  }

  function setAssignment(shipId: string, to: HexCoord, declareControl: boolean) {
    assignments.value = {
      ...assignments.value,
      [shipId]: { to, declareControl },
    }
  }

  function setBombardmentTarget(target: HexCoord, shipId?: string) {
    bombardmentTarget.value = { ...target }
    const ids = shipId ? [shipId] : selectedShipIds.value
    for (const id of ids) {
      setAssignment(id, target, false)
    }
  }

  function removeAssignment(shipId: string) {
    const next = { ...assignments.value }
    delete next[shipId]
    assignments.value = next
  }

  function buildMoves(): ShipMovePlan[] {
    return selectedShipIds.value.map((id) => ({
      shipId: id,
      to: assignments.value[id]!.to,
      declareControl: assignments.value[id]!.declareControl || undefined,
    }))
  }

  function buildBombardments(): BombardmentPlan[] {
    return selectedShipIds.value
      .filter((id) => assignments.value[id] != null)
      .map((shipId) => ({
        shipId,
        target: { ...assignments.value[shipId]!.to },
      }))
  }

  function canUndo(): boolean {
    return undoStack.value.length > 0
  }

  function undoLast(): {
    activeShipId: string | null
    pendingControlChoice: DraftSnapshot['pendingControlChoice']
  } | null {
    const prev = undoStack.value.pop()
    if (!prev) return null
    assignments.value = { ...prev.assignments }
    bombardmentTarget.value = prev.bombardmentTarget
      ? { ...prev.bombardmentTarget }
      : null
    return {
      activeShipId: prev.activeShipId,
      pendingControlChoice: prev.pendingControlChoice,
    }
  }

  function pendingCombatsFromDraft() {
    if (!snapshot.value) return []
    if (mode.value === 'bombardment') return []
    return detectCombatsFromMoves(snapshot.value, buildMoves(), playerId.value)
  }

  return {
    assignments,
    bombardmentTarget,
    undoStack,
    orderReady,
    draftMoves,
    hasPendingCombat,
    pendingCombatCoord,
    destinationKeys,
    contestedDestinationKeys,
    orderCombatPreview,
    roundOneOdds,
    pushUndoSnapshot,
    clear,
    wouldViolateSingleCombatRule,
    setAssignment,
    setBombardmentTarget,
    removeAssignment,
    buildMoves,
    buildBombardments,
    canUndo,
    undoLast,
    pendingCombatsFromDraft,
    ONE_BATTLE_PER_MARKER_MSG,
  }
}
