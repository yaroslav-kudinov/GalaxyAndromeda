<script setup lang="ts">
import type { GalaxySaveFile, GameSnapshot, HexCoord, LegalAction, MapDefinition, ShipMovePlan, BombardmentPlan, CombatOptions, CombatResolutionResult } from '@galaxy/rules'
import {
  createEmptyMap,
  executeMarkerBombardment,
  executeMarkerMovement,
  executeProductionBatch,
  executeProductionRecharge,
  galaxySaveFromMap,
  gameSnapshotFromMap,
  gameSnapshotFromObservation,
  gameStateFromSnapshot,
  resolveRegionIdForCell,
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
  ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
  ACTION_MARKER_REMOVE_BLOCKED_MSG,
  mustResolveActionMarkerBeforeAdvance,
  getLegalActionsForSnapshot,
  applyGameActionOnSnapshot,
  buildSpatialSummary,
  getActiveEventObservation,
  getTurnEventHistory,
  removeActionMarker,
  canRemoveActionMarkerThisTurn,
  canExecuteProductionMarkerThisTurn,
  canRemoveProductionMarkerThisTurn,
  hasResolvedProductionMarkerThisTurn,
  mustResolveProductionMarkerBeforeAdvance,
  PRODUCTION_MARKER_ALREADY_RESOLVED_MSG,
  PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG,
  PRODUCTION_MARKER_REMOVE_BLOCKED_MSG,
  removeProductionMarker,
  syncParticipatingPlayerIds,
  ensureActivePlayerParticipating,
  shouldConfirmPlanningPhaseAdvance,
  hasUnplacedActionMarkerCapacity,
  MAX_LOBBY_PLAYERS,
  MAX_ACTION_MARKERS_PER_PLAYER,
  buildCombatPreviewFromPending,
  combatPrepOf,
  combatRoundStateOf,
  combatResolutionFingerprint,
  getCombatRetreatDestinations,
} from '@galaxy/rules'
import { fetchObservation, fetchRoomBootstrap, GameApiError, joinRoom, rejoinRoom, submitGameAction, updateCombatPrepAction } from '~/composables/useGameApi'
import { gameSaveStorageKey, loadGameSessionForRoom, saveGameSession } from '~/composables/useGameSession'
import { loadPlayerClaim, savePlayerClaim } from '~/composables/usePlayerClaim'
import { bootstrapToLobbySlots, defaultSlotForRoom, roomHasFreeSlot } from '~/utils/lobby-slot'
import { useGamePresence } from '~/composables/useGamePresence'
import { usePlayerProfile } from '~/composables/usePlayerProfile'
import { useObservationSync } from '~/composables/useObservationSync'
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'
import { useMarkerMapPick, type MarkerOrderConfirmResult } from '~/composables/useMarkerMapPick'
import { useProductionShipPick } from '~/composables/useProductionShipPick'
import { snapshotToBoardCells } from '~/utils/board-adapter'
import {
  gameHelpForPhase,
  legalActionChipIcon,
  legalActionChipLabel,
  phaseGuidanceForTurn,
  type HelpStepIcon,
  type MarkerKind,
  type PlanningSubStep,
} from '~/utils/game-help'

definePageMeta({ layout: 'immersive' })

const route = useRoute()
const roomId = computed(() => route.params.roomId as string)

const session = loadGameSessionForRoom(roomId.value)
const playerId = ref(session?.playerId ?? 'player-1')
const { nickname, hasNickname } = usePlayerProfile()

const needsJoin = ref(false)
const joinError = ref<string | null>(null)
const joinBusy = ref(false)
const selectedJoinSlot = ref<string | null>(null)
const roomBootstrap = ref<Awaited<ReturnType<typeof fetchRoomBootstrap>> | null>(null)
const inviteCopied = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | null = null
let joinLobbyTimer: ReturnType<typeof setInterval> | null = null
let pollingGeneration = 0
/** Отменяет устаревшие ответы polling, если игрок уже применил своё действие */
let observationEpoch = 0

function bumpObservationEpoch(): void {
  observationEpoch++
  observationSync.expectNextRevision()
}

const saveFile = ref<GalaxySaveFile | null>(null)
const selectedKey = ref<string | null>(null)
const panelCollapsed = ref(false)
const legalActions = ref<LegalAction[]>([])
const serverStatus = ref<'idle' | 'loading' | 'online' | 'offline'>('idle')
const loadError = ref<string | null>(null)
const participationHint = ref<string | null>(null)

const observationSync = useObservationSync({
  enabled: () =>
    serverStatus.value === 'online'
    && !needsJoin.value
    && !roomId.value.startsWith('local-'),
  fetchAndApply: async () => {
    const epoch = observationEpoch
    const obs = await fetchObservation(roomId.value, playerId.value)
    if (epoch !== observationEpoch) return false
    const applied = applyObservation(obs, undefined, 'resync')
    if (applied) persistLocal()
    return applied
  },
})
const {
  warningVisible: syncWarningVisible,
  warningReason: syncWarningReason,
  resyncing: syncResyncing,
} = observationSync

function reloadPage() {
  if (import.meta.client) window.location.reload()
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GameApiError && error.status === 400) {
    void observationSync.resync('Сервер отклонил действие. Получаем актуальное состояние.')
  }
  return error instanceof Error ? error.message : fallback
}

const LOBBY_MAX_PLAYERS = MAX_LOBBY_PLAYERS
const exportFileName = ref('')
const markerHint = ref<string | null>(null)
const phaseHint = ref<string | null>(null)
const advancingPhase = ref(false)
const planningActionStepSkipped = ref(false)
/** Ручной подшаг планирования; приоритет над авто-переходом к производству */
const planningSubStepOverride = ref<PlanningSubStep | null>(null)
const showHelp = ref(true)
const markerActionOpen = ref(false)
const markerActionSource = ref<HexCoord | null>(null)
const markerActionHint = ref<string | null>(null)
const markerActionBusy = ref(false)
const battleModalOpen = ref(false)
const rulesHelpOpen = ref(false)

