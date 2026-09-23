<script setup lang="ts">
import type {
  BuildableShipOption,
  GameSnapshot,
  HexCoord,
  MapDefinition,
  ResourceTokenDef,
  ShipType,
  TokenSpendRef,
} from '@galaxy/rules'
import {
  SHIP_LABELS,
  autoAllocateTokens,
  canBuildShipInRegionSize,
  getBombardableShipsAtMarker,
  getBuildableShipsForMarker,
  getEffectiveTokenValue,
  getMovableShipsAtMarker,
  getRegionForMarker,
  getRegionResourceSummary,
  getRegionTokensForMarker,
  regionPlacementCapacity,
  tokenSpendKey,
  validateTokenPayment,
} from '@galaxy/rules'
import type { ShipBuildOrder } from '~/utils/production-build'
import type { MarkerActionMode } from '~/composables/useActionOrderDraft'
import {
  groupTokenViewsByCell,
  pickedTokenCellKeys,
  pruneTokenKeys,
  toggleTokenKey,
  tokenKeyForCellClick,
  tokenPickCellKeys,
  tokenPickCoverage,
  tokenPickEntries,
  tokenPickTotals,
  tokenSpendRefs,
  type RegionTokenView,
} from '~/utils/production-token-pick'

const props = withDefaults(
  defineProps<{
    snapshot: GameSnapshot
    map: MapDefinition
    playerId: string
    source: HexCoord
    /** В обучении скрывает действия, которые не относятся к текущему шагу. */
    allowedModes?: MarkerActionMode[]
    allowRemoveMarker?: boolean
    /** Клик игрока по клетке карты во время выбора фишек; seq растёт на каждый клик */
    mapTokenClick?: { q: number; r: number; seq: number } | null
  }>(),
  {
    allowedModes: undefined,
    allowRemoveMarker: true,
    mapTokenClick: null,
  },
)

const emit = defineEmits<{
  close: []
  startPick: [payload: { shipIds: string[]; mode: Exclude<MarkerActionMode, 'build'> }]
  executeBuild: [payload: { orders: ShipBuildOrder[]; spentTokens: TokenSpendRef[] | null }]
  tokenPickState: [
    payload: { active: boolean; pickKeys: string[]; pickedKeys: string[] },
  ]
  removeMarker: []
  assault: []
}>()

const SHIP_SHORT: Record<ShipType, string> = {
  destroyer: 'Эсминец',
  cruiser: 'Крейсер',
  battleship: 'Линкор',
  carrier: 'Авианосец',
  hyper: 'Гиперорудие',
}

const {
  panelRef,
  panelStyle,
  isDragging,
  onDragHandlePointerDown,
  consumeDragClick,
} = useDraggablePanel()

/**
 * На клетке маркера стоят и ваши корабли, и чужие — это осада. Маркер можно исполнить боем
 * прямо на клетке: вылазкой гарнизона или штурмом осаждающих.
 */
const sharedCellEnemy = computed(() => {
  const cell = props.snapshot.cells.find(
    (c) => c.coord.q === props.source.q && c.coord.r === props.source.r,
  )
  if (!cell) return false
  return (
    cell.ships.some((ship) => ship.ownerId === props.playerId)
    && cell.ships.some((ship) => ship.ownerId !== props.playerId)
  )
})

/** Клик по фону закрывает окно, но не после перетаскивания за шапку */
function onBackdropClick() {
  if (consumeDragClick()) return
  emit('close')
}

const actionMode = ref<MarkerActionMode>('movement')
const selectedShipIds = ref<string[]>([])
const buildCounts = ref<Partial<Record<ShipType, number>>>({})
/** 'auto' — правила подбирают фишки сами, 'manual' — игрок выбирает вручную */
const buildPaymentMode = ref<'auto' | 'manual'>('auto')
const selectedTokenKeys = ref<string[]>([])
/** Игрок сам менял выбор фишек — автоподбор больше не перетирает его */
const tokenPickTouched = ref(false)
const stepError = ref<string | null>(null)
const modeAllowed = (mode: MarkerActionMode) =>
  props.allowedModes === undefined || props.allowedModes.includes(mode)

function shipRangeLabel(
  opt: import('@galaxy/rules').MovableShipOption | import('@galaxy/rules').BombardableShipOption,
): string {
  if ('fireRange' in opt) return `обстрел ${opt.fireRange}`
  return `ход ${opt.moveRange}`
}

