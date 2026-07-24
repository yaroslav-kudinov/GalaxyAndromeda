<script setup lang="ts">
import type { GalaxySaveFile, GameSnapshot, HexCoord, LegalAction, MapDefinition, ShipMovePlan } from '@galaxy/rules'
import {
  createEmptyMap,
  executeMarkerMovement,
  executeProductionBatch,
  executeProductionRecharge,
  galaxySaveFromMap,
  gameSnapshotFromMap,
  gameSnapshotFromObservation,
  gameStateFromSnapshot,
  hexKey,
  maxProductionMarkersForPlayer,
  normalizeMapDefinition,
  parseGalaxySave,
  phaseAdvanceActionLabelForSnapshot,
  serializeGalaxySave,
  toggleMarkerAtCell,
  advanceGameSnapshot,
  canExecuteActionMarkerThisTurn,
  hasResolvedActionMarkerThisTurn,
  ACTION_MARKER_ALREADY_RESOLVED_MSG,
  ACTION_MARKER_REMOVE_BLOCKED_MSG,
  getLegalActionsForSnapshot,
  removeActionMarker,
  canRemoveActionMarkerThisTurn,
  canExecuteProductionMarkerThisTurn,
  canRemoveProductionMarkerThisTurn,
  hasResolvedProductionMarkerThisTurn,
  PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
  PRODUCTION_MARKER_REMOVE_BLOCKED_MSG,
  removeProductionMarker,
} from '@galaxy/rules'
import { fetchObservation, fetchRoomBootstrap, submitGameAction } from '~/composables/useGameApi'
import { gameSaveStorageKey, loadGameSession } from '~/composables/useGameSession'
import { useMarkerMapPick } from '~/composables/useMarkerMapPick'
import { useProductionShipPick } from '~/composables/useProductionShipPick'
import { snapshotToBoardCells } from '~/utils/board-adapter'
import {
  gameHelpForPhase,
  markerKindForPhase,
  markerKindLabel,
  type MarkerKind,
} from '~/utils/game-help'

definePageMeta({ layout: 'immersive' })

const session = loadGameSession()
const playerId = ref(session?.playerId ?? 'player-1')

const route = useRoute()
const roomId = computed(() => route.params.roomId as string)

const saveFile = ref<GalaxySaveFile | null>(null)
const selectedKey = ref<string | null>(null)
const panelCollapsed = ref(false)
const legalActions = ref<LegalAction[]>([])
const serverStatus = ref<'idle' | 'loading' | 'online' | 'offline'>('idle')
const loadError = ref<string | null>(null)
const exportFileName = ref('')
const markerHint = ref<string | null>(null)
const phaseHint = ref<string | null>(null)
const advancingPhase = ref(false)
const markerMode = ref<MarkerKind>('action')
const interactionMode = ref<'inspect' | 'markers'>('inspect')
const showHelp = ref(false)
const markerActionOpen = ref(false)
const markerActionSource = ref<HexCoord | null>(null)
const markerActionHint = ref<string | null>(null)
const markerActionBusy = ref(false)
const productionModalOpen = ref(false)
const productionMarkerSource = ref<HexCoord | null>(null)
const productionMarkerId = ref<string | null>(null)
const productionHint = ref<string | null>(null)
const productionBusy = ref(false)

const snapshot = computed(() => saveFile.value?.game ?? null)
const mapDefinition = computed(() => saveFile.value?.map ?? null)

const defaultExportBaseName = computed(() => {
  const map = saveFile.value?.map
  if (!map) return 'galaxy-save'
  return map.name?.trim() || map.id
})

watch(
  defaultExportBaseName,
  (name) => {
    exportFileName.value = name
  },
  { immediate: true },
)

const markerMapPick = useMarkerMapPick(snapshot, mapDefinition, playerId)
const productionShipPick = useProductionShipPick(snapshot, mapDefinition, playerId)
const markerMapPickActive = markerMapPick.active
const markerMapPickBannerText = markerMapPick.bannerText
const markerMapPickError = markerMapPick.error
const markerMapPickPendingControl = markerMapPick.pendingControlChoice
const productionShipPickActive = productionShipPick.active
const productionShipPickBannerText = productionShipPick.bannerText
const productionShipPickError = productionShipPick.error
const boardCells = computed(() =>
  snapshot.value ? snapshotToBoardCells(snapshot.value) : [],
)

const myPlayerName = computed(() => {
  const fromSession = session?.playerName
  if (fromSession) return fromSession
  const fromSnapshot = snapshot.value?.players.find((p) => p.id === playerId.value)?.name
  return fromSnapshot ?? playerId.value
})

const { toasts: statusToasts } = useGameStatusToasts(snapshot, playerId, myPlayerName)

const activePlayerName = computed(() => {
  const id = snapshot.value?.activePlayerId
  if (!id || !snapshot.value) return null
  return snapshot.value.players.find((p) => p.id === id)?.name ?? id
})

const activePlayerColor = computed(() => {
  const id = snapshot.value?.activePlayerId
  if (!id || !snapshot.value) return '#3B82F6'
  return snapshot.value.players.find((p) => p.id === id)?.color ?? '#3B82F6'
})

const phaseAdvanceBtnStyle = computed(() => ({
  '--player-color': activePlayerColor.value,
}))

const actionMarkers = computed(() => snapshot.value?.actionMarkers ?? [])
const productionMarkers = computed(() => snapshot.value?.productionMarkers ?? [])

const isMyTurn = computed(
  () => snapshot.value?.activePlayerId === playerId.value,
)

const effectiveMarkerKind = computed((): MarkerKind => {
  const phase = snapshot.value?.phase
  if (phase === 'production') return 'production'
  if (phase === 'actions' || phase === 'events') return 'action'
  return markerMode.value
})