const RULES_NEWBIE_TIP_STORAGE_KEY = 'galaxy-rules-newbie-tip-dismissed'
const showRulesNewbieTip = ref(
  (() => {
    if (!import.meta.client) return true
    try {
      return localStorage.getItem(RULES_NEWBIE_TIP_STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })(),
)

function dismissRulesNewbieTip() {
  showRulesNewbieTip.value = false
  try {
    localStorage.setItem(RULES_NEWBIE_TIP_STORAGE_KEY, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

function openRulesHelp() {
  rulesHelpOpen.value = true
  if (showRulesNewbieTip.value) dismissRulesNewbieTip()
}
const battlePreviewSnapshot = ref<import('@galaxy/rules').CombatPreview | null>(null)
const pendingOrderAfterBattle = ref<MarkerOrderConfirmResult | null>(null)
const battleResolution = ref<CombatResolutionResult | null>(null)
/** Fingerprint итога, который игрок уже закрыл — чтобы poll не открывал модалку снова */
const dismissedCombatResultKey = ref<string | null>(null)
const battleResolving = ref(false)
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
const markerMapPickCombatPreview = markerMapPick.combatPreview
const markerMapPickRoundOneOdds = markerMapPick.roundOneOdds
const markerMapPickOrderReady = markerMapPick.orderReady
const markerMapPickHasPendingCombat = markerMapPick.hasPendingCombat
const markerMapPickConfirmLabel = markerMapPick.confirmButtonLabel
const markerMapPickPreviewMoves = markerMapPick.previewMoves
const productionShipPickActive = productionShipPick.active
const productionShipPickBannerText = productionShipPick.bannerText
const productionShipPickError = productionShipPick.error
const boardCells = computed(() =>
  snapshot.value ? snapshotToBoardCells(snapshot.value) : [],
)

const myPlayerName = computed(() => {
  const fromProfile = nickname.value.trim()
  if (fromProfile) return fromProfile
  const fromSession = session?.playerName
  if (fromSession) return fromSession
  const fromSnapshot = snapshot.value?.players.find((p) => p.id === playerId.value)?.name
  return fromSnapshot ?? playerId.value
})

const presence = useGamePresence(
  () => roomId.value,
  () => playerId.value,
  () => myPlayerName.value,
  () => !needsJoin.value && !roomId.value.startsWith('local-') && serverStatus.value === 'online',
)

const joinLobbySlots = computed((): LobbyPlayerSlot[] => {
  const bootstrap = roomBootstrap.value
  if (!bootstrap) return []
  return bootstrapToLobbySlots(bootstrap)
})

const joinRoomFull = computed(() => {
  const bootstrap = roomBootstrap.value
  if (!bootstrap) return false
  return !roomHasFreeSlot(bootstrap)
})

function syncDefaultJoinSlot() {
  const bootstrap = roomBootstrap.value
  if (!bootstrap) return
  selectedJoinSlot.value = defaultSlotForRoom(roomId.value, bootstrap)
}

watch(roomBootstrap, () => {
  if (needsJoin.value) syncDefaultJoinSlot()
})

const { toasts: statusToasts, pushToast: pushStatusToast } = useGameStatusToasts(snapshot, playerId, myPlayerName)

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

const playerNameById = computed(() => {
  const map: Record<string, string> = {}
  for (const p of snapshot.value?.players ?? []) {
    map[p.id] = p.name
  }
  return map
})

const myPlayer = computed(() =>
  snapshot.value?.players.find((p) => p.id === playerId.value) ?? null,
)

const myPlayerColor = computed(() => myPlayer.value?.color ?? '#3B82F6')

const territoryLabelPlayers = computed(() =>
  (snapshot.value?.players ?? []).map((player, index) => ({
    slot: index + 1,
    name: player.name,
    color: player.color,
  })),
)

const youBadgeStyle = computed(() => ({
  '--my-color': myPlayerColor.value,
}))

const phaseAdvanceBtnStyle = computed(() => ({
  '--player-color': activePlayerColor.value,
}))

const actionMarkers = computed(() => snapshot.value?.actionMarkers ?? [])
const productionMarkers = computed(() => snapshot.value?.productionMarkers ?? [])

const isMyTurn = computed(
  () => snapshot.value?.activePlayerId === playerId.value,
)

const gameOverState = computed(() => snapshot.value?.gameOver ?? null)
const gameOverWinnerName = computed(() => {
  const go = gameOverState.value
  if (!go) return null
  return snapshot.value?.players.find((p) => p.id === go.winnerId)?.name ?? go.winnerId
})

const GAME_OVER_REASON_LABELS: Record<string, string> = {
  four_regions: 'Контроль 4 регионов от 7 клеток',
  power_centers: 'Большинство энергоцентров',
  last_standing: 'Последний игрок на карте',
}

const gameOverReasonLabel = computed(() => {
  const r = gameOverState.value?.reason
  if (!r) return ''
  return GAME_OVER_REASON_LABELS[r] ?? r
})

const pendingCombatState = computed(() => snapshot.value?.pendingCombat ?? null)
const combatPhase = computed(() => pendingCombatState.value?.phase ?? null)
const combatPrepState = computed(() => combatPrepOf(pendingCombatState.value ?? undefined) ?? null)
const combatRoundState = computed(
  () => combatRoundStateOf(pendingCombatState.value ?? undefined) ?? null,
)

const combatPrepPreview = computed(() => {
  if (!snapshot.value) return null
  return buildCombatPreviewFromPending(snapshot.value)
})

/** Любая активная фаза pendingCombat */
const hasActivePendingCombat = computed(() => !!pendingCombatState.value)

/** Может ли игрок поддержать бой соседними кораблями */
const combatSupportCandidate = computed(() => {
  if (combatPhase.value !== 'prep') return null
  return (
    combatPrepPreview.value?.supportCandidates?.find((c) => c.playerId === playerId.value) ?? null
  )
})

/** Роль игрока в текущем бою; null — посторонний наблюдатель */
const combatParticipantRole = computed<'attacker' | 'defender' | 'supporter' | null>(() => {
  const pending = pendingCombatState.value
  if (!pending) return null
  if (pending.attackerId === playerId.value) return 'attacker'
  if (pending.defenderIds.includes(playerId.value)) return 'defender'
  if (combatPrepState.value?.defenderId === playerId.value) return 'defender'
  if (combatSupportCandidate.value) return 'supporter'
  return null
})

/** Победитель раунда — только он выбирает уничтожаемые корабли */
const isCombatDestructionChooser = computed(
  () =>
    combatPhase.value === 'awaiting-destruction'
    && combatRoundState.value?.winnerId === playerId.value,
)

const combatPrepAttackerSkips = computed((): import('@galaxy/rules').ShipType[] => {
  const skips = combatPrepState.value?.combatOptions?.attacker?.prioritySkips ?? []
  return skips.map((s) => s.shipType)
})

const combatPrepDefenderSkips = computed((): import('@galaxy/rules').ShipType[] => {
  const skips = combatPrepState.value?.combatOptions?.defender?.prioritySkips ?? []
  return skips.map((s) => s.shipType)
})

const combatPrepSelfReady = computed(() => {
  const prep = combatPrepState.value
  if (!prep) return false
  return prep.readyBy[playerId.value] === true
})

const combatPrepAttackerReady = computed(() => {
  const prep = combatPrepState.value
  const attId = pendingCombatState.value?.attackerId
  if (!prep || !attId) return false
  return prep.readyBy[attId] === true
})

const combatPrepDefenderReady = computed(() => {
  const prep = combatPrepState.value
  if (!prep) return false
  return prep.readyBy[prep.defenderId] === true
})

const combatDecisionRole = computed<'attacker' | 'defender' | null>(() => {
  const pending = pendingCombatState.value
  if (pending?.phase !== 'awaiting-continue') return null
  if (pending.attackerId === playerId.value && pending.continueDecisions?.attacker == null) return 'attacker'
  if (
    pending.defenderIds.includes(playerId.value)
    && pending.continueDecisions?.attacker === true
    && pending.continueDecisions?.defender == null
  ) return 'defender'
  return null
})

const battleResolutionKey = computed(() =>
  combatResolutionFingerprint(battleResolution.value),
)

const roundResultsPendingView = computed(() => {
  const key = battleResolutionKey.value
  return key != null && key !== dismissedCombatResultKey.value
})

/**
 * Модалка: prep, итоги раунда (всем участникам) и выбор уничтожения победителем.
 * Решение «продолжить / отступить» — баннером после закрытия итогов, чтобы не перекрывать карту.
 */
const needsBattleModal = computed(() => {
  if (combatParticipantRole.value === null) return false
  switch (combatPhase.value) {
    case 'prep':
      return true
    case 'awaiting-destruction':
      return true
    case 'awaiting-continue':
      return roundResultsPendingView.value
    default:
      return false
  }
})

/** Сейчас ваш ход решить: продолжить бой или отступить (после просмотра итогов) */
const showCombatContinueDecision = computed(
  () =>
    combatPhase.value === 'awaiting-continue'
    && combatDecisionRole.value != null
    && !battleModalOpen.value,
)

/** Идёт бой, в котором вы сейчас ничего не решаете */
const showForeignCombatBanner = computed(
  () =>
    hasActivePendingCombat.value
    && !needsBattleModal.value
    && !showCombatContinueDecision.value,
)

const foreignCombatBannerText = computed(() => {
  const pending = pendingCombatState.value
  if (!pending) return ''
  const cell = pending.cellKey
  if (combatPhase.value === 'prep') return `Идёт подготовка к бою на (${cell})`
  if (combatPhase.value === 'awaiting-destruction') {
    const winner = combatRoundState.value?.winnerId
    const winnerName = winner ? playerNameById.value[winner] ?? winner : ''
    return `Бой на (${cell}): победитель раунда${winnerName ? ` ${winnerName}` : ''} выбирает потери`
  }
  if (pending.phase === 'awaiting-continue') {
    const mustContinue = pending.shipsDestroyedInCombat !== true
    if (pending.continueDecisions.attacker !== true) {
      const attackerName = playerNameById.value[pending.attackerId] ?? 'атакующий'
      if (mustContinue) {
        return combatParticipantRole.value === 'defender'
          ? `Раунд окончен без уничтожений — отступление недоступно. Ожидайте подтверждения атакующего (${attackerName}).`
          : `Бой на (${cell}): без уничтожений — атакующий (${attackerName}) подтверждает продолжение`
      }
      return combatParticipantRole.value === 'defender'
        ? `Раунд окончен. Ожидайте решения атакующего (${attackerName}): продолжить бой или отступить. Затем очередь перейдёт к вам.`
        : `Бой на (${cell}): атакующий (${attackerName}) выбирает — продолжить или отступить`
    }
    const defenderId = pending.defenderIds[0]
    const defenderName = defenderId ? playerNameById.value[defenderId] ?? 'защитник' : 'защитник'
    if (mustContinue) {
      return combatParticipantRole.value === 'attacker'
        ? `Вы продолжили бой. Ожидайте подтверждения защитника (${defenderName}) — отступление пока недоступно.`
        : `Бой на (${cell}): без уничтожений — защитник (${defenderName}) подтверждает продолжение`
    }
    return combatParticipantRole.value === 'attacker'
      ? `Вы продолжили бой. Ожидайте решения защитника (${defenderName}): продолжить или отступить.`
      : `Бой на (${cell}): защитник (${defenderName}) выбирает — продолжить или отступить`
  }
  return `Бой на (${cell}): стороны решают, продолжать ли сражение`
})

const combatRetreatAllowed = computed(
  () => pendingCombatState.value?.shipsDestroyedInCombat === true,
)

const retreatDestinations = computed(() => {
  if (!snapshot.value || !combatDecisionRole.value || !combatRetreatAllowed.value) {
    return [] as HexCoord[]
  }
  return getCombatRetreatDestinations(snapshot.value, playerId.value)
})

const retreatDestinationKeys = computed(() =>
  retreatDestinations.value.map((coord) => hexKey(coord.q, coord.r)),
)

/** Клетка отступления под курсором кнопки в баннере */
const retreatHoverKey = ref<string | null>(null)

watch(showCombatContinueDecision, (active) => {
  if (!active) retreatHoverKey.value = null
})

watch(
  battleResolutionKey,
  (key, prev) => {
    // Новый результат снова показывается, но не затираем намеренный dismiss именно
    // этого ключа (confirm-destruction ставит его синхронно до flush watcher-ов).
    if (key && key !== prev && dismissedCombatResultKey.value !== key) {
      dismissedCombatResultKey.value = null
    }
  },
)

function openBattleModalFromPending() {
  if (!needsBattleModal.value || !snapshot.value) return
  const preview = buildCombatPreviewFromPending(snapshot.value)
  if (!preview) {
    // Нельзя показать итоги — не блокируем баннер continue/retreat.
    if (combatPhase.value === 'awaiting-continue' && battleResolutionKey.value) {
      dismissedCombatResultKey.value = battleResolutionKey.value
    }
    return
  }
  battlePreviewSnapshot.value = preview
  battleModalOpen.value = true
}

watch(
  pendingCombatState,
  (pending, prev) => {
    if (!pending) {
      dismissedCombatResultKey.value = null
      if (prev?.phase === 'prep' && battleModalOpen.value && !battleResolution.value) {
        void resyncAfterCombatCountdown()
      }
      return
    }

    // Пока идёт бой — модалка маркера не должна перекрывать continue/retreat.
    if (markerActionOpen.value) {
      markerActionOpen.value = false
      markerActionSource.value = null
    }

    openBattleModalFromPending()
  },
  { deep: true },
)

watch(
  [needsBattleModal, battleResolutionKey],
  () => {
    openBattleModalFromPending()
  },
)

watch(
  () => combatPrepState.value?.phase,
  (phase, prev) => {
    if (prev === 'countdown' && phase !== 'countdown') {
      if (!battleResolution.value) {
        void resyncAfterCombatCountdown()
      }
    }
    if (prev === 'countdown' && phase === 'prep') {
      battleResolution.value = null
      dismissedCombatResultKey.value = null
    }
  },
)

const supplyChainHighlightKeys = computed((): string[] => {
  if (!saveFile.value?.game || !saveFile.value?.map) return []
  if (snapshot.value?.phase !== 'production') return []
  const state = gameStateFromSnapshot(saveFile.value.game, saveFile.value.map.id)
  const summary = buildSpatialSummary(state)
  return summary.supplyChains
    .filter((c) => c.playerId === playerId.value)
    .flatMap((c) => c.path)
})

const planningSubStep = computed((): PlanningSubStep => {
  if (snapshot.value?.phase !== 'planning' || !isMyTurn.value) return 'action-markers'
  if (planningSubStepOverride.value) return planningSubStepOverride.value
  if (planningActionStepSkipped.value) return 'production-markers'
  if (!saveFile.value?.game) return 'action-markers'
  if (!hasUnplacedActionMarkerCapacity(saveFile.value.game, playerId.value)) {
    return 'production-markers'
  }
  return 'action-markers'
})

const effectiveMarkerKind = computed((): MarkerKind => {
  const phase = snapshot.value?.phase
  if (phase === 'production') return 'production'
  if (phase === 'actions' || phase === 'events') return 'action'
  return planningSubStep.value === 'production-markers' ? 'production' : 'action'
})

const canPlaceMarkers = computed(
  () => isMyTurn.value && snapshot.value?.phase === 'planning',
)

const showPlanningActionDoneBtn = computed(
  () =>
    canPlaceMarkers.value
    && planningSubStep.value === 'action-markers'
    && saveFile.value?.game
    && (
      hasUnplacedActionMarkerCapacity(saveFile.value.game, playerId.value)
      || planningSubStepOverride.value === 'action-markers'
    ),
)

const showPlanningBackToActionBtn = computed(
  () =>
    canPlaceMarkers.value
    && planningSubStep.value === 'production-markers',
)

watch(
  [() => snapshot.value?.phase, () => snapshot.value?.activePlayerId],
  () => {
    planningActionStepSkipped.value = false
    planningSubStepOverride.value = null
  },
)

function finishPlanningActionStep() {
  planningActionStepSkipped.value = true
  planningSubStepOverride.value = 'production-markers'
  markerHint.value = null
}

function backToPlanningActionStep() {
  planningSubStepOverride.value = 'action-markers'
  markerHint.value = null
}

const actionMarkerUsedThisTurn = computed(() =>
  snapshot.value ? hasResolvedActionMarkerThisTurn(snapshot.value) : false,
)

const mustResolveActionMarker = computed(() =>
  saveFile.value?.game
    ? mustResolveActionMarkerBeforeAdvance(saveFile.value.game, playerId.value)
    : false,
)

const mustResolveProductionMarker = computed(() =>
  saveFile.value?.game
    ? mustResolveProductionMarkerBeforeAdvance(saveFile.value.game, playerId.value)
    : false,
)

const phaseAdvanceBlockedReason = computed(() => {
  if (mustResolveActionMarker.value) return ACTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG
  if (mustResolveProductionMarker.value) return PRODUCTION_MARKER_MUST_RESOLVE_BEFORE_ADVANCE_MSG
  return null
})

const canAdvancePhase = computed(() => !phaseAdvanceBlockedReason.value)

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

const playerColorById = computed(() => {
  const map: Record<string, string> = {}
  for (const p of snapshot.value?.players ?? []) {
    map[p.id] = p.color
  }
  return map
})

function sidePanelPlayerColor(ownerId: string): string {
  return playerColorById.value[ownerId] ?? '#64748b'
}

function sidePanelPlayerName(ownerId: string): string {
  return playerNameById.value[ownerId] ?? ownerId
}

function helpStepSymbol(icon: HelpStepIcon): string {
  const symbols: Record<HelpStepIcon, string> = {
    wait: '…',
    event: '✦',
    click: '⌖',
    'marker-action': '●',
    'marker-prod': '■',
    ship: '▲',
    fight: '⚔',
    build: '⚙',
    queue: '☰',
    limit: '#',
    pass: '→',
    tip: 'i',
  }
  return symbols[icon] ?? '·'
}

const currentPhase = computed(() => snapshot.value?.phase)

const sidePanelActionRemaining = computed(() =>
  Math.max(0, MAX_ACTION_MARKERS_PER_PLAYER - myActionMarkerCount.value),
)

const sidePanelProdRemaining = computed(() =>
  Math.max(0, maxProductionRegions.value - myProductionMarkerCount.value),
)

const showActionsControls = computed(
  () => isMyTurn.value && currentPhase.value === 'actions',
)

const showProductionControls = computed(
  () => isMyTurn.value && currentPhase.value === 'production',
)

const advancePhaseLabel = computed(() => {
  if (!saveFile.value?.game) return 'Далее'
  return phaseAdvanceActionLabelForSnapshot(saveFile.value.game, saveFile.value.map.id)
})

function applyObservation(
  obs: Awaited<ReturnType<typeof fetchObservation>>,
  map?: MapDefinition,
  source: 'action' | 'poll' | 'resync' | 'initial' = 'action',
): boolean {
  const mechExtra = obs.mechanics as Record<string, unknown>
  const revision = mechExtra.observationRevision as number | undefined
  if (!observationSync.observe(revision, source)) return false

  legalActions.value = obs.legalActions ?? []
  const preserve = saveFile.value?.game
  const game = gameSnapshotFromObservation(
    obs.mechanics,
    preserve ?? undefined,
    map ?? saveFile.value?.map,
  )

  if ('lastCombatResult' in mechExtra) {
    const next = (mechExtra.lastCombatResult as CombatResolutionResult | null) ?? null
    const prevKey = combatResolutionFingerprint(battleResolution.value)
    const nextKey = combatResolutionFingerprint(next)
    if (prevKey !== nextKey) {
      battleResolution.value = next
    }
  }
  if (saveFile.value) {
    saveFile.value = {
      ...saveFile.value,
      savedAt: new Date().toISOString(),
      ...(map ? { map: normalizeMapDefinition(map) } : {}),
      game,
    }
    return true
  }

  if (!map) return false
  saveFile.value = {
    format: 'galaxy-save',
    version: 1,
    savedAt: new Date().toISOString(),
    map: normalizeMapDefinition(map),
    game,
  }
  return true
}

async function endPhase() {
  if (!saveFile.value?.game || !isMyTurn.value || advancingPhase.value) return

  if (phaseAdvanceBlockedReason.value) {
    phaseHint.value = phaseAdvanceBlockedReason.value
    return
  }

  if (
    shouldConfirmPlanningPhaseAdvance(
      saveFile.value.game,
      saveFile.value.map,
      playerId.value,
    )
    && !confirm(
      'Вы не расставили все доступные маркеры действия или производства.\n\nЗавершить планирование без них?',
    )
  ) {
    return
  }

  phaseHint.value = null
  advancingPhase.value = true
  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      bumpObservationEpoch()
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
    phaseHint.value = actionErrorMessage(e, 'Не удалось сменить фазу')
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

const activeEvent = computed((): import('@galaxy/rules').ActiveEventObservation | null => {
  if (!saveFile.value?.game) return null
  return getActiveEventObservation(saveFile.value.game)
})

const turnEventHistory = computed(() => {
  if (!saveFile.value?.game) return []
  return getTurnEventHistory(saveFile.value.game)
})

const currentTurnEventResolvedAt = computed(
  () => saveFile.value?.game?.turnEvent?.resolvedAt,
)

const showTurnEventsPanel = computed(
  () => !!activeEvent.value || turnEventHistory.value.length > 0,
)

const phaseGuidance = computed(() =>
  phaseGuidanceForTurn(snapshot.value?.phase, isMyTurn.value, {
    planningSubStep: planningSubStep.value,
    actionMarkersPlaced: myActionMarkerCount.value,
    actionMarkersMax: MAX_ACTION_MARKERS_PER_PLAYER,
    productionMarkersPlaced: myProductionMarkerCount.value,
    productionMarkersMax: maxProductionRegions.value,
    actionMarkerUsedThisTurn: actionMarkerUsedThisTurn.value,
    actionMarkerUnresolved: mustResolveActionMarker.value,
    productionMarkerUsedThisTurn: productionMarkerUsedThisTurn.value,
    eventResolved: activeEvent.value?.resolved ?? false,
  }),
)

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
    phase === 'planning'
    && planningSubStep.value === 'action-markers'
    && canRemoveActionMarkerThisTurn(game, playerId.value)
  ) {
    return keys()
  }

  if (
    phase === 'actions'
    && !canExecuteActionMarkerThisTurn(game, playerId.value)
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
  ) {
    return keys()
  }

  if (phase === 'planning' && planningSubStep.value === 'production-markers') {
    return keys()
  }

  if (
    phase === 'production'
    && !canExecuteProductionMarkerThisTurn(snapshot.value, playerId.value)
    && canRemoveProductionMarkerThisTurn(snapshot.value, playerId.value)
  ) {
    return keys()
  }

  return []
})

const boardReachableKeys = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.reachableKeys.value
  if (productionShipPickActive.value) return productionShipPick.reachableKeys.value
  if (showCombatContinueDecision.value) return retreatDestinationKeys.value
  return []
})
const boardContestedKeys = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.contestedKeys.value
  // Клетка боя — ориентир, куда сейчас идёт сражение.
  if (showCombatContinueDecision.value && pendingCombatState.value?.cellKey) {
    return [pendingCombatState.value.cellKey]
  }
  return []
})
const boardDestinationKeys = computed(() => {
  if (markerMapPickActive.value) return markerMapPick.destinationKeys.value
  if (productionShipPickActive.value) return productionShipPick.destinationKeys.value
  if (showCombatContinueDecision.value && retreatHoverKey.value) {
    return [retreatHoverKey.value]
  }
  return []
})
const boardPreviewMoves = computed(() => {
  if (markerMapPickActive.value) {
    return markerMapPickPreviewMoves.value.map((m) => ({
      from: m.from,
      to: m.to,
      shipId: m.shipId,
      combat: m.combat,
    }))
  }
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
      bumpObservationEpoch()
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
    productionHint.value = actionErrorMessage(e, 'Не удалось выполнить постройку')
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
      bumpObservationEpoch()
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
      productionHint.value = 'Фишки ресурсов перезаряжены'
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
    productionHint.value = 'Фишки ресурсов перезаряжены'
  } catch (e) {
    productionHint.value = actionErrorMessage(e, 'Не удалось перезарядить фишки ресурсов')
  } finally {
    productionBusy.value = false
  }
}