const markerId = computed(() => {
  const cell = props.snapshot.cells.find(
    (c) => c.coord.q === props.source.q && c.coord.r === props.source.r,
  )
  return cell?.actionMarkerId ?? null
})

const actionMarker = computed(() =>
  markerId.value
    ? props.snapshot.actionMarkers.find((m) => m.id === markerId.value) ?? null
    : null,
)

const movableShipOptions = computed(() =>
  getMovableShipsAtMarker(props.snapshot, props.map, props.playerId, props.source),
)

const bombardableShipOptions = computed(() =>
  getBombardableShipsAtMarker(props.snapshot, props.map, props.playerId, props.source),
)

const shipOptions = computed(() => {
  if (actionMode.value === 'build') return []
  return actionMode.value === 'bombardment' ? bombardableShipOptions.value : movableShipOptions.value
})

const buildShipOptions = computed(() =>
  markerId.value
    ? getBuildableShipsForMarker(props.snapshot, props.map.id, props.playerId, markerId.value)
    : [],
)

const buildRegionSummary = computed(() =>
  actionMarker.value
    ? getRegionResourceSummary(props.snapshot, props.map.id, actionMarker.value)
    : null,
)

const buildPlacementCapacity = computed(() =>
  actionMarker.value
    ? regionPlacementCapacity(props.snapshot, props.map.id, actionMarker.value)
    : 0,
)

const buildTotalShips = computed(() =>
  Object.values(buildCounts.value).reduce((sum, n) => sum + (n ?? 0), 0),
)

const buildResourceBalance = computed(() => {
  const summary = buildRegionSummary.value
  if (!summary) return null
  let creditsUsed = 0
  let productionUsed = 0
  for (const opt of buildShipOptions.value) {
    const n = buildCounts.value[opt.type] ?? 0
    creditsUsed += n * opt.cost.credits
    productionUsed += n * opt.cost.production
  }
  return {
    creditsTotal: summary.faceUpCredits,
    productionTotal: summary.faceUpProduction,
    creditsUsed,
    productionUsed,
    creditsLeft: summary.faceUpCredits - creditsUsed,
    productionLeft: summary.faceUpProduction - productionUsed,
  }
})

const regionTokenViews = computed<RegionTokenView[]>(() => {
  if (!actionMarker.value) return []
  return getRegionTokensForMarker(props.snapshot, props.map.id, actionMarker.value).map(
    (option) => ({
      key: option.key,
      coord: option.coord,
      tokenIndex: option.tokenIndex,
      token: option.token,
      value: getEffectiveTokenValue(props.snapshot, option.token.value),
    }),
  )
})

const regionTokenPickEntries = computed(() => tokenPickEntries(regionTokenViews.value))

/** Фишки сгруппированы по клеткам — так их проще найти на карте */
const regionTokenCells = computed(() => groupTokenViewsByCell(regionTokenViews.value))

const buildCostTotals = computed(() => ({
  credits: buildResourceBalance.value?.creditsUsed ?? 0,
  production: buildResourceBalance.value?.productionUsed ?? 0,
}))

const manualPaymentTotals = computed(() =>
  tokenPickTotals(regionTokenPickEntries.value, selectedTokenKeys.value),
)

const manualPaymentCoverage = computed(() =>
  tokenPickCoverage(manualPaymentTotals.value, buildCostTotals.value),
)

const isManualPayment = computed(() => buildPaymentMode.value === 'manual')

const manualSpendRefs = computed<TokenSpendRef[]>(() =>
  tokenSpendRefs(regionTokenViews.value, selectedTokenKeys.value),
)

/** Выбор фишек идёт прямо на карте: подсветка и клики включены */
const tokenPickOnMap = computed(
  () => actionMode.value === 'build' && isManualPayment.value && buildShipOptions.value.length > 0,
)

const buildBlockedReason = computed<string | null>(() => {
  if (buildTotalShips.value === 0) return 'Выберите корабли для постройки'
  if (!isManualPayment.value) return null
  const coverage = manualPaymentCoverage.value
  if (coverage.covered) return null
  const missing: string[] = []
  if (coverage.creditsMissing > 0) missing.push(`кредитов ₡${coverage.creditsMissing}`)
  if (coverage.productionMissing > 0) missing.push(`производства ⚙${coverage.productionMissing}`)
  return `Не хватает ${missing.join(' и ')}`
})