const canPickMarkerKind = computed(() => snapshot.value?.phase === 'planning')
const canPlaceMarkers = computed(
  () => isMyTurn.value && snapshot.value?.phase !== 'events',
)

const actionMarkerUsedThisTurn = computed(() =>
  snapshot.value ? hasResolvedActionMarkerThisTurn(snapshot.value) : false,
)

/** Хук для модалки перемещения: открывать только если маркер ещё не исполнен */
const canOpenMovementModal = computed(() => {
  if (!snapshot.value || !isMyTurn.value) return false
  return canExecuteActionMarkerThisTurn(snapshot.value, playerId.value)
})

const productionMarkerUsedThisTurn = computed(() =>
  snapshot.value ? hasResolvedProductionMarkerThisTurn(snapshot.value) : false,
)

const canOpenProductionModal = computed(() => {
  if (!snapshot.value || !isMyTurn.value) return false
  return canExecuteProductionMarkerThisTurn(snapshot.value, playerId.value)
})

const phaseHelp = computed(() =>
  gameHelpForPhase(snapshot.value?.phase, isMyTurn.value, effectiveMarkerKind.value),
)

const advancePhaseLabel = computed(() => {
  if (!saveFile.value?.game) return 'Далее'
  return phaseAdvanceActionLabelForSnapshot(saveFile.value.game, saveFile.value.map.id)
})

function applyObservation(
  obs: Awaited<ReturnType<typeof fetchObservation>>,
  map?: MapDefinition,
) {
  legalActions.value = obs.legalActions ?? []
  const preserve = saveFile.value?.game
  const game = gameSnapshotFromObservation(obs.mechanics, preserve ?? undefined)

  if (saveFile.value) {
    saveFile.value = {
      ...saveFile.value,
      savedAt: new Date().toISOString(),
      game,
    }
    return
  }

  if (!map) return
  saveFile.value = {
    format: 'galaxy-save',
    version: 1,
    savedAt: new Date().toISOString(),
    map: normalizeMapDefinition(map),
    game,
  }
}

async function endPhase() {
  if (!saveFile.value?.game || !isMyTurn.value || advancingPhase.value) return
  phaseHint.value = null
  advancingPhase.value = true
  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      const obs = await submitGameAction(roomId.value, playerId.value, 'advance-phase')
      applyObservation(obs)
      persistLocal()
      return
    }

    const errors = advanceGameSnapshot(saveFile.value.game, saveFile.value.map.id)
    if (errors.length) {
      phaseHint.value = errors[0]
      return
    }
    persistLocal()
    refreshLocalLegalActions()
  } catch (e) {
    phaseHint.value = e instanceof Error ? e.message : 'Не удалось сменить фазу'
  } finally {
    advancingPhase.value = false
  }
}

const myActionMarkerCount = computed(
  () => actionMarkers.value.filter((m) => m.ownerId === playerId.value).length,
)

const myProductionMarkerCount = computed(
  () => productionMarkers.value.filter((m) => m.ownerId === playerId.value).length,
)

const maxProductionRegions = computed(() => {
  if (!saveFile.value?.game || !saveFile.value?.map) return 0
  const state = gameStateFromSnapshot(saveFile.value.game, saveFile.value.map.id)
  return maxProductionMarkersForPlayer(state, playerId.value)
})

const selectedCell = computed(() => {
  if (!selectedKey.value) return null
  return boardCells.value.find((c) => hexKey(c.q, c.r) === selectedKey.value) ?? null
})

const canRemoveActionMarkerOnSelected = computed(() => {
  if (!isMyTurn.value || !saveFile.value?.game || !selectedKey.value) return false
  const phase = snapshot.value?.phase
  if (phase !== 'planning' && phase !== 'actions') return false
  if (!canRemoveActionMarkerThisTurn(saveFile.value.game, playerId.value)) return false
  const key = selectedKey.value
  const cell = saveFile.value.game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.actionMarkerId) return false
  return saveFile.value.game.actionMarkers.some(
    (m) => m.id === cell.actionMarkerId && m.ownerId === playerId.value,
  )
})

const canRemoveProductionMarkerOnSelected = computed(() => {
  if (!isMyTurn.value || !saveFile.value?.game || !selectedKey.value) return false
  const phase = snapshot.value?.phase
  if (phase !== 'planning' && phase !== 'production') return false
  if (!canRemoveProductionMarkerThisTurn(saveFile.value.game, playerId.value)) return false
  const key = selectedKey.value
  const cell = saveFile.value.game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.productionMarkerId) return false
  return saveFile.value.game.productionMarkers.some(
    (m) => m.id === cell.productionMarkerId && m.ownerId === playerId.value,
  )
})

const remainingActionMarkersCount = computed(() => actionMarkers.value.length)

const availableActionMarkerKeys = computed(() => {
  if (!snapshot.value || !isMyTurn.value) return [] as string[]
  const game = snapshot.value
  const phase = game.phase
  const mine = actionMarkers.value.filter((m) => m.ownerId === playerId.value)
  const keys = () => mine.map((m) => hexKey(m.coord.q, m.coord.r))

  if (phase === 'actions' && canExecuteActionMarkerThisTurn(game, playerId.value)) {
    return keys()
  }

  if (
    interactionMode.value === 'markers'
    && (phase === 'planning' || phase === 'actions')
    && effectiveMarkerKind.value === 'action'
    && canRemoveActionMarkerThisTurn(game, playerId.value)
  ) {
    return keys()
  }

  return []
})