function openMarkerActionModal(q: number, r: number) {
  if (hasActivePendingCombat.value) {
    markerHint.value = 'Сначала завершите текущий бой (продолжить или отступить)'
    return
  }
  markerActionSource.value = { q, r }
  markerActionOpen.value = true
  markerActionHint.value = null
}

function closeMarkerActionModal() {
  markerActionOpen.value = false
  markerActionSource.value = null
}

function startMarkerMapPick(payload: { shipIds: string[]; mode: 'movement' | 'bombardment' }) {
  if (!markerActionSource.value) return
  markerActionOpen.value = false
  markerMapPick.start(markerActionSource.value, payload.shipIds, payload.mode)
  markerActionHint.value = null
}

function cancelMarkerMapPick() {
  markerMapPick.cancel()
  markerActionSource.value = null
  markerActionHint.value = null
  battleModalOpen.value = false
  battlePreviewSnapshot.value = null
  pendingOrderAfterBattle.value = null
  battleResolution.value = null
  battleResolving.value = false
}

async function confirmMarkerOrder() {
  const hadCombat = markerMapPickHasPendingCombat.value
  const previewSnap = markerMapPickCombatPreview.value

  const result = markerMapPick.tryConfirmOrder()
  if (!result) return

  if (hadCombat && previewSnap) {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      markerActionBusy.value = true
      markerActionHint.value = null
      try {
        bumpObservationEpoch()
        const obs =
          result.kind === 'bombardment'
            ? await submitGameAction(roomId.value, playerId.value, 'execute-marker-bombardment', {
                from: result.from,
                bombardments: result.bombardments,
              })
            : await submitGameAction(roomId.value, playerId.value, 'execute-marker-movement', {
                from: result.from,
                moves: result.moves,
              })
        applyObservation(obs)
        persistLocal()
        battlePreviewSnapshot.value = previewSnap
        battleModalOpen.value = true
      } catch (e) {
        markerActionHint.value = actionErrorMessage(e, 'Не удалось начать подготовку к бою')
      } finally {
        markerActionBusy.value = false
      }
      return
    }

    battlePreviewSnapshot.value = previewSnap
    battleModalOpen.value = true
    pendingOrderAfterBattle.value = result
    return
  }

  if (result.kind === 'bombardment') {
    await confirmMarkerBombardment(result.bombardments, result.from)
    return
  }

  await confirmMarkerMovement(result.moves, result.from)
}

function closeBattleModal() {
  const resultKey = battleResolutionKey.value
  if (
    resultKey
    && (
      combatPhase.value === 'awaiting-continue'
      || (combatPhase.value === 'awaiting-destruction' && !isCombatDestructionChooser.value)
    )
  ) {
    dismissedCombatResultKey.value = resultKey
  }

  battleModalOpen.value = false
  markerMapPick.afterBattleModalClosed()
  battlePreviewSnapshot.value = null
  pendingOrderAfterBattle.value = null
  if (combatPhase.value !== 'awaiting-destruction' && combatPhase.value !== 'awaiting-continue') {
    battleResolution.value = null
  }
  battleResolving.value = false
  markerActionSource.value = null
}

async function resolveBattleWithOptions(combatOptions: CombatOptions) {
  if (combatPrepState.value && serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
    await submitCombatPrepReady(combatOptions)
    return
  }

  const pending = pendingOrderAfterBattle.value
  if (!pending || battleResolving.value) return
  battleResolving.value = true
  markerActionHint.value = null

  try {
    if (pending.kind === 'bombardment') {
      await confirmMarkerBombardment(pending.bombardments, pending.from, combatOptions)
    } else {
      await confirmMarkerMovement(pending.moves, pending.from, combatOptions)
    }
    if (saveFile.value?.game) {
      const lastEvt = saveFile.value.game.eventLog.at(-1)
      if (lastEvt && !battleResolution.value?.needsDestructionSelection) {
        markerActionHint.value = lastEvt.message
      }
    }
    if (battleResolution.value?.needsDestructionSelection) {
      markerActionHint.value = 'Выберите корабли для уничтожения'
    } else if (!battleResolution.value?.needsDestructionSelection) {
      pendingOrderAfterBattle.value = null
    }
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось разрешить бой')
  } finally {
    battleResolving.value = false
  }
}