const selectableShipIds = computed(() =>
  shipOptions.value.filter((opt) => !opt.disabledReason).map((opt) => opt.ship.id),
)

const allSelectableSelected = computed(() => {
  const ids = selectableShipIds.value
  return ids.length > 0 && ids.every((id) => selectedShipIds.value.includes(id))
})

const playerColor = computed(() =>
  props.snapshot.players.find((p) => p.id === props.playerId)?.color ?? '#3B82F6',
)

function resetForm() {
  selectedShipIds.value = []
  buildCounts.value = {}
  buildPaymentMode.value = 'auto'
  selectedTokenKeys.value = []
  tokenPickTouched.value = false
  stepError.value = null
}

watch(
  () => props.allowedModes,
  (modes) => {
    if (modes?.length && !modes.includes(actionMode.value)) actionMode.value = modes[0]!
  },
  { immediate: true },
)

watch(() => props.source, () => resetForm(), { immediate: true })

watch(actionMode, () => {
  selectedShipIds.value = []
  buildCounts.value = {}
  buildPaymentMode.value = 'auto'
  selectedTokenKeys.value = []
  tokenPickTouched.value = false
  stepError.value = null
})

// Пока игрок не правил выбор сам, оплата следует за заявкой
watch([buildCostTotals, isManualPayment], () => {
  if (!isManualPayment.value || tokenPickTouched.value) return
  autoFillTokenPick({ silent: true })
})

// Перезарядка или потеря контроля могли убрать выбранную фишку из региона
watch(regionTokenPickEntries, (entries) => {
  const pruned = pruneTokenKeys(entries, selectedTokenKeys.value)
  if (pruned.length !== selectedTokenKeys.value.length) selectedTokenKeys.value = pruned
})

// Карте нужно знать, какие фишки подсвечивать и какие уже выбраны
watch(
  () => [tokenPickOnMap.value, regionTokenViews.value, selectedTokenKeys.value] as const,
  ([active, views, selected]) => {
    emit('tokenPickState', {
      active,
      pickKeys: active ? tokenPickCellKeys(views) : [],
      pickedKeys: active ? pickedTokenCellKeys(views, selected) : [],
    })
  },
  { immediate: true, deep: true },
)

onUnmounted(() => emit('tokenPickState', { active: false, pickKeys: [], pickedKeys: [] }))

// Клик по клетке карты во время выбора фишек
watch(
  () => props.mapTokenClick?.seq,
  () => {
    const click = props.mapTokenClick
    if (!click || !tokenPickOnMap.value) return
    const key = tokenKeyForCellClick(regionTokenViews.value, selectedTokenKeys.value, click.q, click.r)
    if (!key) {
      stepError.value = 'На этой клетке нет фишки лицом вверх из региона маркера'
      return
    }
    toggleTokenPick(key)
  },
)

function toggleShip(id: string, disabled?: string) {
  if (disabled) return
  const idx = selectedShipIds.value.indexOf(id)
  if (idx >= 0) {
    selectedShipIds.value = selectedShipIds.value.filter((x) => x !== id)
  } else {
    selectedShipIds.value = [...selectedShipIds.value, id]
  }
  stepError.value = null
}

function toggleSelectAll() {
  if (allSelectableSelected.value) {
    const selectable = new Set(selectableShipIds.value)
    selectedShipIds.value = selectedShipIds.value.filter((id) => !selectable.has(id))
  } else {
    const merged = new Set([...selectedShipIds.value, ...selectableShipIds.value])
    selectedShipIds.value = [...merged]
  }
  stepError.value = null
}

function getBuildCount(type: ShipType): number {
  return buildCounts.value[type] ?? 0
}

function setBuildCount(type: ShipType, value: number) {
  buildCounts.value = { ...buildCounts.value, [type]: Math.max(0, Math.floor(value)) }
  stepError.value = null
}

function canAddBuildShip(opt: BuildableShipOption): boolean {
  if (!actionMarker.value || !buildRegionSummary.value || !buildResourceBalance.value) return false
  if (opt.disabledReason && getBuildCount(opt.type) < 1) return false
  if (getBuildCount(opt.type) >= opt.maxCount) return false

  const region = getRegionForMarker(props.snapshot, props.map.id, actionMarker.value)
  if (!region || !canBuildShipInRegionSize(opt.type, region.size)) return false

  const bal = buildResourceBalance.value
  if (bal.creditsLeft < opt.cost.credits) return false
  if (bal.productionLeft < opt.cost.production) return false
  if (buildTotalShips.value >= buildPlacementCapacity.value) return false

  return true
}