const availableProductionMarkerKeys = computed(() => {
  if (!snapshot.value || !isMyTurn.value) return [] as string[]
  const phase = snapshot.value.phase
  if (phase !== 'planning' && phase !== 'production') return []

  const mine = productionMarkers.value.filter((m) => m.ownerId === playerId.value)
  const keys = () => mine.map((m) => hexKey(m.coord.q, m.coord.r))

  if (
    phase === 'production'
    && canExecuteProductionMarkerThisTurn(snapshot.value, playerId.value)
    && interactionMode.value === 'inspect'
  ) {
    return keys()
  }

  if (interactionMode.value !== 'markers') return [] as string[]
  if (effectiveMarkerKind.value !== 'production') return [] as string[]
  return keys()
})

const boardReachableKeys = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.reachableKeys.value
  if (productionShipPickActive.value) return productionShipPick.reachableKeys.value
  return []
})
const boardDestinationKeys = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.destinationKeys.value
  if (productionShipPickActive.value) return productionShipPick.destinationKeys.value
  return []
})
const boardMovementSourceKey = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.sourceKey.value
  if (productionShipPickActive.value) return productionShipPick.sourceKey.value
  return null
})

function hasMyActionMarkerAt(q: number, r: number): boolean {
  if (!snapshot.value) return false
  const key = hexKey(q, r)
  const cell = snapshot.value.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.actionMarkerId) return false
  return snapshot.value.actionMarkers.some(
    (m) => m.id === cell.actionMarkerId && m.ownerId === playerId.value,
  )
}

function hasMyProductionMarkerAt(q: number, r: number): boolean {
  if (!snapshot.value) return false
  const key = hexKey(q, r)
  const cell = snapshot.value.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.productionMarkerId) return false
  return snapshot.value.productionMarkers.some(
    (m) => m.id === cell.productionMarkerId && m.ownerId === playerId.value,
  )
}

function productionMarkerIdAt(q: number, r: number): string | null {
  if (!snapshot.value) return null
  const key = hexKey(q, r)
  const cell = snapshot.value.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.productionMarkerId) return null
  const marker = snapshot.value.productionMarkers.find((m) => m.id === cell.productionMarkerId)
  if (!marker || marker.ownerId !== playerId.value) return null
  return marker.id
}

function openProductionModal(q: number, r: number) {
  const id = productionMarkerIdAt(q, r)
  if (!id) return
  productionMarkerSource.value = { q, r }
  productionMarkerId.value = id
  productionModalOpen.value = true
  productionHint.value = null
}

function closeProductionModal() {
  productionModalOpen.value = false
  productionMarkerSource.value = null
  productionMarkerId.value = null
}

function startProductionShipPick(orders: import('~/composables/useProductionShipPick').ShipBuildOrder[]) {
  if (!productionMarkerId.value) return
  productionModalOpen.value = false
  productionShipPick.start(productionMarkerId.value, orders)
  productionHint.value = null
}

function cancelProductionShipPick() {
  productionShipPick.cancel()
  productionMarkerSource.value = null
  productionMarkerId.value = null
  productionHint.value = null
}

async function confirmProductionBatch(plan: { markerId: string; ships: import('@galaxy/rules').ShipPlacement[] }) {
  if (!saveFile.value?.game || productionBusy.value) return
  productionBusy.value = true
  productionHint.value = null

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'execute-production',
        plan,
      )
      applyObservation(obs)
      persistLocal()
      productionMarkerSource.value = null
      productionMarkerId.value = null
      productionHint.value = `Построено кораблей: ${plan.ships.length}`
      return
    }

    const errors = executeProductionBatch(
      saveFile.value.game,
      saveFile.value.map.id,
      playerId.value,
      plan,
    )
    if (errors.length) {
      productionHint.value = errors[0] ?? null
      return
    }
    persistLocal()
    refreshLocalLegalActions()
    productionMarkerSource.value = null
    productionMarkerId.value = null
    productionHint.value = `Построено кораблей: ${plan.ships.length}`
  } catch (e) {
    productionHint.value = e instanceof Error ? e.message : 'Не удалось выполнить постройку'
  } finally {
    productionBusy.value = false
  }
}

async function confirmProductionRecharge(markerId: string) {
  if (!saveFile.value?.game || productionBusy.value) return
  productionBusy.value = true
  productionHint.value = null
  productionModalOpen.value = false

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'execute-production-recharge',
        { markerId },
      )
      applyObservation(obs)
      persistLocal()
      productionMarkerSource.value = null
      productionMarkerId.value = null
      productionHint.value = 'Производство перезаряжено'
      return
    }

    const errors = executeProductionRecharge(
      saveFile.value.game,
      saveFile.value.map.id,
      playerId.value,
      { markerId },
    )
    if (errors.length) {
      productionHint.value = errors[0] ?? null
      return
    }
    persistLocal()
    refreshLocalLegalActions()
    productionMarkerSource.value = null
    productionMarkerId.value = null
    productionHint.value = 'Производство перезаряжено'
  } catch (e) {
    productionHint.value = e instanceof Error ? e.message : 'Не удалось перезарядить производство'
  } finally {
    productionBusy.value = false
  }
}

function openMarkerActionModal(q: number, r: number) {
  markerActionSource.value = { q, r }
  markerActionOpen.value = true
  markerActionHint.value = null
}

function closeMarkerActionModal() {
  markerActionOpen.value = false
  markerActionSource.value = null
}

function startMarkerMapPick(shipIds: string[]) {
  if (!markerActionSource.value) return
  markerActionOpen.value = false
  markerMapPick.start(markerActionSource.value, shipIds)
  markerActionHint.value = null
}

function cancelMarkerMapPick() {
  markerMapPick.cancel()
  markerActionSource.value = null
  markerActionHint.value = null
}

async function resolveMarkerOccupyChoice(occupy: boolean) {
  const result = markerMapPick.resolveControlChoice(occupy)
  if (result) {
    await confirmMarkerMovement(result.moves, result.from)
  }
}