async function submitCombatPrepReady(combatOptions: CombatOptions) {
  if (battleResolving.value) return
  battleResolving.value = true
  markerActionHint.value = null
  try {
    const prep = combatPrepState.value
    const pending = pendingCombatState.value
    if (!prep || !pending) return

    const isAttacker = pending.attackerId === playerId.value
    const sideSkips = isAttacker
      ? combatOptions.attacker?.prioritySkips
      : combatOptions.defender?.prioritySkips

    bumpObservationEpoch()
    const obs = await updateCombatPrepAction(roomId.value, playerId.value, true, sideSkips)
    applyObservation(obs)
    persistLocal()
    markerActionHint.value = 'Готовность отправлена'
  } catch (e) {
    const msg = actionErrorMessage(e, 'Не удалось подтвердить готовность')
    markerActionHint.value = msg
    pushStatusToast('error', 'Подготовка к бою', msg)
  } finally {
    battleResolving.value = false
  }
}

async function submitCombatPrepUnready() {
  if (battleResolving.value) return
  battleResolving.value = true
  try {
    bumpObservationEpoch()
    const obs = await updateCombatPrepAction(roomId.value, playerId.value, false)
    applyObservation(obs)
    persistLocal()
    markerActionHint.value = 'Готовность снята'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось снять готовность')
  } finally {
    battleResolving.value = false
  }
}

async function submitCombatSupportSide(side: 'attacker' | 'defender' | null) {
  if (battleResolving.value) return
  battleResolving.value = true
  try {
    bumpObservationEpoch()
    const obs = await submitGameAction(roomId.value, playerId.value, 'update-combat-prep', {
      ready: false,
      supportSide: side,
    })
    applyObservation(obs)
    persistLocal()
    markerActionHint.value = side == null ? 'Вы не поддерживаете никого в этом бою' : 'Поддержка выбрана'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось выбрать поддержку')
  } finally {
    battleResolving.value = false
  }
}

async function cancelCombatPrepAction() {
  if (battleResolving.value) return
  battleResolving.value = true
  try {
    bumpObservationEpoch()
    const obs = await submitGameAction(roomId.value, playerId.value, 'cancel-combat-prep')
    applyObservation(obs)
    persistLocal()
    closeBattleModal()
    markerActionHint.value = 'Подготовка к бою отменена'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось отменить подготовку')
  } finally {
    battleResolving.value = false
  }
}

async function confirmBattleDestruction(destructionSelection: string[]) {
  if (battleResolving.value) return
  battleResolving.value = true
  markerActionHint.value = null

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      bumpObservationEpoch()
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'confirm-combat-destruction',
        { destructionSelection },
      )
      applyObservation(obs)
      battleResolution.value =
        (obs.mechanics as { lastCombatResult?: CombatResolutionResult }).lastCombatResult ?? null
      persistLocal()
    } else if (saveFile.value?.game && saveFile.value.map) {
      const result = applyGameActionOnSnapshot(
        saveFile.value.game,
        saveFile.value.map,
        playerId.value,
        'confirm-combat-destruction',
        { destructionSelection },
      )
      if (result.errors.length) {
        markerActionHint.value = result.errors[0] ?? null
        return
      }
      battleResolution.value = result.combatResult ?? null
      persistLocal()
      refreshLocalLegalActions()
    }

    pendingOrderAfterBattle.value = null
    markerActionSource.value = null
    // Подтверждающий уже видел итог на экране выбора потерь — сразу закрываем модалку,
    // чтобы показался баннер continue/retreat (он скрыт, пока модалка открыта).
    if (combatPhase.value === 'awaiting-continue') {
      closeBattleModal()
      markerActionHint.value = 'Уничтожение применено — выберите: продолжить бой или отступить'
    } else if (!hasActivePendingCombat.value) {
      battleModalOpen.value = false
      if (battleResolutionKey.value) {
        dismissedCombatResultKey.value = battleResolutionKey.value
      }
      markerActionHint.value = 'Уничтожение применено'
    } else {
      markerActionHint.value = 'Уничтожение применено'
    }
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось подтвердить уничтожение')
  } finally {
    battleResolving.value = false
  }
}

async function continuePendingCombatAction() {
  const role = combatDecisionRole.value
  if (!pendingCombatState.value || !role) return
  retreatHoverKey.value = null
  bumpObservationEpoch()
  try {
    const obs = await submitGameAction(roomId.value, playerId.value, 'continue-combat')
    applyObservation(obs)
    persistLocal()
    // Новый раунд / конец боя — показать актуальный lastCombatResult (не старый флот).
    const nextResult =
      (obs.mechanics as { lastCombatResult?: CombatResolutionResult }).lastCombatResult ?? null
    if (nextResult) {
      battleResolution.value = nextResult
      dismissedCombatResultKey.value = null
    }
    markerActionHint.value = role === 'attacker'
      ? 'Вы продолжили бой — ждём решения защитника'
      : (combatPhase.value === 'awaiting-continue' || combatPhase.value === 'awaiting-destruction'
        ? 'Бой продолжен'
        : 'Бой завершён')
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось продолжить бой')
  }
}

async function stopPendingCombatAction(retreatTo: HexCoord) {
  if (!pendingCombatState.value || !combatDecisionRole.value) return
  retreatHoverKey.value = null
  bumpObservationEpoch()
  try {
    const obs = await submitGameAction(roomId.value, playerId.value, 'stop-combat', { retreatTo })
    applyObservation(obs)
    markerActionHint.value = `Отступление в (${retreatTo.q}, ${retreatTo.r})`
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось остановить бой')
  }
}

async function abortPendingCombatAction() {
  if (!pendingCombatState.value || !combatParticipantRole.value) return
  bumpObservationEpoch()
  try {
    const obs = await submitGameAction(roomId.value, playerId.value, 'abort-combat')
    applyObservation(obs)
    battleModalOpen.value = false
    battleResolution.value = null
    markerActionHint.value = 'Бой прерван'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось прервать бой')
  }
}

async function resolveMarkerOccupyChoice(occupy: boolean) {
  markerMapPick.resolveControlChoice(occupy)
}

function cancelMarkerPendingControl() {
  markerMapPick.cancelPendingControlChoice()
}

async function confirmMarkerBombardment(
  bombardments: BombardmentPlan[],
  fromOverride?: HexCoord,
  combatOptions?: CombatOptions,
) {
  const from = fromOverride ?? markerActionSource.value
  if (!saveFile.value?.game || !from || markerActionBusy.value) return
  markerActionBusy.value = true
  markerActionHint.value = null

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      bumpObservationEpoch()
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'execute-marker-bombardment',
        { from, bombardments, combatOptions },
      )
      applyObservation(obs)
      battleResolution.value =
        (obs.mechanics as { lastCombatResult?: CombatResolutionResult }).lastCombatResult ?? null
      persistLocal()
      markerActionSource.value = null
      markerActionHint.value = 'Обстрел выполнен'
      return
    }

    const result = executeMarkerBombardment(
      saveFile.value.game,
      saveFile.value.map,
      playerId.value,
      from,
      bombardments,
      combatOptions,
    )
    if (result.errors.length) {
      markerActionHint.value = result.errors[0] ?? null
      return
    }
    battleResolution.value = result.combatResult ?? null
    persistLocal()
    refreshLocalLegalActions()
    markerActionSource.value = null
    markerActionHint.value = 'Обстрел выполнен'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось выполнить обстрел')
  } finally {
    markerActionBusy.value = false
  }
}

async function confirmMarkerMovement(
  moves: ShipMovePlan[],
  fromOverride?: HexCoord,
  combatOptions?: CombatOptions,
) {
  const from = fromOverride ?? markerActionSource.value
  if (!saveFile.value?.game || !from || markerActionBusy.value) return
  markerActionBusy.value = true
  markerActionHint.value = null

  try {
    if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
      bumpObservationEpoch()
      const obs = await submitGameAction(
        roomId.value,
        playerId.value,
        'execute-marker-movement',
        { from, moves, combatOptions },
      )
      applyObservation(obs)
      battleResolution.value =
        (obs.mechanics as { lastCombatResult?: CombatResolutionResult }).lastCombatResult ?? null
      persistLocal()
      markerActionSource.value = null
      markerActionHint.value = 'Движение выполнено'
      return
    }

    const result = executeMarkerMovement(
      saveFile.value.game,
      saveFile.value.map,
      playerId.value,
      from,
      moves,
      combatOptions,
    )
    if (result.errors.length) {
      markerActionHint.value = result.errors[0] ?? null
      return
    }
    battleResolution.value = result.combatResult ?? null
    persistLocal()
    refreshLocalLegalActions()
    markerActionSource.value = null
    markerActionHint.value = 'Движение выполнено'
  } catch (e) {
    markerActionHint.value = actionErrorMessage(e, 'Не удалось выполнить движение')
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
    if (markerMapPick.undoLastAction()) return
    cancelMarkerMapPick()
    return
  }
  if (productionShipPickActive.value) {
    e.preventDefault()
    cancelProductionShipPick()
  }
}

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

/** Отладка offline: при передаче хода управление переключается на активного игрока */
watch(
  () => snapshot.value?.activePlayerId,
  (activeId) => {
    if (!activeId) return
    if (roomId.value.startsWith('local-') && playerId.value !== activeId) {
      playerId.value = activeId
    }
    refreshLocalLegalActions()
  },
)

function persistLocal() {
  if (!import.meta.client || !saveFile.value) return
  localStorage.setItem(gameSaveStorageKey(roomId.value), serializeGalaxySave(saveFile.value))
}

async function ensureJoined(): Promise<boolean> {
  if (roomId.value.startsWith('local-')) return true

  try {
    const bootstrap = await fetchRoomBootstrap(roomId.value)
    roomBootstrap.value = bootstrap
    const sess = loadGameSessionForRoom(roomId.value)
    if (sess && bootstrap.joinedPlayerIds.includes(sess.playerId)) {
      playerId.value = sess.playerId
      return true
    }
    const claim = loadPlayerClaim(roomId.value)
    if (claim && bootstrap.joinedPlayerIds.includes(claim.playerId)) {
      try {
        const name = nickname.value.trim() || claim.playerName
        const { playerId: id, code } = await rejoinRoom(roomId.value, claim.playerId, name)
        playerId.value = id
        saveGameSession({ roomId: roomId.value, playerId: id, playerName: name, code })
        savePlayerClaim({ roomId: roomId.value, playerId: id, playerName: name })
        return true
      } catch {
        /* показать экран входа */
      }
    }
    needsJoin.value = true
    syncDefaultJoinSlot()
    return false
  } catch {
    return true
  }
}

async function refreshJoinLobby() {
  if (roomId.value.startsWith('local-') || !needsJoin.value) return
  try {
    roomBootstrap.value = await fetchRoomBootstrap(roomId.value)
    syncDefaultJoinSlot()
  } catch {
    /* ignore */
  }
}

function startJoinLobbyPolling() {
  stopJoinLobbyPolling()
  if (roomId.value.startsWith('local-')) return
  joinLobbyTimer = setInterval(refreshJoinLobby, 2000)
}

function stopJoinLobbyPolling() {
  if (joinLobbyTimer) {
    clearInterval(joinLobbyTimer)
    joinLobbyTimer = null
  }
}