function incrementBuildCount(type: ShipType) {
  const opt = buildShipOptions.value.find((o) => o.type === type)
  if (!opt || !canAddBuildShip(opt)) return
  setBuildCount(type, getBuildCount(type) + 1)
}

function decrementBuildCount(type: ShipType) {
  if (getBuildCount(type) < 1) return
  setBuildCount(type, getBuildCount(type) - 1)
}

function autoFillTokenPick(options?: { silent?: boolean }) {
  if (!actionMarker.value) return
  const need = buildCostTotals.value
  const refs = autoAllocateTokens(
    props.snapshot,
    props.map.id,
    actionMarker.value,
    need.credits,
    need.production,
  )
  if (!refs) {
    if (!options?.silent) stepError.value = 'Не удалось подобрать фишки автоматически'
    return
  }
  selectedTokenKeys.value = refs.map((ref) => tokenSpendKey(ref.coord, ref.tokenIndex))
  tokenPickTouched.value = false
  stepError.value = null
}

function setPaymentMode(mode: 'auto' | 'manual') {
  if (buildPaymentMode.value === mode) return
  buildPaymentMode.value = mode
  stepError.value = null
  if (mode === 'auto') {
    selectedTokenKeys.value = []
    tokenPickTouched.value = false
    return
  }
  // Ручной режим стартует с автоподбора — его остаётся только поправить
  if (!tokenPickTouched.value) autoFillTokenPick({ silent: true })
}

function toggleTokenPick(key: string) {
  selectedTokenKeys.value = toggleTokenKey(selectedTokenKeys.value, key)
  tokenPickTouched.value = true
  stepError.value = null
}

function clearTokenPick() {
  selectedTokenKeys.value = []
  tokenPickTouched.value = true
  stepError.value = null
}

function buildOrders(): ShipBuildOrder[] {
  const orders: ShipBuildOrder[] = []
  for (const opt of buildShipOptions.value) {
    const n = buildCounts.value[opt.type] ?? 0
    for (let i = 0; i < n; i += 1) orders.push({ type: opt.type })
  }
  return orders
}

function onStartPick() {
  if (selectedShipIds.value.length === 0) {
    stepError.value = 'Выберите хотя бы один корабль'
    return
  }
  if (actionMode.value === 'build') return
  emit('startPick', {
    shipIds: [...selectedShipIds.value],
    mode: actionMode.value,
  })
}

function onExecuteBuild() {
  if (buildTotalShips.value === 0) {
    stepError.value = 'Выберите корабли для постройки'
    return
  }
  if (!isManualPayment.value) {
    emit('executeBuild', { orders: buildOrders(), spentTokens: null })
    return
  }
  if (!actionMarker.value) {
    stepError.value = 'Маркер действия не найден'
    return
  }
  const need = buildCostTotals.value
  const spentTokens = manualSpendRefs.value
  const errors = validateTokenPayment(
    props.snapshot,
    props.map.id,
    props.playerId,
    actionMarker.value,
    need.credits,
    need.production,
    spentTokens,
  )
  if (errors.length) {
    stepError.value = errors[0] ?? 'Выбранными фишками постройку не оплатить'
    return
  }
  emit('executeBuild', { orders: buildOrders(), spentTokens })
}