function cancelMarkerPendingControl() {
  markerMapPick.cancelPendingControlChoice()
}

async function confirmMarkerMovement(moves: ShipMovePlan[], fromOverride?: HexCoord) {
  const from = fromOverride ?? markerActionSource.value
  if (!saveFile.value?.game || !from || markerActionBusy.value) return
  markerActionBusy.value = true
  markerActionHint.value = null

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'execute-marker-movement',
        { from, moves },
      )
      applyObservation(obs)
      persistLocal()
      markerActionSource.value = null
      markerActionHint.value = 'Движение выполнено'
      return
    }

    const errors = executeMarkerMovement(
      saveFile.value.game,
      saveFile.value.map,
      playerId.value,
      from,
      moves,
    )
    if (errors.length) {
      markerActionHint.value = errors[0] ?? null
      return
    }
    persistLocal()
    refreshLocalLegalActions()
    markerActionSource.value = null
    markerActionHint.value = 'Движение выполнено'
  } catch (e) {
    markerActionHint.value = e instanceof Error ? e.message : 'Не удалось выполнить движение'
  } finally {
    markerActionBusy.value = false
  }
}

function onMapPickKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (markerMapPickPendingControl.value) {
    e.preventDefault()
    cancelMarkerPendingControl()
    return
  }
  if (markerMapPickActive.value) {
    e.preventDefault()
    cancelMarkerMapPick()
    return
  }
  if (productionShipPickActive.value) {
    e.preventDefault()
    cancelProductionShipPick()
  }
}

watch(
  () => snapshot.value?.phase,
  (phase) => {
    markerMode.value = markerKindForPhase(phase)
  },
)

function loadFromLocalRoom() {
  if (!import.meta.client) return false
  try {
    const raw = localStorage.getItem(gameSaveStorageKey(roomId.value))
    if (!raw) return false
    saveFile.value = parseGalaxySave(JSON.parse(raw))
    if (!saveFile.value.game) {
      saveFile.value = {
        ...saveFile.value,
        game: gameSnapshotFromMap(saveFile.value.map),
      }
    }
    selectedKey.value = hexKey(
      saveFile.value.map.cells[0]?.q ?? 0,
      saveFile.value.map.cells[0]?.r ?? 0,
    )
    return true
  } catch {
    return false
  }
}

function loadFallbackMap() {
  const map = normalizeMapDefinition(createEmptyMap(`room-${roomId.value}`, `Комната ${roomId.value}`))
  saveFile.value = galaxySaveFromMap(map)
  saveFile.value.game = gameSnapshotFromMap(map)
  saveFile.value.game.activePlayerId = playerId.value
  selectedKey.value = hexKey(map.cells[0]?.q ?? 0, map.cells[0]?.r ?? 0)
}

function refreshLocalLegalActions() {
  if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) return
  if (!saveFile.value?.game) {
    legalActions.value = []
    return
  }
  legalActions.value = getLegalActionsForSnapshot(
    saveFile.value.game,
    saveFile.value.map.id,
    playerId.value,
  )
}

/** Отладка: при передаче хода управление переключается на активного игрока */
watch(
  () => snapshot.value?.activePlayerId,
  (activeId) => {
    if (!activeId) return
    if (playerId.value !== activeId) {
      playerId.value = activeId
    }
    refreshLocalLegalActions()
  },
)

function persistLocal() {
  if (!import.meta.client || !saveFile.value) return
  localStorage.setItem(gameSaveStorageKey(roomId.value), serializeGalaxySave(saveFile.value))
}

async function tryLoadFromServer() {
  if (roomId.value.startsWith('local-')) {
    serverStatus.value = 'offline'
    return
  }
  serverStatus.value = 'loading'
  try {
    const bootstrap = await fetchRoomBootstrap(roomId.value)
    const obs = await fetchObservation(roomId.value, playerId.value)
    applyObservation(obs, bootstrap.map)
    if (!selectedKey.value) {
      selectedKey.value = hexKey(bootstrap.map.cells[0]?.q ?? 0, bootstrap.map.cells[0]?.r ?? 0)
    }
    serverStatus.value = 'online'
    persistLocal()
  } catch {
    serverStatus.value = 'offline'
  }
}

async function selectCell(q: number, r: number) {
  selectedKey.value = hexKey(q, r)
  markerHint.value = null

  if (productionShipPickActive.value) {
    const result = productionShipPick.handleMapSelect(q, r)
    if (result) await confirmProductionBatch(result)
    return
  }

  if (markerMapPickActive.value) {
    const result = markerMapPick.handleMapSelect(q, r)
    if (result) {
      await confirmMarkerMovement(result.moves, result.from)
    }
    return
  }

  if (
    interactionMode.value === 'inspect'
    && isMyTurn.value
    && snapshot.value?.phase === 'actions'
    && hasMyActionMarkerAt(q, r)
  ) {
    if (!canOpenMovementModal.value) {
      markerHint.value = ACTION_MARKER_ALREADY_RESOLVED_MSG
      return
    }
    openMarkerActionModal(q, r)
    return
  }

  if (
    interactionMode.value === 'inspect'
    && isMyTurn.value
    && snapshot.value?.phase === 'production'
    && hasMyProductionMarkerAt(q, r)
  ) {
    if (!canOpenProductionModal.value) {
      markerHint.value = PRODUCTION_MARKER_ALREADY_RESOLVED_MSG
      return
    }
    openProductionModal(q, r)
    return
  }

  if (
    interactionMode.value !== 'markers'
    || !saveFile.value?.game
    || !canPlaceMarkers.value
  ) return

  if (
    effectiveMarkerKind.value === 'action'
    && wouldRemoveMyActionMarkerAt(saveFile.value.game, q, r)
    && !confirmRemoveActionMarker()
  ) {
    return
  }

  if (
    effectiveMarkerKind.value === 'production'
    && wouldRemoveMyProductionMarkerAt(saveFile.value.game, q, r)
    && !confirmRemoveProductionMarker()
  ) {
    return
  }

  const errors = toggleMarkerAtCell(
    saveFile.value.game,
    playerId.value,
    { q, r },
    saveFile.value.map,
    effectiveMarkerKind.value,
  )
  if (errors.length) {
    markerHint.value = errors[0]
    return
  }
  persistLocal()
}