async function submitJoin() {
  joinError.value = null
  if (!hasNickname.value) {
    joinError.value = 'Сначала выберите никнейм в лобби'
    return
  }
  if (!selectedJoinSlot.value) {
    joinError.value = joinRoomFull.value ? 'Комната заполнена' : 'Выберите слот'
    return
  }
  joinBusy.value = true
  try {
    const name = nickname.value.trim()
    const slotId = selectedJoinSlot.value
    const claim = loadPlayerClaim(roomId.value)
    let id: string
    let code: string

    if (claim && roomBootstrap.value?.joinedPlayerIds.includes(claim.playerId)) {
      const result = await rejoinRoom(
        roomId.value,
        claim.playerId,
        name,
        slotId !== claim.playerId ? slotId : undefined,
      )
      id = result.playerId
      code = result.code
    } else {
      const result = await joinRoom(roomId.value, name, slotId)
      id = result.playerId
      code = result.code
    }

    playerId.value = id
    saveGameSession({ roomId: roomId.value, playerId: id, playerName: name, code })
    savePlayerClaim({ roomId: roomId.value, playerId: id, playerName: name })
    needsJoin.value = false
    stopJoinLobbyPolling()
    await tryLoadFromServer()
    startPolling()
    presence.start()
  } catch (e) {
    joinError.value = e instanceof Error ? e.message : 'Не удалось войти'
    if (e instanceof GameApiError && e.availablePlayerIds?.length) {
      await refreshJoinLobby()
    }
  } finally {
    joinBusy.value = false
  }
}

const inviteLink = computed(() => {
  if (!import.meta.client) return ''
  return `${window.location.origin}/game/${roomId.value}`
})

async function copyInviteLink() {
  if (!inviteLink.value) return
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    inviteCopied.value = true
    setTimeout(() => { inviteCopied.value = false }, 2000)
  } catch {
    /* ignore */
  }
}

async function resyncAfterCombatCountdown() {
  if (serverStatus.value !== 'online' || roomId.value.startsWith('local-')) return
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const obs = await fetchObservation(roomId.value, playerId.value)
      applyObservation(obs, undefined, 'resync')
      persistLocal()
      if (battleResolution.value) return
      if (combatPrepState.value?.phase !== 'countdown') return
    } catch {
      /* ignore transient poll errors */
    }
    await new Promise((r) => setTimeout(r, 350))
  }
}

function startPolling() {
  stopPolling()
  if (roomId.value.startsWith('local-')) return
  const generation = pollingGeneration
  const NORMAL_POLL_MS = 750
  const COMBAT_POLL_MS = 250
  const interval = () => (hasActivePendingCombat.value ? COMBAT_POLL_MS : NORMAL_POLL_MS)
  const scheduleNextPoll = (delay = interval()) => {
    if (
      generation !== pollingGeneration
      || serverStatus.value !== 'online'
      || needsJoin.value
    ) {
      return
    }
    pollTimer = setTimeout(poll, delay)
  }
  const poll = async () => {
    if (generation !== pollingGeneration) return
    pollTimer = null
    try {
      if (serverStatus.value !== 'online' || needsJoin.value) return
      // Действие уже вернёт свежий observation; важно всё равно запланировать
      // следующий poll, иначе один тик во время busy навсегда останавливал sync.
      if (advancingPhase.value || markerActionBusy.value || productionBusy.value) return
      const epoch = observationEpoch
      const obs = await fetchObservation(roomId.value, playerId.value)
      if (generation !== pollingGeneration || epoch !== observationEpoch) return
      if (applyObservation(obs, undefined, 'poll')) {
        observationSync.recordPollSuccess()
        persistLocal()
      }
    } catch (e) {
      if (e instanceof GameApiError && e.message === 'Room not found') {
        serverStatus.value = 'offline'
      } else {
        observationSync.recordPollFailure(e)
      }
    } finally {
      scheduleNextPoll()
    }
  }
  scheduleNextPoll(0)
}

function stopPolling() {
  pollingGeneration++
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function repairLobbyParticipation(joinedPlayerIds?: string[]): boolean {
  if (!saveFile.value?.game || roomId.value.startsWith('local-')) return false

  const game = saveFile.value.game
  const defaultIds = game.players.slice(0, LOBBY_MAX_PLAYERS).map((p) => p.id)
  const ids = joinedPlayerIds?.length
    ? joinedPlayerIds.slice(0, LOBBY_MAX_PLAYERS)
    : (game.participatingPlayerIds?.length
      ? game.participatingPlayerIds
      : defaultIds)

  const prevActive = game.activePlayerId
  const prevParticipating = game.participatingPlayerIds?.join(',') ?? ''

  syncParticipatingPlayerIds(game, ids)

  const changed =
    prevActive !== game.activePlayerId
    || prevParticipating !== (game.participatingPlayerIds?.join(',') ?? '')

  if (changed) {
    const skippedName = prevActive
      ? (game.players.find((p) => p.id === prevActive)?.name ?? prevActive)
      : null
    participationHint.value =
      prevActive && !ids.includes(prevActive)
        ? `${skippedName} не в лобби — ход передан участникам`
        : null
    persistLocal()
  }

  return changed
}

async function tryLoadFromServer() {
  if (roomId.value.startsWith('local-')) {
    serverStatus.value = 'offline'
    return
  }
  serverStatus.value = 'loading'
  try {
    const bootstrap = await fetchRoomBootstrap(roomId.value)
    roomBootstrap.value = bootstrap
    const obs = await fetchObservation(roomId.value, playerId.value)
    applyObservation(obs, bootstrap.map, 'initial')
    if (!selectedKey.value) {
      selectedKey.value = hexKey(bootstrap.map.cells[0]?.q ?? 0, bootstrap.map.cells[0]?.r ?? 0)
    }
    serverStatus.value = 'online'
    repairLobbyParticipation(bootstrap.joinedPlayerIds)
    persistLocal()
  } catch {
    serverStatus.value = 'offline'
    repairLobbyParticipation(roomBootstrap.value?.joinedPlayerIds)
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
    markerMapPick.handleMapSelect(q, r)
    return
  }

  if (showCombatContinueDecision.value && combatRetreatAllowed.value) {
    const key = hexKey(q, r)
    if (retreatDestinationKeys.value.includes(key)) {
      await stopPendingCombatAction({ q, r })
    }
    return
  }

  const phase = snapshot.value?.phase

  if (isMyTurn.value && phase === 'actions' && hasMyActionMarkerAt(q, r)) {
    if (hasActivePendingCombat.value) {
      markerHint.value = 'Сначала завершите текущий бой (продолжить или отступить)'
      return
    }
    if (!canOpenMovementModal.value) {
      markerHint.value = ACTION_MARKER_ALREADY_RESOLVED_MSG
      return
    }
    openMarkerActionModal(q, r)
    return
  }

  if (isMyTurn.value && phase === 'production' && hasMyProductionMarkerAt(q, r)) {
    if (!canOpenProductionModal.value) {
      markerHint.value = PRODUCTION_MARKER_ALREADY_RESOLVED_MSG
      return
    }
    openProductionModal(q, r)
    return
  }

  if (isMyTurn.value && phase === 'planning' && saveFile.value?.game) {
    await toggleMarkerOnCell(q, r)
  }
}

async function toggleMarkerOnCell(q: number, r: number) {
  if (!saveFile.value?.game || !canPlaceMarkers.value) return

  const kind = effectiveMarkerKind.value
  const game = saveFile.value.game
  const cell = game.cells.find((candidate) => candidate.coord.q === q && candidate.coord.r === r)

  if (kind === 'action' && !cell?.actionMarkerId && !cell?.ships.some((ship) => ship.ownerId === playerId.value)) {
    markerHint.value = 'Маркер действия ставится только на клетку с вашим кораблём'
    return
  }

  if (kind === 'production' && !cell?.productionMarkerId) {
    if (cell?.controlOwnerId !== playerId.value) {
      markerHint.value = 'Маркер можно ставить только на своей клетке'
      return
    }
    const state = gameStateFromSnapshot(game, saveFile.value.map.id)
    if (!resolveRegionIdForCell(state, { q, r }, playerId.value)) {
      markerHint.value = 'Маркер производства ставится только в контролируемом регионе (от 3 клетки)'
      return
    }
  }

  if (
    kind === 'action'
    && wouldRemoveMyActionMarkerAt(game, q, r)
    && !confirmRemoveActionMarker()
  ) {
    return
  }

  if (
    kind === 'production'
    && wouldRemoveMyProductionMarkerAt(game, q, r)
    && !confirmRemoveProductionMarker()
  ) {
    return
  }

  if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
    try {
      bumpObservationEpoch()
      const obs = await submitGameAction(roomId.value, playerId.value, 'toggle-marker', {
        coord: { q, r },
        kind,
      })
      applyObservation(obs)
      persistLocal()
    } catch (e) {
      markerHint.value = actionErrorMessage(e, 'Не удалось поставить маркер')
    }
    return
  }

  const errors = toggleMarkerAtCell(
    saveFile.value.game,
    playerId.value,
    { q, r },
    saveFile.value.map,
    kind,
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

  if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
    bumpObservationEpoch()
    submitGameAction(roomId.value, playerId.value, 'remove-marker', {
      markerId: cell.actionMarkerId,
      kind: 'action',
    })
      .then((obs) => {
        applyObservation(obs)
        persistLocal()
        markerHint.value = 'Маркер действия снят'
      })
      .catch((e) => {
        markerHint.value = actionErrorMessage(e, 'Не удалось снять маркер')
      })
    return
  }

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

  if (serverStatus.value === 'online' && !roomId.value.startsWith('local-')) {
    bumpObservationEpoch()
    submitGameAction(roomId.value, playerId.value, 'remove-marker', {
      markerId: cell.productionMarkerId,
      kind: 'production',
    })
      .then((obs) => {
        applyObservation(obs)
        persistLocal()
        markerHint.value = 'Маркер производства снят'
      })
      .catch((e) => {
        markerHint.value = actionErrorMessage(e, 'Не удалось снять маркер')
      })
    return
  }

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
  const joined = await ensureJoined()
  if (joined) {
    await tryLoadFromServer()
    startPolling()
    presence.start()
  } else {
    startJoinLobbyPolling()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onMapPickKeydown)
  stopPolling()
  stopJoinLobbyPolling()
})

watch([isMyTurn, () => snapshot.value?.phase, serverStatus], () => {
  refreshLocalLegalActions()
})
</script>