function onRemoveMarker() {
  if (
    !window.confirm(
      'Снять маркер действия с этой клетки?\n\nПлан на эту клетку будет отменён. Это нельзя отменить.',
    )
  ) {
    return
  }
  emit('removeMarker')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Enter') return
  if (actionMode.value === 'build') {
    if (!buildBlockedReason.value) {
      e.preventDefault()
      onExecuteBuild()
    }
    return
  }
  if (selectedShipIds.value.length > 0) {
    e.preventDefault()
    onStartPick()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="marker-modal-backdrop"
    :class="{ 'marker-modal-backdrop--map': tokenPickOnMap }"
    @click.self="onBackdropClick"
  >
    <div
      ref="panelRef"
      class="marker-modal"
      :class="{ 'is-dragging': isDragging }"
      :style="panelStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="marker-modal-title"
    >
      <header class="modal-header drag-handle" @pointerdown="onDragHandlePointerDown">
        <div>
          <h2 id="marker-modal-title">Маркер действия</h2>
          <p class="modal-sub">
            Клетка ({{ source.q }}, {{ source.r }})
          </p>
        </div>
        <button type="button" class="close-btn" title="Esc — закрыть" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="mode-tabs" role="tablist" aria-label="Что сделать маркером">
        <button
          v-if="modeAllowed('movement')"
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ active: actionMode === 'movement' }"
          :aria-selected="actionMode === 'movement'"
          @click="actionMode = 'movement'"
        >
          Перемещение
        </button>
        <button
          v-if="modeAllowed('bombardment')"
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ active: actionMode === 'bombardment' }"
          :aria-selected="actionMode === 'bombardment'"
          @click="actionMode = 'bombardment'"
        >
          Обстрел
        </button>
        <button
          v-if="modeAllowed('build')"
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ active: actionMode === 'build' }"
          :aria-selected="actionMode === 'build'"
          @click="actionMode = 'build'"
        >
          Постройка
        </button>
      </div>

      <div class="modal-body">
        <template v-if="actionMode === 'build'">
          <p class="lead">
            Постройка кораблей на клетке маркера. Оплата — фишками лицом вверх из региона маркера:
            автоматически или выбранными вручную.
          </p>
          <div v-if="buildResourceBalance" class="resource-row" aria-live="polite">
            <span class="resource-chip">
              <span class="resource-symbol" aria-hidden="true">₡</span>
              <span :class="{ 'resource-warn': buildResourceBalance.creditsLeft < 0 }">
                {{ buildResourceBalance.creditsLeft }}
              </span>
              <span class="resource-meta">из {{ buildResourceBalance.creditsTotal }}</span>
            </span>
            <span class="resource-chip">
              <span class="resource-symbol" aria-hidden="true">⚙</span>
              <span :class="{ 'resource-warn': buildResourceBalance.productionLeft < 0 }">
                {{ buildResourceBalance.productionLeft }}
              </span>
              <span class="resource-meta">из {{ buildResourceBalance.productionTotal }}</span>
            </span>
            <span class="resource-meta">слоты {{ buildTotalShips }}/{{ buildPlacementCapacity }}</span>
          </div>
          <section v-if="buildShipOptions.length" class="pay-block" aria-label="Оплата фишками">
            <div class="pay-head">
              <span class="pay-title">Оплата фишками</span>
              <div class="pay-modes" role="group" aria-label="Способ оплаты">
                <button
                  type="button"
                  class="pay-mode"
                  :class="{ active: !isManualPayment }"
                  :aria-pressed="!isManualPayment"
                  @click="setPaymentMode('auto')"
                >
                  Автоматически
                </button>
                <button
                  type="button"
                  class="pay-mode"
                  :class="{ active: isManualPayment }"
                  :aria-pressed="isManualPayment"
                  @click="setPaymentMode('manual')"
                >
                  Выбрать фишки
                </button>
              </div>
            </div>

            <p v-if="!isManualPayment" class="pay-hint">
              Фишки спишутся сами: сначала самые крупные лицом вверх из региона маркера.
            </p>

            <template v-else>
              <p class="pay-hint pay-hint--map">
                Отмечайте фишки прямо на карте: подходящие подсвечены пунктиром, выбранные —
                розовым кольцом. Окно можно отодвинуть, потянув за шапку.
              </p>
              <p class="pay-hint">
                Отметьте фишки для оплаты. Нужно
                <span class="cost-credits">₡{{ buildCostTotals.credits }}</span>
                ·
                <span class="cost-production">⚙{{ buildCostTotals.production }}</span>.
                Фишка тратится целиком, излишек сгорает.
              </p>

              <div class="pay-summary" aria-live="polite">
                <span
                  class="pay-chip"
                  :class="{ 'pay-chip--short': manualPaymentCoverage.creditsMissing > 0 }"
                >
                  ₡ {{ manualPaymentTotals.credits }} / {{ buildCostTotals.credits }}
                </span>
                <span
                  class="pay-chip"
                  :class="{ 'pay-chip--short': manualPaymentCoverage.productionMissing > 0 }"
                >
                  ⚙ {{ manualPaymentTotals.production }} / {{ buildCostTotals.production }}
                </span>
                <span class="pay-meta">фишек выбрано: {{ selectedTokenKeys.length }}</span>
                <span
                  v-if="manualPaymentCoverage.covered
                    && (manualPaymentCoverage.creditsExtra > 0 || manualPaymentCoverage.productionExtra > 0)"
                  class="pay-meta pay-meta--extra"
                >
                  сгорит излишек ₡{{ manualPaymentCoverage.creditsExtra }}
                  · ⚙{{ manualPaymentCoverage.productionExtra }}
                </span>
              </div>

              <div class="pay-actions">
                <button
                  type="button"
                  class="btn-select-all"
                  :disabled="buildTotalShips === 0"
                  title="Заполнить выбор так же, как это сделал бы автоподбор"
                  @click="autoFillTokenPick()"
                >
                  Подобрать автоматически
                </button>
                <button
                  type="button"
                  class="btn-select-all"
                  :disabled="selectedTokenKeys.length === 0"
                  @click="clearTokenPick"
                >
                  Снять выбор
                </button>
              </div>

              <ul v-if="regionTokenCells.length" class="token-cells">
                <li v-for="cell in regionTokenCells" :key="cell.cellKey" class="token-cell">
                  <span class="token-cell-label">({{ cell.coord.q }}, {{ cell.coord.r }})</span>
                  <div class="token-chips">
                    <button
                      v-for="view in cell.tokens"
                      :key="view.key"
                      type="button"
                      class="token-chip"
                      :class="{ selected: selectedTokenKeys.includes(view.key) }"
                      :aria-pressed="selectedTokenKeys.includes(view.key)"
                      :title="view.token.type === 'credits'
                        ? `Фишка кредитов ${view.value} на клетке (${cell.coord.q}, ${cell.coord.r})`
                        : `Фишка производства ${view.value} на клетке (${cell.coord.q}, ${cell.coord.r})`"
                      @click="toggleTokenPick(view.key)"
                    >
                      <svg width="26" height="26" viewBox="-14 -14 28 28" aria-hidden="true">
                        <ResourceTokenGlyph :token="view.token" :scale="0.92" />
                      </svg>
                      <span
                        class="token-chip-value"
                        :class="view.token.type === 'credits' ? 'cost-credits' : 'cost-production'"
                      >
                        {{ view.token.type === 'credits' ? '₡' : '⚙' }}{{ view.value }}
                      </span>
                    </button>
                  </div>
                </li>
              </ul>
              <p v-else class="empty">В регионе маркера нет фишек лицом вверх.</p>
            </template>
          </section>

          <ul v-if="buildShipOptions.length" class="ship-list">
            <li v-for="opt in buildShipOptions" :key="opt.type">
              <div
                class="ship-row build-row"
                :class="{
                  disabled: !!opt.disabledReason && getBuildCount(opt.type) < 1,
                  selected: getBuildCount(opt.type) > 0,
                  'can-add': canAddBuildShip(opt),
                }"
                @click="incrementBuildCount(opt.type)"
                @contextmenu.prevent="decrementBuildCount(opt.type)"
              >
                <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">
                  <ShipGlyph
                    :type="opt.type"
                    :player-color="playerColor"
                    :scale="0.85"
                    :show-plate="true"
                  />
                </svg>
                <span class="ship-meta">
                  <strong>{{ SHIP_SHORT[opt.type] }}</strong>
                  <span class="ship-range">
                    <span class="cost-credits">₡{{ opt.cost.credits }}</span>
                    · <span class="cost-production">⚙{{ opt.cost.production }}</span>
                    · {{ opt.fleetCount }}/{{ opt.fleetMax }}
                  </span>
                  <span v-if="opt.disabledReason && getBuildCount(opt.type) < 1" class="ship-disabled">
                    {{ opt.disabledReason }}
                  </span>
                </span>
                <div class="count-stepper" @click.stop>
                  <button
                    type="button"
                    class="stepper-btn"
                    :disabled="getBuildCount(opt.type) < 1"
                    @click="decrementBuildCount(opt.type)"
                  >
                    −
                  </button>
                  <span class="count-display">{{ getBuildCount(opt.type) }}</span>
                  <button
                    type="button"
                    class="stepper-btn"
                    :disabled="!canAddBuildShip(opt)"
                    @click="incrementBuildCount(opt.type)"
                  >
                    +
                  </button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="empty">Нет доступных кораблей для постройки в этом регионе.</p>
        </template>

        <template v-else>
          <p v-if="actionMode === 'movement'" class="lead">
            Выберите корабли для перемещения. Затем укажите клетки назначения на карте.
            Красные клетки — бой; за одно действие можно вступить в бой только на одной клетке.
          </p>
          <p v-else class="lead">
            Выберите корабли с дальним огнём: крейсер, линкор или гиперорудие.
            Затем укажите одну цель обстрела на карте — корабли не входят в клетку.
          </p>
          <div v-if="shipOptions.length" class="ship-list-toolbar">
            <button
              type="button"
              class="btn-select-all"
              :disabled="selectableShipIds.length === 0"
              @click="toggleSelectAll"
            >
              {{ allSelectableSelected ? 'Снять выбор' : 'Выбрать все' }}
            </button>
          </div>
          <ul v-if="shipOptions.length" class="ship-list">
            <li v-for="opt in shipOptions" :key="opt.ship.id">
              <label
                class="ship-row"
                :class="{ disabled: !!opt.disabledReason, selected: selectedShipIds.includes(opt.ship.id) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedShipIds.includes(opt.ship.id)"
                  :disabled="!!opt.disabledReason"
                  @change="toggleShip(opt.ship.id, opt.disabledReason)"
                />
                <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">
                  <ShipGlyph
                    :type="opt.ship.type"
                    :player-color="playerColor"
                    :scale="0.85"
                    :show-plate="true"
                  />
                </svg>
                <span class="ship-meta">
                  <strong>{{ SHIP_LABELS[opt.ship.type] }}</strong>
                  <span class="ship-range">{{ shipRangeLabel(opt) }}</span>
                  <span v-if="opt.disabledReason" class="ship-disabled">{{ opt.disabledReason }}</span>
                </span>
              </label>
            </li>
          </ul>
          <p v-else class="empty">
            <template v-if="actionMode === 'bombardment'">
              Нет кораблей, способных обстреливать с этой клетки.
            </template>
            <template v-else>
              На клетке нет ваших кораблей для перемещения.
            </template>
          </p>
        </template>
      </div>

      <p v-if="stepError" class="step-error">{{ stepError }}</p>

      <footer class="modal-footer">
        <button v-if="allowRemoveMarker" type="button" class="btn-danger-ghost" @click="onRemoveMarker">
          Снять маркер без действия
        </button>
        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>
        <button
          v-if="sharedCellEnemy"
          type="button"
          class="btn-primary"
          title="Бой с чужими кораблями на этой клетке, без перемещения"
          @click="emit('assault')"
        >
          Атаковать на клетке
        </button>
        <button
          v-if="actionMode === 'build'"
          type="button"
          class="btn-primary"
          :disabled="!!buildBlockedReason"
          :title="buildBlockedReason ?? 'Построить корабли на клетке маркера'"
          @click="onExecuteBuild"
        >
          Построить (Enter)
        </button>
        <button
          v-else
          type="button"
          class="btn-primary"
          :disabled="selectedShipIds.length === 0"
          @click="onStartPick"
        >
          {{ actionMode === 'bombardment' ? 'Выбрать цель (Enter)' : 'Выбрать на карте (Enter)' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* Выбор фишек на карте: фон пропускает клики к доске, само окно остаётся кликабельным */
.marker-modal-backdrop.marker-modal-backdrop--map {
  pointer-events: none;
  background: rgba(2, 6, 23, 0.2);
}
.marker-modal-backdrop.marker-modal-backdrop--map .marker-modal {
  pointer-events: auto;
}
.pay-hint--map {
  color: #fcd34d;
}
.marker-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0.75rem;
  background: rgba(2, 6, 23, 0.55);
  pointer-events: auto;
}

.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.is-dragging .drag-handle {
  cursor: grabbing;
}
.marker-modal {
  width: min(100%, 420px);
  max-height: min(85vh, 560px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid rgba(100, 116, 139, 0.8);
  background: rgba(15, 23, 42, 0.97);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  color: #e2e8f0;
}

@media (min-width: 640px) {
  .marker-modal-backdrop {
    align-items: center;
  }
}

@media (max-width: 639px) {
  .marker-modal-backdrop {
    padding: 0;
    align-items: stretch;
  }

  .marker-modal {
    width: 100%;
    max-height: 100%;
    border-radius: 12px 12px 0 0;
  }
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem 0.5rem;
  border-bottom: 1px solid #334155;
}

.modal-header h2 {
  margin: 0;
  font-size: 1rem;
}

.modal-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #94a3b8;
}

.mode-tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.55rem 1rem 0;
}