function wouldRemoveMyActionMarkerAt(game: GameSnapshot, q: number, r: number): boolean {
  const key = hexKey(q, r)
  const cell = game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.actionMarkerId) return false
  return game.actionMarkers.some(
    (m) => m.id === cell.actionMarkerId && m.ownerId === playerId.value,
  )
}

function confirmRemoveActionMarker(): boolean {
  return window.confirm(
    'Снять маркер действия с этой клетки?\n\nПлан на эту клетку будет отменён. Это нельзя отменить.',
  )
}

function wouldRemoveMyProductionMarkerAt(game: GameSnapshot, q: number, r: number): boolean {
  const key = hexKey(q, r)
  const cell = game.cells.find((c) => hexKey(c.coord.q, c.coord.r) === key)
  if (!cell?.productionMarkerId) return false
  return game.productionMarkers.some(
    (m) => m.id === cell.productionMarkerId && m.ownerId === playerId.value,
  )
}

function confirmRemoveProductionMarker(): boolean {
  return window.confirm(
    'Снять маркер производства с этой клетки?\n\nПлан постройки в этом регионе будет отменён.',
  )
}

function removeSelectedActionMarker() {
  if (!saveFile.value?.game || !selectedKey.value) return
  if (!confirmRemoveActionMarker()) return

  const cell = saveFile.value.game.cells.find(
    (c) => hexKey(c.coord.q, c.coord.r) === selectedKey.value,
  )
  if (!cell?.actionMarkerId) return

  const errors = removeActionMarker(
    saveFile.value.game,
    cell.actionMarkerId,
    playerId.value,
  )
  if (errors.length) {
    markerHint.value = errors[0]
    return
  }
  markerHint.value = 'Маркер действия снят'
  persistLocal()
  refreshLocalLegalActions()
}

function removeSelectedProductionMarker() {
  if (!saveFile.value?.game || !selectedKey.value) return
  if (!confirmRemoveProductionMarker()) return

  const cell = saveFile.value.game.cells.find(
    (c) => hexKey(c.coord.q, c.coord.r) === selectedKey.value,
  )
  if (!cell?.productionMarkerId) return

  const errors = removeProductionMarker(
    saveFile.value.game,
    cell.productionMarkerId,
    playerId.value,
  )
  if (errors.length) {
    markerHint.value = errors[0]
    return
  }
  markerHint.value = 'Маркер производства снят'
  persistLocal()
  refreshLocalLegalActions()
}

function resolveExportDownloadName(): string {
  if (!saveFile.value) return 'galaxy-save.galaxy.json'
  const fallback = `${saveFile.value.map.id}.galaxy.json`
  const raw = exportFileName.value.trim() || defaultExportBaseName.value
  const base = raw
    .replace(/\.(galaxy\.)?json$/i, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 120)
  return base ? `${base}.galaxy.json` : fallback
}

function exportGameSave() {
  if (!saveFile.value) return
  const blob = new Blob([serializeGalaxySave(saveFile.value)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = resolveExportDownloadName()
  a.click()
  URL.revokeObjectURL(url)
}

function importGameSave(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = parseGalaxySave(JSON.parse(String(reader.result)))
      if (!parsed.game) {
        loadError.value = 'Файл без секции game'
        saveFile.value = { ...parsed, game: gameSnapshotFromMap(parsed.map) }
      } else {
        saveFile.value = parsed
        loadError.value = null
      }
      selectedKey.value = hexKey(
        saveFile.value!.map.cells[0]?.q ?? 0,
        saveFile.value!.map.cells[0]?.r ?? 0,
      )
      persistLocal()
    } catch {
      loadError.value = 'Не удалось прочитать .galaxy.json'
    }
  }
  reader.readAsText(file)
  input.value = ''
}

onMounted(async () => {
  window.addEventListener('keydown', onMapPickKeydown)
  if (!loadFromLocalRoom()) {
    loadFallbackMap()
  }
  refreshLocalLegalActions()
  await tryLoadFromServer()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onMapPickKeydown)
})

watch([isMyTurn, () => snapshot.value?.phase, serverStatus], () => {
  refreshLocalLegalActions()
})
</script>