<template>
  <div class="game-viewport">
    <div v-if="needsJoin" class="join-overlay">
      <form class="join-card" @submit.prevent="submitJoin">
        <h2>Вход в игру</h2>
        <p v-if="roomBootstrap" class="join-meta">
          Игроков: {{ roomBootstrap.playerCount }}/{{ roomBootstrap.maxPlayers }}
          <span v-if="roomBootstrap.code"> · код {{ roomBootstrap.code }}</span>
        </p>

        <div v-if="joinLobbySlots.length" class="join-players">
          <h3 class="join-players-title">Выберите слот</h3>
          <LobbySlotPicker
            v-model="selectedJoinSlot"
            :slots="joinLobbySlots"
            :disabled="joinBusy || joinRoomFull"
          />
        </div>

        <p v-if="joinRoomFull" class="join-error">Все слоты заняты — дождитесь освобождения места.</p>

        <p v-if="hasNickname" class="join-as">
          Вы войдёте как <strong>{{ nickname }}</strong>
        </p>
        <p v-else class="join-error">
          Никнейм не задан —
          <NuxtLink to="/">выберите в лобби</NuxtLink>
        </p>

        <p v-if="joinError" class="join-error">{{ joinError }}</p>
        <button
          type="submit"
          class="join-submit"
          :disabled="joinBusy || !hasNickname || !selectedJoinSlot || joinRoomFull"
        >
          {{ joinBusy ? 'Вход…' : `Войти как ${nickname || '…'}` }}
        </button>
        <NuxtLink to="/" class="join-back">← В лобби</NuxtLink>
        <NuxtLink to="/lobbies" class="join-back">Список лобби</NuxtLink>
      </form>
    </div>

    <section class="board-layer">
      <GameBoard
        v-if="boardCells.length"
        :cells="boardCells"
        mode="game"
        :show-auto-fit-toggle="false"
        :selected-key="selectedKey"
        :reachable-keys="boardReachableKeys"
        :contested-keys="boardContestedKeys"
        :destination-keys="boardDestinationKeys"
        :preview-moves="boardPreviewMoves"
        :territory-label-players="territoryLabelPlayers"
        :movement-source-key="boardMovementSourceKey"
        :available-action-marker-keys="availableActionMarkerKeys"
        :available-production-marker-keys="availableProductionMarkerKeys"
        :supply-chain-keys="supplyChainHighlightKeys"
        :players="snapshot?.players ?? []"
        @select="selectCell"
      />
      <p v-else class="empty-hint">Нет данных карты — импортируйте .galaxy.json</p>

      <CombatPreviewPanel
        v-if="markerMapPickActive && markerMapPickHasPendingCombat && markerMapPickCombatPreview && snapshot"
        :preview="markerMapPickCombatPreview"
        :round-one-odds="markerMapPickRoundOneOdds"
        :player-names="playerNameById"
      />
    </section>

    <GameStatusToast :toasts="statusToasts" />

    <section
      v-if="syncWarningVisible && !roomId.startsWith('local-')"
      class="sync-warning"
      role="alert"
    >
      <strong>Состояние могло рассинхронизироваться</strong>
      <p>{{ syncWarningReason ?? 'Не удалось подтвердить актуальность данных.' }}</p>
      <div class="sync-warning-actions">
        <button
          type="button"
          :disabled="syncResyncing"
          @click="observationSync.resync('Игрок запросил синхронизацию.')"
        >
          {{ syncResyncing ? 'Синхронизация…' : 'Синхронизировать' }}
        </button>
        <button type="button" @click="reloadPage">Обновить страницу</button>
      </div>
    </section>

    <div v-if="gameOverState" class="game-over-overlay" role="alert">
      <div class="game-over-card">
        <h2>Игра окончена</h2>
        <p class="game-over-winner">Победитель: {{ gameOverWinnerName }}</p>
        <p class="game-over-reason">{{ gameOverReasonLabel }}</p>
      </div>
    </div>

    <div
      v-if="showForeignCombatBanner"
      class="map-pick-banner map-pick-banner--combat"
      role="status"
    >
      <p class="map-pick-text">{{ foreignCombatBannerText }}</p>
      <div v-if="combatParticipantRole" class="map-pick-actions">
        <button type="button" class="map-pick-secondary" @click="abortPendingCombatAction">
          Прервать зависший бой
        </button>
      </div>
    </div>

    <div
      v-if="showCombatContinueDecision && pendingCombatState"
      class="map-pick-banner map-pick-banner--combat"
      role="status"
    >
      <p class="map-pick-text">
        Бой на ({{ pendingCombatState.cellKey }}) — раунд {{ pendingCombatState.roundNumber }}.
        <template v-if="!combatRetreatAllowed">
          Пока в этом бою никто не уничтожен — отступление недоступно, бой продолжается.
          <template v-if="combatDecisionRole === 'attacker'">Подтвердите продолжение.</template>
          <template v-else>Атакующий продолжил — подтвердите продолжение как защитник.</template>
        </template>
        <template v-else-if="combatDecisionRole === 'attacker'">
          Ваш ход как атакующего: продолжить сражение или отступить на подсвеченную клетку.
        </template>
        <template v-else>
          Атакующий продолжил бой — ваш ход как защитника: продолжить или отступить на подсвеченную клетку.
        </template>
      </p>
      <p v-if="combatRetreatAllowed" class="map-pick-text map-pick-text--hint">
        Клетки отступления подсвечены на карте. Можно нажать на клетку или на кнопку ниже;
        наведение на кнопку подсвечивает клетку ярче.
      </p>
      <div class="map-pick-actions">
        <button type="button" class="map-pick-primary" @click="continuePendingCombatAction">
          Продолжить бой
        </button>
        <template v-if="combatRetreatAllowed">
          <span v-if="!retreatDestinations.length" class="map-pick-error">
            Нет доступной соседней клетки для отступления.
          </span>
          <button
            v-for="coord in retreatDestinations"
            :key="hexKey(coord.q, coord.r)"
            type="button"
            class="map-pick-secondary"
            :class="{ 'map-pick-secondary--hover-hex': retreatHoverKey === hexKey(coord.q, coord.r) }"
            @mouseenter="retreatHoverKey = hexKey(coord.q, coord.r)"
            @mouseleave="retreatHoverKey = null"
            @focus="retreatHoverKey = hexKey(coord.q, coord.r)"
            @blur="retreatHoverKey = null"
            @click="stopPendingCombatAction(coord)"
          >
            Отступить в ({{ coord.q }}, {{ coord.r }})
          </button>
        </template>
      </div>
    </div>

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

    <BattleModal
      v-if="battleModalOpen && (combatPrepPreview ?? battlePreviewSnapshot) && snapshot"
      :preview="(combatPrepPreview ?? battlePreviewSnapshot)!"
      :snapshot="snapshot"
      :player-names="playerNameById"
      :local-player-id="playerId"
      :resolution="battleResolution"
      :resolving="battleResolving"
      :prep-phase="combatPrepState?.phase ?? null"
      :self-ready="combatPrepSelfReady"
      :attacker-ready="combatPrepAttackerReady"
      :defender-ready="combatPrepDefenderReady"
      :remote-attacker-skips="combatPrepAttackerSkips"
      :remote-defender-skips="combatPrepDefenderSkips"
      :countdown-started-at="combatPrepState?.countdownStartedAt"
      @close="closeBattleModal"
      @resolve="resolveBattleWithOptions"
      @confirm-destruction="confirmBattleDestruction"
      @prep-ready="resolveBattleWithOptions"
      @prep-unready="submitCombatPrepUnready"
      @support-side="submitCombatSupportSide"
      @cancel-prep="cancelCombatPrepAction"
      @countdown-complete="resyncAfterCombatCountdown"
    />

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
      <div v-else-if="markerMapPickOrderReady" class="map-pick-actions">
        <button
          type="button"
          class="map-pick-primary"
          :class="{ 'map-pick-primary--combat': markerMapPickHasPendingCombat }"
          @click.stop="confirmMarkerOrder"
        >
          {{ markerMapPickConfirmLabel }}
        </button>
        <button type="button" class="map-pick-cancel" @click.stop="cancelMarkerMapPick">
          Отмена
        </button>
      </div>
      <div v-else class="map-pick-actions">
        <button type="button" class="map-pick-cancel" @click.stop="cancelMarkerMapPick">
          Отмена
        </button>
        <span v-if="markerMapPick.canUndo()" class="map-pick-undo-hint">Esc — отменить шаг</span>
      </div>
    </div>

    <div class="hud-chrome">
      <header class="hud-top">
        <div class="hud-top-left">
          <NuxtLink to="/" class="back-link">← Lobby</NuxtLink>
          <div v-if="saveFile" class="hud-title">
            <strong>{{ saveFile.map.name }}</strong>
            <span class="hud-id">{{ roomId }}</span>
          </div>
        </div>

        <div v-if="isMyTurn" class="hud-top-center">
          <button
            v-if="showPlanningBackToActionBtn"
            type="button"
            class="planning-step-btn planning-step-btn--hero planning-step-btn--back"
            @click="backToPlanningActionStep"
          >
            ← К маркерам действия
          </button>
          <button
            v-if="showPlanningActionDoneBtn"
            type="button"
            class="planning-step-btn planning-step-btn--hero"
            @click="finishPlanningActionStep"
          >
            Готово с маркерами действия
          </button>
          <button
            type="button"
            class="phase-advance-btn phase-advance-btn--hero"
            :style="phaseAdvanceBtnStyle"
            :disabled="advancingPhase || !canAdvancePhase"
            :title="phaseAdvanceBlockedReason ?? undefined"
            @click="endPhase"
          >
            {{ advancingPhase ? '…' : advancePhaseLabel }}
          </button>
          <p v-if="phaseHint" class="hud-center-hint err">{{ phaseHint }}</p>
          <p v-else-if="phaseAdvanceBlockedReason" class="hud-center-hint err">
            {{ phaseAdvanceBlockedReason }}
          </p>
        </div>
        <div v-else class="hud-top-center hud-top-center--idle" aria-hidden="true" />

        <div class="hud-top-right">
          <PhasePanel
            v-if="snapshot"
            variant="hero"
            :phase="snapshot.phase"
            :turn-number="snapshot.turnNumber"
            :active-player-id="snapshot.activePlayerId"
            :players="snapshot.players"
            :is-my-turn="isMyTurn"
            :prompt="phaseGuidance?.prompt"
            :count-hint="phaseGuidance?.countHint"
            :guidance-accent="phaseGuidance?.accent"
          />
          <span class="server-pill" :class="serverStatus">
            {{ serverStatus === 'online' ? 'Сервер' : serverStatus === 'offline' ? 'Offline' : '…' }}
          </span>
          <div class="rules-help-wrap">
            <button
              type="button"
              class="rules-help-btn"
              title="Справка по правилам"
              :aria-describedby="showRulesNewbieTip ? 'rules-newbie-tip' : undefined"
              @click="openRulesHelp"
            >
              Правила
            </button>
            <div
              v-if="showRulesNewbieTip"
              id="rules-newbie-tip"
              class="rules-newbie-tip"
              role="status"
            >
              <p class="rules-newbie-tip-text">
                Не знаете что делать? Ознакомьтесь с разделом правил!
              </p>
              <button
                type="button"
                class="rules-newbie-tip-dismiss"
                title="Скрыть подсказку"
                aria-label="Скрыть подсказку"
                @click.stop="dismissRulesNewbieTip"
              >
                ×
              </button>
            </div>
          </div>
          <button
            v-if="serverStatus === 'online' && roomBootstrap && roomBootstrap.playerCount < roomBootstrap.maxPlayers"
            type="button"
            class="invite-btn"
            @click="copyInviteLink"
          >
            {{ inviteCopied ? 'Ссылка скопирована' : 'Ссылка-приглашение' }}
          </button>
        </div>
      </header>

      <RulesHelpModal :open="rulesHelpOpen" @close="rulesHelpOpen = false" />

      <div class="you-plaque-slot" aria-live="polite">
        <div
          class="you-plaque"
          :class="{ 'you-plaque--turn': isMyTurn }"
          :style="youBadgeStyle"
          :title="`Вы — ${myPlayerName}`"
        >
          {{ myPlayerName }}
        </div>
      </div>
    </div>

    <aside class="hud-right" :class="{ collapsed: panelCollapsed }">
      <button
        type="button"
        class="panel-toggle"
        :title="panelCollapsed ? 'Развернуть панель' : 'Свернуть панель'"
        :aria-expanded="!panelCollapsed"
        aria-controls="game-side-panel"
        @click="panelCollapsed = !panelCollapsed"
      >
        {{ panelCollapsed ? '«' : '»' }}
      </button>
      <div v-if="!panelCollapsed" id="game-side-panel" class="panel-inner">
        <header class="panel-heading-row">
          <h2 class="panel-heading">Игра</h2>
          <div class="panel-heading-meta">
            <span
              class="you-mini"
              :style="youBadgeStyle"
              :title="`Вы — ${myPlayerName}`"
            >
              <span class="you-mini-swatch" aria-hidden="true" />
              Вы
            </span>
            <span
              v-if="activePlayerName"
              class="active-mini"
              :style="phaseAdvanceBtnStyle"
              :title="`Активный игрок: ${activePlayerName}`"
            >
              <span class="active-player-dot" aria-hidden="true" />
              {{ activePlayerName }}
            </span>
          </div>
        </header>

        <section v-if="showTurnEventsPanel" class="block event-block">
          <TurnEventsPanel
            :active-event="activeEvent"
            :history="turnEventHistory"
            :current-turn="snapshot?.turnNumber ?? 1"
            :phase="snapshot?.phase"
            :resolved-at="currentTurnEventResolvedAt"
          />
        </section>

        <section class="block block--cell">
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

        <section class="block metrics-block" aria-label="Состояние фазы">
          <div class="metric-row">
            <span
              class="metric-pill metric-pill--action"
              :title="`Маркеры действия: ваши ${myActionMarkerCount}/${MAX_ACTION_MARKERS_PER_PLAYER}, на карте ${actionMarkers.length}`"
            >
              <span class="metric-glyph metric-glyph--action" aria-hidden="true" />
              <span class="metric-value">{{ myActionMarkerCount }}/{{ MAX_ACTION_MARKERS_PER_PLAYER }}</span>
              <span class="metric-sub">осталось {{ sidePanelActionRemaining }}</span>
            </span>
            <span
              class="metric-pill metric-pill--prod"
              :title="`Маркеры производства: ваши ${myProductionMarkerCount}/${maxProductionRegions}, на карте ${productionMarkers.length}`"
            >
              <span class="metric-glyph metric-glyph--prod" aria-hidden="true" />
              <span class="metric-value">{{ myProductionMarkerCount }}/{{ maxProductionRegions }}</span>
              <span class="metric-sub">осталось {{ sidePanelProdRemaining }}</span>
            </span>
          </div>

          <div v-if="showActionsControls || showProductionControls" class="status-strip">
            <template v-if="showActionsControls">
              <span
                v-if="actionMarkerUsedThisTurn"
                class="status-chip status-chip--warn"
                :title="ACTION_MARKER_ALREADY_RESOLVED_MSG"
              >
                ● исполнен
              </span>
              <span
                v-else
                class="status-chip status-chip--action"
                title="Клик по маркеру на карте — перемещение. Снять — в карточке клетки."
              >
                ● клик по маркеру
              </span>
            </template>
            <template v-if="showProductionControls">
              <span
                v-if="productionMarkerUsedThisTurn"
                class="status-chip status-chip--warn"
                :title="PRODUCTION_MARKER_ALREADY_RESOLVED_MSG"
              >
                ■ исполнен
              </span>
              <span
                v-else
                class="status-chip status-chip--prod"
                title="Клик по маркеру — постройка или перезарядка. Снять — в карточке клетки."
              >
                ■ клик по маркеру
              </span>
            </template>
            <span
              v-if="isMyTurn && snapshot?.phase === 'actions' && remainingActionMarkersCount > 0"
              class="status-chip"
              :title="`На карте осталось маркеров действия: ${remainingActionMarkersCount}`"
            >
              карта · {{ remainingActionMarkersCount }}
            </span>
          </div>

          <p v-if="markerHint" class="err" role="alert">{{ markerHint }}</p>
          <p v-if="participationHint" class="hint participation-hint">{{ participationHint }}</p>
          <p v-if="markerActionHint" class="hint">{{ markerActionHint }}</p>
          <p v-if="productionHint" class="hint hint--production">{{ productionHint }}</p>
        </section>

        <section class="block">
          <h3 class="block-label">Доступно</h3>
          <ul v-if="legalActions.length" class="action-chips" aria-label="Доступные действия">
            <li
              v-for="action in legalActions"
              :key="action.id"
              class="action-chip"
              :class="`action-chip--${legalActionChipIcon(action.type)}`"
              :title="action.description"
            >
              <span class="help-icon" aria-hidden="true">{{ helpStepSymbol(legalActionChipIcon(action.type)) }}</span>
              <span>{{ legalActionChipLabel(action) }}</span>
            </li>
          </ul>
          <p v-else-if="!isMyTurn" class="hint">Не ваш ход</p>
          <p v-else class="hint">Нет действий</p>
        </section>

        <section class="block help-block">
          <div class="help-head">
            <h3>{{ phaseHelp.title }}</h3>
            <button
              type="button"
              class="help-toggle"
              :title="showHelp ? 'Свернуть справку' : 'Развернуть справку'"
              :aria-expanded="showHelp"
              @click="showHelp = !showHelp"
            >
              {{ showHelp ? '−' : '?' }}
            </button>
          </div>
          <ul v-if="showHelp" class="help-steps">
            <li
              v-for="(step, idx) in phaseHelp.steps"
              :key="idx"
              class="help-step"
              :class="`help-step--${step.icon}`"
              :title="step.detail ?? step.label"
            >
              <span
                class="help-icon"
                :aria-hidden="true"
              >{{ helpStepSymbol(step.icon) }}</span>
              <span class="help-step-label">{{ step.label }}</span>
            </li>
          </ul>
        </section>

        <details class="block marker-details">
          <summary>
            <span class="metric-glyph metric-glyph--action" aria-hidden="true" />
            Действие
            <span class="marker-count">{{ actionMarkers.length }}</span>
          </summary>
          <ul v-if="actionMarkers.length" class="marker-cards">
            <li
              v-for="m in actionMarkers"
              :key="m.id"
              class="marker-card"
              :title="`${sidePanelPlayerName(m.ownerId)} · (${m.coord.q}, ${m.coord.r}) · ${m.placedInPhase}`"
            >
              <span
                class="owner-swatch"
                :style="{ background: sidePanelPlayerColor(m.ownerId) }"
                aria-hidden="true"
              />
              <span class="marker-card-name">{{ sidePanelPlayerName(m.ownerId) }}</span>
              <span class="marker-card-coord">{{ m.coord.q }},{{ m.coord.r }}</span>
            </li>
          </ul>
          <p v-else class="hint">Пусто</p>
        </details>

        <details class="block marker-details">
          <summary>
            <span class="metric-glyph metric-glyph--prod" aria-hidden="true" />
            Производство
            <span class="marker-count">{{ productionMarkers.length }}</span>
          </summary>
          <ul v-if="productionMarkers.length" class="marker-cards">
            <li
              v-for="m in productionMarkers"
              :key="m.id"
              class="marker-card"
              :title="`${sidePanelPlayerName(m.ownerId)} · (${m.coord.q}, ${m.coord.r}) · регион ${m.targetRegionId}`"
            >
              <span
                class="owner-swatch"
                :style="{ background: sidePanelPlayerColor(m.ownerId) }"
                aria-hidden="true"
              />
              <span class="marker-card-name">{{ sidePanelPlayerName(m.ownerId) }}</span>
              <span class="marker-card-coord">{{ m.coord.q }},{{ m.coord.r }}</span>
            </li>
          </ul>
          <p v-else class="hint">Пусто</p>
        </details>

        <section class="block block--file">
          <h3 class="block-label">Файл</h3>
          <label class="export-name-field">
            <span class="export-name-label">Имя</span>
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
            <button type="button" title="Экспорт сохранения" @click="exportGameSave">↓ Экспорт</button>
            <label class="file-btn" title="Импорт сохранения">
              ↑ Импорт
              <input type="file" accept="application/json,.json,.galaxy.json" hidden @change="importGameSave" />
            </label>
          </div>
          <p v-if="loadError" class="err" role="alert">{{ loadError }}</p>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.game-viewport {
  --hud-header-height: 3.75rem;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #e2e8f0;
  overflow: hidden;
}
.game-over-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.72);
  pointer-events: none;
}
.game-over-card {
  padding: 1.5rem 2rem;
  border-radius: 12px;
  border: 2px solid rgba(250, 204, 21, 0.55);
  background: linear-gradient(160deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98));
  text-align: center;
  max-width: 420px;
}
.game-over-card h2 {
  margin: 0 0 0.75rem;
}
.game-over-winner {
  margin: 0;
  font-weight: 700;
  color: #fde047;
}
.game-over-reason {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: #94a3b8;
}
.sync-warning {
  position: absolute;
  top: calc(var(--hud-header-height) + 0.5rem);
  left: 50%;
  z-index: 80;
  width: min(92vw, 460px);
  transform: translateX(-50%);
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(251, 191, 36, 0.8);
  border-radius: 10px;
  background: rgba(120, 53, 15, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: #fef3c7;
  text-align: center;
  pointer-events: auto;
}
.sync-warning p {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: #fde68a;
}
.sync-warning-actions {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.65rem;
}
.sync-warning-actions button:first-child {
  border-color: #fbbf24;
  background: #b45309;
}
.map-pick-banner--combat {
  border-color: rgba(248, 113, 113, 0.6);
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
.hud-chrome {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  pointer-events: none;
}
.hud-top {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem 0.75rem;
  min-height: var(--hud-header-height);
  padding: 0.5rem 0.75rem;
  background: linear-gradient(to bottom, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.65), transparent);
  backdrop-filter: blur(6px);
}
.hud-top-left,
.hud-top-center,
.hud-top-right {
  pointer-events: auto;
}
.hud-top-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-self: start;
  min-width: 0;
}
.hud-top-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  justify-self: center;
  max-width: min(440px, 42vw);
}
.hud-top-center--idle {
  pointer-events: none;
}
.hud-top-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  flex-wrap: wrap;
  justify-self: end;
  min-width: 0;
}
.hud-top-right :deep(.phase-panel--hero) {
  flex: 0 1 auto;
  justify-content: flex-end;
}
.hud-center-hint {
  margin: 0;
  font-size: 0.78rem;
  text-align: center;
  max-width: 100%;
}
.map-pick-banner {
  position: absolute;
  top: calc(var(--hud-header-height) + 0.35rem);
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
.map-pick-primary--combat {
  border-color: #dc2626;
  background: #991b1b;
}
.map-pick-undo-hint {
  font-size: 0.72rem;
  color: #bae6fd;
  opacity: 0.85;
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
.map-pick-secondary--hover-hex {
  border-color: #38bdf8;
  background: #0c4a6e;
  color: #e0f2fe;
}
.map-pick-text--hint {
  font-size: 0.75rem;
  color: #bae6fd;
  opacity: 0.9;
}
.back-link {
  color: #93c5fd;
  text-decoration: none;
  font-size: 0.85rem;
}
.you-plaque-slot {
  align-self: flex-start;
  padding: 0.2rem 0.75rem 0.55rem;
}
.you-plaque {
  display: inline-block;
  max-width: min(360px, 62vw);
  padding: 0.6rem 1.35rem 0.55rem;
  border-radius: 12px;
  font-family: Orbitron, "Segoe UI", "Trebuchet MS", sans-serif;
  font-size: 1.28rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
  color: #fff;
  text-shadow:
    0 1px 0 rgba(15, 23, 42, 0.55),
    0 2px 8px rgba(15, 23, 42, 0.35);
  background: var(--my-color, #3b82f6);
  border: 2px solid color-mix(in srgb, var(--my-color, #3b82f6) 35%, #fff);
  box-shadow:
    0 2px 0 color-mix(in srgb, var(--my-color, #3b82f6) 35%, #0f172a),
    0 8px 20px rgba(0, 0, 0, 0.38);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.you-plaque--turn {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.panel-heading-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.you-mini {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem 0.15rem 0.25rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #f8fafc;
  background: color-mix(in srgb, var(--my-color, #3b82f6) 28%, rgba(15, 23, 42, 0.9));
  border: 1px solid color-mix(in srgb, var(--my-color, #3b82f6) 70%, #fff);
}
.you-mini-swatch {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: var(--my-color, #3b82f6);
  box-shadow: 0 0 0 1px #0f172a;
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
  top: var(--hud-header-height);
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
  padding: 0.65rem 0.7rem 0.85rem;
}
.panel-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}
.panel-heading {
  margin: 0;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
}
.active-mini {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 9rem;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--player-color, #3b82f6) 55%, #fff);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--player-color, #3b82f6) 78%, #fff),
    var(--player-color, #3b82f6)
  );
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.active-player-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 5px rgba(255, 255, 255, 0.75);
  flex-shrink: 0;
}
.block {
  margin-bottom: 0.75rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid rgba(51, 65, 85, 0.9);
}
.block-label,
.block h3 {
  margin: 0 0 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.block--cell {
  padding-bottom: 0.55rem;
}
.block--file {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.metrics-block {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.metric-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}
.metric-pill {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.35rem;
  row-gap: 0.05rem;
  align-items: center;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  border: 1px solid rgba(71, 85, 105, 0.7);
  background: rgba(15, 23, 42, 0.55);
  min-width: 0;
}
.metric-pill .metric-glyph {
  grid-row: 1 / span 2;
}
.metric-pill--action {
  border-color: rgba(250, 204, 21, 0.4);
  background: rgba(66, 32, 6, 0.35);
}
.metric-pill--prod {
  border-color: rgba(244, 114, 182, 0.4);
  background: rgba(80, 7, 36, 0.35);
}
.metric-glyph {
  width: 0.55rem;
  height: 0.55rem;
  display: inline-block;
  vertical-align: middle;
}
.metric-glyph--action {
  border-radius: 50%;
  background: #facc15;
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.3);
}
.metric-glyph--prod {
  border-radius: 2px;
  background: #f472b6;
  box-shadow: 0 0 0 2px rgba(244, 114, 182, 0.3);
}
.metric-value {
  grid-column: 2;
  font-size: 0.92rem;
  font-weight: 800;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.metric-sub {
  grid-column: 2;
}
.metric-pill--action .metric-value {
  color: #fef08a;
}
.metric-pill--prod .metric-value {
  color: #fbcfe8;
}
.metric-pill .metric-sub {
  font-size: 0.66rem;
  color: #94a3b8;
}
.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(30, 41, 59, 0.7);
  font-size: 0.68rem;
  font-weight: 600;
  color: #cbd5e1;
}
.status-chip--action {
  border-color: rgba(250, 204, 21, 0.45);
  color: #fef08a;
  background: rgba(113, 63, 18, 0.4);
}
.status-chip--prod {
  border-color: rgba(244, 114, 182, 0.45);
  color: #fbcfe8;
  background: rgba(131, 24, 67, 0.4);
}
.status-chip--warn {
  border-color: rgba(251, 191, 36, 0.55);
  color: #fcd34d;
  background: rgba(120, 53, 15, 0.45);
}
.action-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.action-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.5rem;
  border-radius: 7px;
  border: 1px solid rgba(71, 85, 105, 0.75);
  background: rgba(15, 23, 42, 0.7);
  font-size: 0.72rem;
  font-weight: 600;
  color: #e2e8f0;
}
.action-chip--marker-action,
.action-chip--fight {
  border-color: rgba(250, 204, 21, 0.4);
}
.action-chip--build,
.action-chip--marker-prod {
  border-color: rgba(244, 114, 182, 0.4);
}
.action-chip--event {
  border-color: rgba(167, 139, 250, 0.4);
}
.action-chip--pass {
  border-color: rgba(56, 189, 248, 0.4);
}
.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.export-name-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.4rem;
}
.export-name-label {
  font-size: 0.68rem;
  color: #94a3b8;
}
.export-name-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.3rem 0.45rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #1e293b;
  color: #f8fafc;
  font-size: 0.78rem;
}
.export-name-input:focus {
  outline: none;
  border-color: #64748b;
}
button,
.file-btn {
  padding: 0.32rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
  cursor: pointer;
  font-size: 0.78rem;
}
.file-btn {
  display: inline-block;
}
.hint {
  margin: 0;
  font-size: 0.76rem;
  color: #94a3b8;
}
.err {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  color: #f87171;
}
.marker-details summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #cbd5e1;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.marker-details summary::-webkit-details-marker {
  display: none;
}
.marker-details[open] summary {
  margin-bottom: 0.4rem;
}
.marker-count {
  margin-left: auto;
  min-width: 1.25rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.85);
  font-size: 0.68rem;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
}
.marker-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.marker-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.4rem;
  border-radius: 7px;
  border: 1px solid rgba(71, 85, 105, 0.55);
  background: rgba(15, 23, 42, 0.6);
  font-size: 0.72rem;
}
.marker-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e2e8f0;
  font-weight: 600;
}
.marker-card-coord {
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
  font-weight: 600;
}
.owner-swatch {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}
.help-block {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(51, 65, 85, 0.85);
  padding: 0.45rem 0.5rem;
  margin-bottom: 0.65rem;
}
.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.help-head h3 {
  margin: 0;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.8rem;
  color: #e2e8f0;
}
.help-toggle {
  padding: 0.12rem 0.4rem;
  font-size: 0.85rem;
  line-height: 1;
}
.help-steps {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}
.help-step {
  display: grid;
  grid-template-columns: 1.35rem 1fr;
  gap: 0.4rem;
  align-items: start;
  font-size: 0.74rem;
  line-height: 1.3;
  color: #cbd5e1;
}
.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 5px;
  background: rgba(51, 65, 85, 0.85);
  border: 1px solid rgba(100, 116, 139, 0.45);
  font-size: 0.68rem;
  font-weight: 800;
  color: #e2e8f0;
  flex-shrink: 0;
}
.help-step--marker-action .help-icon,
.action-chip--marker-action .help-icon {
  color: #facc15;
  border-color: rgba(250, 204, 21, 0.4);
  background: rgba(113, 63, 18, 0.45);
}
.help-step--marker-prod .help-icon,
.help-step--build .help-icon,
.action-chip--build .help-icon {
  color: #f472b6;
  border-color: rgba(244, 114, 182, 0.4);
  background: rgba(131, 24, 67, 0.4);
}
.help-step--fight .help-icon,
.action-chip--fight .help-icon {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(127, 29, 29, 0.4);
}
.help-step--event .help-icon,
.action-chip--event .help-icon {
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.4);
  background: rgba(76, 29, 149, 0.35);
}
.help-step--pass .help-icon,
.action-chip--pass .help-icon {
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(12, 74, 110, 0.45);
}
.help-step--ship .help-icon {
  color: #86efac;
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(20, 83, 45, 0.4);
}
.help-step-label {
  padding-top: 0.1rem;
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
.planning-step-btn {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: 8px;
  border: 2px solid rgba(56, 189, 248, 0.55);
  background: rgba(12, 74, 110, 0.85);
  color: #e0f2fe;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}
.planning-step-btn--hero {
  width: auto;
  margin-bottom: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  white-space: nowrap;
}
.planning-step-btn--back {
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(69, 26, 3, 0.85);
  color: #fef3c7;
}
.planning-step-btn:hover {
  filter: brightness(1.08);
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
  animation: phase-advance-pulse 1.25s ease-in-out infinite;
  box-shadow:
    0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 45%, transparent),
    0 2px 6px rgba(0, 0, 0, 0.35);
}
.phase-advance-btn--hero {
  width: auto;
  min-width: 11rem;
  margin-top: 0;
  padding: 0.55rem 1.25rem;
  font-size: 0.92rem;
  white-space: nowrap;
}
.phase-advance-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}
.phase-advance-btn:disabled {
  animation: none;
  opacity: 0.55;
  cursor: wait;
}
.active-mini .active-player-dot {
  animation: active-player-dot 1.25s ease-in-out infinite;
}
@keyframes active-player-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.35);
    opacity: 0.88;
  }
}
@keyframes phase-advance-pulse {
  0%,
  100% {
    box-shadow:
      0 0 6px 2px color-mix(in srgb, var(--player-color, #3b82f6) 45%, transparent),
      0 2px 6px rgba(0, 0, 0, 0.35);
    filter: brightness(1);
  }
  50% {
    box-shadow:
      0 0 22px 8px color-mix(in srgb, var(--player-color, #3b82f6) 82%, transparent),
      0 0 36px 4px color-mix(in srgb, var(--player-color, #3b82f6) 52%, transparent),
      0 2px 10px rgba(0, 0, 0, 0.45);
    filter: brightness(1.16);
  }
}
.join-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(4px);
}
.join-card {
  width: min(360px, 92vw);
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid #334155;
  background: #1e293b;
}
.join-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}
.join-meta {
  margin: 0 0 0.75rem;
  color: #94a3b8;
  font-size: 0.85rem;
}
.join-players {
  margin-bottom: 0.85rem;
}
.join-players-title {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #cbd5e1;
}
.join-as {
  margin: 0 0 0.75rem;
  color: #cbd5e1;
  font-size: 0.88rem;
}
.join-as strong {
  color: #f8fafc;
}
.join-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: #94a3b8;
}
.join-field input {
  padding: 0.45rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
}
.join-error {
  margin: 0 0 0.5rem;
  color: #f87171;
  font-size: 0.85rem;
}
.join-submit {
  width: 100%;
  padding: 0.55rem;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #fff;
  cursor: pointer;
}
.join-back {
  display: inline-block;
  margin-top: 0.75rem;
  color: #93c5fd;
  font-size: 0.85rem;
}
.invite-btn {
  padding: 0.25rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #2563eb;
  background: #1e3a8a;
  color: #dbeafe;
  font-size: 0.75rem;
  cursor: pointer;
}

.rules-help-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.rules-help-btn {
  padding: 0.25rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.rules-help-btn:hover {
  border-color: #94a3b8;
  background: #334155;
}

.rules-newbie-tip {
  --tip-font: 'Manrope', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  position: absolute;
  top: calc(100% + 0.55rem);
  right: 0;
  z-index: 40;
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  width: max-content;
  max-width: min(18rem, 70vw);
  padding: 0.55rem 0.6rem 0.55rem 0.7rem;
  border-radius: 10px;
  border: 1px solid #64748b;
  background: #0f172a;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  color: #e8eef7;
  font-family: var(--tip-font);
  -webkit-font-smoothing: antialiased;
}

.rules-newbie-tip::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 1.1rem;
  width: 10px;
  height: 10px;
  border-left: 1px solid #64748b;
  border-top: 1px solid #64748b;
  background: #0f172a;
  transform: rotate(45deg);
}

.rules-newbie-tip-text {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.01em;
}

.rules-newbie-tip-dismiss {
  flex: 0 0 auto;
  width: 1.35rem;
  height: 1.35rem;
  margin-top: -0.1rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.rules-newbie-tip-dismiss:hover {
  background: #1e293b;
  color: #f1f5f9;
}

@media (max-width: 900px) {
  .game-viewport {
    --hud-header-height: 5.75rem;
  }
  .you-plaque {
    font-size: 1.12rem;
    padding: 0.5rem 1.15rem 0.45rem;
  }
  .hud-top {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    gap: 0.45rem;
  }
  .hud-top-left,
  .hud-top-center,
  .hud-top-right {
    justify-self: stretch;
  }
  .hud-top-center {
    max-width: none;
    order: 2;
  }
  .hud-top-right {
    justify-content: flex-start;
    order: 3;
  }
  .hud-top-right :deep(.phase-panel--hero) {
    justify-content: flex-start;
  }
  .phase-advance-btn--hero {
    width: 100%;
    max-width: 360px;
  }
}
</style>