.mode-tab {
  flex: 1;
  padding: 0.4rem 0.35rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(30, 41, 59, 0.65);
  color: #94a3b8;
  font-size: 0.78rem;
  cursor: pointer;
}

.mode-tab.active {
  border-color: #38bdf8;
  background: rgba(12, 74, 110, 0.45);
  color: #e0f2fe;
  font-weight: 600;
}

.close-btn {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
}

.lead {
  margin: 0 0 0.75rem;
  font-size: 0.84rem;
  color: #cbd5e1;
}

.resource-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
}

.resource-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
}

.resource-symbol {
  opacity: 0.85;
}

.resource-meta {
  color: #94a3b8;
  font-size: 0.76rem;
}

.resource-warn {
  color: #f87171;
}

.cost-credits {
  color: #fde047;
}

.cost-production {
  color: #fb923c;
}

.ship-list-toolbar {
  display: flex;
  justify-content: center;
  margin: 0.15rem 0 0.65rem;
}

.btn-select-all {
  padding: 0.42rem 1rem;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.38);
  background: rgba(14, 165, 233, 0.1);
  color: #bae6fd;
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
}

.btn-select-all:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ship-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.ship-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(30, 41, 59, 0.65);
  cursor: pointer;
}

.build-row.selected {
  border-color: #38bdf8;
  background: rgba(12, 74, 110, 0.45);
}