<template>
  <div class="game-viewport">
    <section class="board-layer">
      <GameBoard
        v-if="boardCells.length"
        :cells="boardCells"
        mode="game"
        :selected-key="selectedKey"
        :reachable-keys="boardReachableKeys"
        :destination-keys="boardDestinationKeys"
        :movement-source-key="boardMovementSourceKey"
        :available-action-marker-keys="availableActionMarkerKeys"
        :available-production-marker-keys="availableProductionMarkerKeys"
        @select="selectCell"
      />
      <p v-else class="empty-hint">Нет данных карты — импортируйте .galaxy.json</p>
    </section>

    <GameStatusToast :toasts="statusToasts" />

    <MarkerActionModal
      v-if="markerActionOpen && snapshot && saveFile && markerActionSource"
      :snapshot="snapshot"
      :map="saveFile.map"
      :player-id="playerId"
      :source="markerActionSource"
      @close="closeMarkerActionModal"
      @start-pick="startMarkerMapPick"
    />

    <ProductionModal
      v-if="productionModalOpen && snapshot && saveFile && productionMarkerSource && productionMarkerId"
      :snapshot="snapshot"
      :map="saveFile.map"
      :player-id="playerId"
      :source="productionMarkerSource"
      :marker-id="productionMarkerId"
      @close="closeProductionModal"
      @recharge="confirmProductionRecharge(productionMarkerId)"
      @start-pick="startProductionShipPick"
    />

    <div v-if="productionShipPickActive" class="map-pick-banner map-pick-banner--production" role="status">
      <p class="map-pick-text">{{ productionShipPickBannerText }}</p>
      <p v-if="productionShipPickError" class="map-pick-error">{{ productionShipPickError }}</p>
      <button type="button" class="map-pick-cancel" @click.stop="cancelProductionShipPick">
        Отмена (Esc)
      </button>
    </div>

    <div v-if="markerMapPickActive" class="map-pick-banner" role="status">
      <p class="map-pick-text">{{ markerMapPickBannerText }}</p>
      <p v-if="markerMapPickError" class="map-pick-error">{{ markerMapPickError }}</p>
      <div v-if="markerMapPickPendingControl" class="map-pick-actions">
        <button type="button" class="map-pick-primary" @click.stop="resolveMarkerOccupyChoice(true)">
          Занять клетку
        </button>
        <button type="button" class="map-pick-secondary" @click.stop="resolveMarkerOccupyChoice(false)">
          Только переместить
        </button>
        <button type="button" class="map-pick-cancel" @click.stop="cancelMarkerPendingControl">
          Назад (Esc)
        </button>
      </div>
      <button
        v-else
        type="button"
        class="map-pick-cancel"
        @click.stop="cancelMarkerMapPick"
      >
        Отмена (Esc)
      </button>
    </div>

    <header class="hud-top">
      <NuxtLink to="/" class="back-link">← Lobby</NuxtLink>
      <span class="you-badge" :class="{ 'you-badge--turn': isMyTurn }">
        Вы: {{ myPlayerName }}
        <span v-if="snapshot?.activePlayerId" class="you-badge-sub">
          · ход {{ activePlayerName }}
        </span>
      </span>
      <div v-if="saveFile" class="hud-title">
        <strong>{{ saveFile.map.name }}</strong>
        <span class="hud-id">{{ roomId }}</span>
      </div>
      <PhasePanel
        v-if="snapshot"
        :phase="snapshot.phase"
        :turn-number="snapshot.turnNumber"
        :active-player-id="snapshot.activePlayerId"
        :players="snapshot.players"
      />
      <span class="server-pill" :class="serverStatus">
        {{ serverStatus === 'online' ? 'Сервер' : serverStatus === 'offline' ? 'Offline' : '…' }}
      </span>
    </header>

    <aside class="hud-right" :class="{ collapsed: panelCollapsed }">
      <button type="button" class="panel-toggle" @click="panelCollapsed = !panelCollapsed">
        {{ panelCollapsed ? '«' : '»' }}
      </button>
      <div v-if="!panelCollapsed" class="panel-inner">
        <h2 class="panel-heading">Игра</h2>

        <section
          v-if="activePlayerName"
          class="block active-player-block"
          :style="phaseAdvanceBtnStyle"
        >
          <p class="active-player-label">
            <span class="active-player-dot" aria-hidden="true" />
            Активный: <strong>{{ activePlayerName }}</strong>
          </p>
        </section>

        <section class="block">
          <CellDetailPanel
            :cell="selectedCell"
            :cell-key="selectedKey"
            :players="snapshot?.players"
            :can-remove-action-marker="canRemoveActionMarkerOnSelected"
            :can-remove-production-marker="canRemoveProductionMarkerOnSelected"
            @remove-action-marker="removeSelectedActionMarker"
            @remove-production-marker="removeSelectedProductionMarker"
          />
        </section>

        <section class="block">
          <h3>Файл</h3>
          <label class="export-name-field">
            <span class="export-name-label">Имя файла</span>
            <input
              v-model="exportFileName"
              type="text"
              class="export-name-input"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter="exportGameSave"
            />
          </label>
          <div class="btn-row">
            <button type="button" @click="exportGameSave">Экспорт</button>
            <label class="file-btn">
              Импорт
              <input type="file" accept="application/json,.json,.galaxy.json" hidden @change="importGameSave" />
            </label>
          </div>
          <p v-if="loadError" class="err">{{ loadError }}</p>
        </section>

        <section v-if="isMyTurn" class="block">
          <h3>Фаза хода</h3>
          <button
            type="button"
            class="phase-advance-btn"
            :style="phaseAdvanceBtnStyle"
            :disabled="advancingPhase"
            @click="endPhase"
          >
            {{ advancingPhase ? '…' : advancePhaseLabel }}
          </button>
          <p v-if="phaseHint" class="err">{{ phaseHint }}</p>
          <p v-else-if="snapshot?.phase === 'actions' && remainingActionMarkersCount > 0" class="hint">
            Фаза «Действия» продолжается, пока на карте есть маркеры (осталось {{ remainingActionMarkersCount }}).
          </p>
          <p v-else class="hint">
            В каждой фазе ходят все игроки по очереди (1→2→3→…).
            При передаче хода управление переключается на активного игрока.
          </p>
        </section>

        <section v-if="isMyTurn && snapshot?.phase === 'actions'" class="block">
          <h3>Маркер действия</h3>
          <p v-if="actionMarkerUsedThisTurn" class="hint action-marker-used">
            {{ ACTION_MARKER_ALREADY_RESOLVED_MSG }} Передайте ход, когда закончите.
          </p>
          <p v-else class="hint">
            За этот ход можно исполнить один маркер действия. Клик по клетке с маркером откроет перемещение.
            Снять маркер без действия — кнопка в карточке клетки (с подтверждением) или режим «Маркеры», **до** исполнения маркера в этом ходу.
          </p>
        </section>

        <section class="block">
          <h3>Действия</h3>
          <ul v-if="legalActions.length" class="action-list">
            <li v-for="action in legalActions" :key="action.id">{{ action.description }}</li>
          </ul>
          <p v-else-if="!isMyTurn" class="hint">Сейчас не ваш ход.</p>
          <p v-else class="hint">Нет доступных действий.</p>
          <p v-if="markerActionHint" class="hint">{{ markerActionHint }}</p>
          <p v-if="productionHint" class="hint hint--production">{{ productionHint }}</p>
        </section>

        <section class="block help-block">
          <div class="help-head">
            <h3>{{ phaseHelp.title }}</h3>
            <button type="button" class="help-toggle" @click="showHelp = !showHelp">
              {{ showHelp ? '−' : '?' }}
            </button>
          </div>
          <ul v-if="showHelp" class="help-list">
            <li v-for="(line, idx) in phaseHelp.lines" :key="idx">{{ line }}</li>
          </ul>
        </section>

        <section v-if="isMyTurn" class="block">
          <h3>Режим карты</h3>
          <div class="mode-row">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: interactionMode === 'inspect' }"
              @click="interactionMode = 'inspect'"
            >
              Осмотр
            </button>
            <button
              type="button"
              class="mode-btn mode-btn--action"
              :class="{ active: interactionMode === 'markers' }"
              :disabled="!canPlaceMarkers"
              @click="interactionMode = 'markers'"
            >
              Маркеры
            </button>
          </div>
          <p class="hint">
            {{ interactionMode === 'inspect'
              ? 'Клик выбирает клетку и показывает подробности.'
              : 'Клик ставит или снимает выбранный маркер.' }}
          </p>
        </section>

        <section v-if="canPickMarkerKind && isMyTurn && interactionMode === 'markers'" class="block">
          <h3>Тип маркера</h3>
          <div class="mode-row">
            <button
              type="button"
              class="mode-btn mode-btn--action"
              :class="{ active: markerMode === 'action' }"
              @click="markerMode = 'action'"
            >
              Действие
            </button>
            <button
              type="button"
              class="mode-btn mode-btn--production"
              :class="{ active: markerMode === 'production' }"
              @click="markerMode = 'production'"
            >
              Производство
            </button>
          </div>
          <p class="hint">
            Сейчас: {{ markerKindLabel(effectiveMarkerKind) }}
            <span v-if="effectiveMarkerKind === 'action'">
              · ваши {{ myActionMarkerCount }}/6
            </span>
            <span v-else-if="effectiveMarkerKind === 'production'">
              · ваши {{ myProductionMarkerCount }}/{{ maxProductionRegions }} регионов
            </span>
          </p>
        </section>

        <section v-if="interactionMode === 'markers'" class="block">
          <h3>Маркеры</h3>
          <p v-if="markerHint" class="err">{{ markerHint }}</p>
          <p v-else-if="!isMyTurn" class="hint">Сейчас не ваш ход.</p>
          <p v-else-if="snapshot?.phase === 'events'" class="hint">В фазе событий маркеры не ставятся.</p>
          <p v-else class="hint">
            Клик по <strong>своей</strong> клетке — поставить или снять маркер
            «{{ markerKindLabel(effectiveMarkerKind).toLowerCase() }}».
          </p>
        </section>

        <details class="block marker-details">
          <summary>Маркеры действия ({{ actionMarkers.length }})</summary>
          <ul v-if="actionMarkers.length" class="marker-list">
            <li v-for="m in actionMarkers" :key="m.id">
              {{ m.ownerId }} @ ({{ m.coord.q }}, {{ m.coord.r }}) · {{ m.placedInPhase }}
            </li>
          </ul>
          <p v-else class="hint">Нет маркеров.</p>
        </details>

        <details class="block marker-details">
          <summary>Маркеры производства ({{ productionMarkers.length }})</summary>
          <ul v-if="productionMarkers.length" class="marker-list">
            <li v-for="m in productionMarkers" :key="m.id">
              {{ m.ownerId }} @ ({{ m.coord.q }}, {{ m.coord.r }}) · регион {{ m.targetRegionId }}
            </li>
          </ul>
          <p v-else class="hint">Нет маркеров.</p>
        </details>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.game-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #e2e8f0;
  overflow: hidden;
}
.board-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}
.hud-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.75rem;
  background: linear-gradient(to bottom, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.55), transparent);
  backdrop-filter: blur(4px);
  pointer-events: none;
}
.hud-top > * {
  pointer-events: auto;
}
.map-pick-banner {
  position: absolute;
  top: 3.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  max-width: min(92vw, 520px);
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.55);
  background: rgba(12, 74, 110, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.map-pick-banner--production {
  border-color: rgba(244, 114, 182, 0.65);
  background: rgba(131, 24, 67, 0.92);
}
.map-pick-text {
  margin: 0;
  font-size: 0.84rem;
  color: #e0f2fe;
  text-align: center;
  line-height: 1.35;
}
.map-pick-error {
  margin: 0;
  font-size: 0.8rem;
  color: #fca5a5;
  text-align: center;
}
.map-pick-cancel {
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
  font-size: 0.78rem;
  cursor: pointer;
}
.map-pick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}
.map-pick-primary,
.map-pick-secondary {
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
}
.map-pick-primary {
  border: 1px solid #16a34a;
  background: #15803d;
  color: #fff;
  font-weight: 600;
}
.map-pick-secondary {
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
}
.back-link {
  color: #93c5fd;
  text-decoration: none;
  font-size: 0.85rem;
}
.you-badge {
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #e2e8f0;
  background: rgba(51, 65, 85, 0.85);
  border: 1px solid rgba(100, 116, 139, 0.6);
}
.you-badge--turn {
  color: #bbf7d0;
  border-color: rgba(134, 239, 172, 0.55);
  background: rgba(22, 78, 50, 0.75);
}
.you-badge-sub {
  font-weight: 500;
  opacity: 0.9;
}
.hud-title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.hud-id {
  font-size: 0.72rem;
  color: #94a3b8;
}
.server-pill {
  margin-left: auto;
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.7);
  color: #94a3b8;
}
.server-pill.online {
  color: #86efac;
}
.server-pill.offline {
  color: #fca5a5;
}
.hud-right {
  position: absolute;
  top: 3.5rem;
  right: 0;
  bottom: 0;
  width: 320px;
  z-index: 25;
  display: flex;
  background: rgba(30, 41, 59, 0.92);
  border-left: 1px solid rgba(71, 85, 105, 0.8);
  backdrop-filter: blur(8px);
  transition: width 0.2s ease;
}
.hud-right.collapsed {
  width: 2rem;
}
.panel-toggle {
  width: 2rem;
  flex-shrink: 0;
  border: none;
  border-right: 1px solid #334155;
  background: rgba(15, 23, 42, 0.8);
  color: #cbd5e1;
  cursor: pointer;
  font-size: 1rem;
}
.panel-inner {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0.75rem;
}
.panel-heading {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.block {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #334155;
}
.block h3 {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #94a3b8;
}
.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.export-name-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.export-name-label {
  font-size: 0.72rem;
  color: #94a3b8;
}
.export-name-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #1e293b;
  color: #f8fafc;
  font-size: 0.82rem;
}
.export-name-input:focus {
  outline: none;
  border-color: #64748b;
}
button,
.file-btn {
  padding: 0.35rem 0.65rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
  cursor: pointer;
  font-size: 0.82rem;
}
.file-btn {
  display: inline-block;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: #94a3b8;
}
.err {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: #f87171;
}
.action-marker-used {
  color: #fcd34d;
}
.action-list,
.marker-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
}
.marker-details summary {
  color: #94a3b8;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.marker-details[open] summary {
  margin-bottom: 0.5rem;
}
.help-block {
  background: rgba(15, 23, 42, 0.45);
  border-radius: 8px;
  padding: 0.5rem 0.55rem;
  margin-bottom: 0.75rem;
}
.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.help-head h3 {
  margin: 0;
}
.help-toggle {
  padding: 0.15rem 0.45rem;
  font-size: 0.85rem;
  line-height: 1;
}
.help-list {
  margin: 0.45rem 0 0;
  padding-left: 1rem;
  font-size: 0.78rem;
  color: #cbd5e1;
}
.help-list li {
  margin-bottom: 0.35rem;
}
.mode-row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}
.mode-btn {
  flex: 1;
  padding: 0.4rem 0.35rem;
  font-size: 0.76rem;
  border-radius: 6px;
  border: 2px solid #475569;
  background: #0f172a;
  color: #cbd5e1;
  cursor: pointer;
}
.mode-btn.active {
  color: #f8fafc;
}
.mode-btn.active:not(.mode-btn--action):not(.mode-btn--production) {
  border-color: #cbd5e1;
  background: #334155;
}
.mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mode-btn--action.active {
  border-color: #38bdf8;
  background: #0c4a6e;
}
.mode-btn--production.active {
  border-color: #fb923c;
  background: #7c2d12;
}
.phase-advance-btn {
  display: block;
  width: 100%;
  padding: 0.6rem 0.85rem;
  margin-top: 0.15rem;
  border-radius: 8px;
  border: 2px solid color-mix(in srgb, var(--player-color, #3b82f6) 55%, #fff);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--player-color, #3b82f6) 88%, #fff),
    var(--player-color, #3b82f6)
  );
  color: #fff;
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.25;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  animation: phase-advance-pulse 1.55s ease-in-out infinite;
  box-shadow:
    0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 45%, transparent),
    0 2px 6px rgba(0, 0, 0, 0.35);
}
.phase-advance-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}
.phase-advance-btn:disabled {
  animation: none;
  opacity: 0.55;
  cursor: wait;
}
.active-player-block {
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  border: 2px solid color-mix(in srgb, var(--player-color, #3b82f6) 55%, #fff);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--player-color, #3b82f6) 28%, rgba(15, 23, 42, 0.9)),
    rgba(15, 23, 42, 0.75)
  );
  animation: active-player-pulse 1.55s ease-in-out infinite;
}
.active-player-label {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: #f8fafc;
}
.active-player-label strong {
  color: color-mix(in srgb, var(--player-color, #3b82f6) 65%, #fff);
}
.active-player-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--player-color, #3b82f6);
  box-shadow: 0 0 8px color-mix(in srgb, var(--player-color, #3b82f6) 70%, transparent);
  animation: active-player-dot 1.55s ease-in-out infinite;
}
@keyframes active-player-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 30%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--player-color, #3b82f6) 0%, transparent);
  }
}
@keyframes active-player-dot {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
}
@keyframes phase-advance-pulse {
  0%,
  100% {
    box-shadow:
      0 0 4px 1px color-mix(in srgb, var(--player-color, #3b82f6) 35%, transparent),
      0 2px 6px rgba(0, 0, 0, 0.35);
    filter: brightness(1);
  }
  50% {
    box-shadow:
      0 0 16px 5px color-mix(in srgb, var(--player-color, #3b82f6) 72%, transparent),
      0 0 28px 2px color-mix(in srgb, var(--player-color, #3b82f6) 40%, transparent),
      0 2px 8px rgba(0, 0, 0, 0.4);
    filter: brightness(1.1);
  }
}
</style>