.ship-row.selected {
  border-color: #38bdf8;
  background: rgba(12, 74, 110, 0.45);
}

.ship-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ship-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.82rem;
  min-width: 0;
}

.ship-range {
  color: #94a3b8;
  font-size: 0.76rem;
}

.ship-disabled {
  color: #f87171;
  font-size: 0.76rem;
}

.count-stepper {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.stepper-btn {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}

.stepper-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.count-display {
  min-width: 1.25rem;
  text-align: center;
  font-weight: 600;
}

.pay-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem 0.55rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(30, 41, 59, 0.5);
}
.pay-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
}
.pay-title {
  font-size: 0.78rem;
  font-weight: 650;
  color: #e2e8f0;
}
.pay-modes {
  display: inline-flex;
  gap: 0.2rem;
  padding: 0.12rem;
  border-radius: 999px;
  border: 1px solid #475569;
  background: rgba(15, 23, 42, 0.8);
}
.pay-mode {
  padding: 0.22rem 0.6rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #94a3b8;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}
.pay-mode.active {
  background: #1d4ed8;
  color: #f8fafc;
}
.pay-hint {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.35;
  color: #94a3b8;
}
.pay-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
}
.pay-chip {
  padding: 0.16rem 0.5rem;
  border-radius: 999px;
  border: 1px solid #475569;
  background: rgba(15, 23, 42, 0.75);
  color: #e2e8f0;
  font-size: 0.74rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pay-chip--short {
  border-color: #b91c1c;
  color: #fca5a5;
}
.pay-meta {
  font-size: 0.68rem;
  color: #94a3b8;
}
.pay-meta--extra {
  color: #fbbf24;
}
.pay-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.token-cells {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.token-cell {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.token-cell-label {
  min-width: 4.2rem;
  font-size: 0.68rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.token-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.token-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.16rem 0.4rem 0.16rem 0.22rem;
  border-radius: 8px;
  border: 1px solid #475569;
  background: rgba(15, 23, 42, 0.7);
  color: #e2e8f0;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.token-chip:hover {
  border-color: #60a5fa;
}
.token-chip.selected {
  border-color: #f472b6;
  background: rgba(131, 24, 67, 0.45);
  box-shadow: inset 0 0 0 1px rgba(244, 114, 182, 0.4);
}
.token-chip-value {
  font-size: 0.74rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.step-error {
  margin: 0;
  padding: 0 1rem 0.5rem;
  color: #f87171;
  font-size: 0.82rem;
}

.empty {
  color: #94a3b8;
  font-size: 0.84rem;
}

.modal-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.65rem 1rem 0.85rem;
  border-top: 1px solid #334155;
}

.btn-primary,
.btn-secondary,
.btn-danger-ghost {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
}

.btn-danger-ghost {
  margin-right: auto;
  border: 1px solid #7f1d1d;
  background: transparent;
  color: #fca5a5;
}

.btn-secondary {
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
}

.btn-primary {
  border: 1px solid #0284c7;
  background: #0369a1;
  color: #fff;
  font-weight: 600;
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
