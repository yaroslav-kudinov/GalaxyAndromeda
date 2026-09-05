<script setup lang="ts">
import type { BuildableShipOption, GameSnapshot, HexCoord, MapDefinition, ShipType } from '@galaxy/rules'
import {
  SHIP_LABELS,
  canBuildShipInRegionSize,
  getBuildableShipsForMarker,
  getRegionForMarker,
  getRegionResourceSummary,
  getTurnModifiers,
  isExtraMarkerBuyBlocked,
  MAX_PRODUCTION_MARKERS_PER_PLAYER,
  needsProductionTokenChoice,
  nextProductionMarkerExpandCost,
  productionMarkerLimitForPlayer,
  regionPlacementCapacity,
  canRemoveProductionMarkerThisTurn,
  hasBoughtProductionMarkerThisTurn,
} from '@galaxy/rules'
import type { ShipBuildOrder } from '~/composables/useProductionShipPick'
import type { ProductionOrderSlot } from '~/utils/production-order-slots'

const SHIP_SHORT: Record<ShipType, string> = {
  destroyer: 'Эсминец',
  cruiser: 'Крейсер',
  battleship: 'Линкор',
  shield: 'Щитоносец',
  carrier: 'Авианосец',
  hyper: 'Г.О.',
}

const props = withDefaults(
  defineProps<{
    snapshot: GameSnapshot
    map: MapDefinition
    playerId: string
    source: HexCoord
    markerId: string
    phase?: 'order' | 'confirm'
    orderSlots?: ProductionOrderSlot[]
  }>(),
  {
    phase: 'order',
    orderSlots: () => [],
  },
)

const emit = defineEmits<{
  close: []
  recharge: []
  startPick: [payload: { orders: ShipBuildOrder[] }]
  buyProductionMarker: []
  removeMarker: []
  confirmPlace: []
  backToPick: []
}>()

const isConfirmPhase = computed(() => props.phase === 'confirm')

const counts = ref<Partial<Record<ShipType, number>>>({})
const stepError = ref<string | null>(null)

const marker = computed(() =>
  props.snapshot.productionMarkers.find((m) => m.id === props.markerId) ?? null,
)

const regionSummary = computed(() =>
  marker.value
    ? getRegionResourceSummary(props.snapshot, props.map.id, marker.value)
    : null,
)

const showTokenChoice = computed(() =>
  marker.value
    ? needsProductionTokenChoice(props.snapshot, props.map.id, marker.value)
    : false,
)

const canRechargeResources = computed(
  () =>
    (regionSummary.value?.faceDownCreditsCount ?? 0)
    + (regionSummary.value?.faceDownProductionCount ?? 0)
    > 0,
)

const shipOptions = computed(() =>
  getBuildableShipsForMarker(props.snapshot, props.map.id, props.playerId, props.markerId),
)

const placementCapacity = computed(() => {
  if (!marker.value) return 0
  return regionPlacementCapacity(props.snapshot, props.map.id, marker.value)
})

const playerColor = computed(() =>
  props.snapshot.players.find((p) => p.id === props.playerId)?.color ?? '#3B82F6',
)

const totalShips = computed(() =>
  Object.values(counts.value).reduce((sum, n) => sum + (n ?? 0), 0),
)

const hasBuildOrder = computed(() => totalShips.value > 0)

const orderTotals = computed(() => {
  let credits = 0
  let production = 0
  for (const opt of shipOptions.value) {
    const n = counts.value[opt.type] ?? 0
    credits += n * opt.cost.credits
    production += n * opt.cost.production
  }
  return { credits, production }
})

const productionMarkerLimit = computed(() =>
  productionMarkerLimitForPlayer(props.snapshot, props.playerId),
)

const nextProductionMarkerCost = computed(() =>
  nextProductionMarkerExpandCost(productionMarkerLimit.value),
)

const canStartProductionMarkerBuy = computed(() => {
  if (isExtraMarkerBuyBlocked(props.snapshot)) return false
  if (hasBoughtProductionMarkerThisTurn(props.snapshot, props.playerId)) return false
  return nextProductionMarkerCost.value != null
})

const canDiscardProductionMarker = computed(() =>
  canRemoveProductionMarkerThisTurn(props.snapshot, props.playerId),
)

const resourceBalance = computed(() => {
  const summary = regionSummary.value
  if (!summary) return null
  return {
    creditsTotal: summary.faceUpCredits,
    productionTotal: summary.faceUpProduction,
    creditsUsed: orderTotals.value.credits,
    productionUsed: orderTotals.value.production,
    creditsLeft: summary.faceUpCredits - orderTotals.value.credits,
    productionLeft: summary.faceUpProduction - orderTotals.value.production,
  }
})

const regionPayHint = computed(
  () => 'Оплата — фишками лицом вверх из региона маркера действия.',
)

const rechargeBlockedReason = computed(() => {
  if (!canRechargeResources.value) return 'Нет перевёрнутых фишек в регионе'
  if (hasBuildOrder.value) return 'Сначала уберите корабли из заявки'
  return null
})

const productionMarkerBuyHint = computed(() => {
  if (isExtraMarkerBuyBlocked(props.snapshot)) return 'Маркеры производства отключены'
  if (hasBoughtProductionMarkerThisTurn(props.snapshot, props.playerId)) {
    return 'За этот ход уже куплен один маркер производства'
  }
  if (!nextProductionMarkerCost.value) return 'Лимит маркеров производства достигнут'
  return `₡ ${nextProductionMarkerCost.value.credits} · ⚙ ${nextProductionMarkerCost.value.production} — фишки с карты`
})

function resetForm() {
  counts.value = {}
  stepError.value = null
}

watch(() => props.markerId, () => resetForm(), { immediate: true })

function getCount(type: ShipType): number {
  return counts.value[type] ?? 0
}

function setCount(type: ShipType, value: number) {
  counts.value = { ...counts.value, [type]: Math.max(0, Math.floor(value)) }
  stepError.value = null
}

function canAddShip(opt: BuildableShipOption): boolean {
  if (!marker.value || !regionSummary.value || !resourceBalance.value) return false
  if (opt.disabledReason && getCount(opt.type) < 1) return false
  if (getCount(opt.type) >= opt.maxCount) return false

  const region = getRegionForMarker(props.snapshot, props.map.id, marker.value)
  if (!region || !canBuildShipInRegionSize(opt.type, region.size)) return false

  const bal = resourceBalance.value
  if (bal.creditsLeft < opt.cost.credits) return false
  if (bal.productionLeft < opt.cost.production) return false
  if (totalShips.value >= placementCapacity.value) return false

  return true
}

function incrementCount(type: ShipType) {
  const opt = shipOptions.value.find((o) => o.type === type)
  if (!opt || !canAddShip(opt)) return
  setCount(type, getCount(type) + 1)
}

function decrementCount(type: ShipType) {
  if (getCount(type) < 1) return
  setCount(type, getCount(type) - 1)
}

function onShipRowClick(opt: BuildableShipOption, event: MouseEvent) {
  if (event.button !== 0) return
  incrementCount(opt.type)
}

function onShipRowContextMenu(opt: BuildableShipOption) {
  decrementCount(opt.type)
}

function onRecharge() {
  if (rechargeBlockedReason.value) return
  emit('recharge')
}

function buildOrders(): ShipBuildOrder[] {
  const orders: ShipBuildOrder[] = []
  for (const opt of shipOptions.value) {
    const n = counts.value[opt.type] ?? 0
    for (let i = 0; i < n; i += 1) orders.push({ type: opt.type })
  }
  return orders
}

function onStartPick() {
  if (!hasBuildOrder.value) {
    stepError.value = 'Выберите корабли'
    return
  }
  emit('startPick', { orders: buildOrders() })
}

function onBuyProductionMarker() {
  if (!canStartProductionMarkerBuy.value) return
  emit('buyProductionMarker')
}

function onRemoveMarker() {
  if (!canDiscardProductionMarker.value) return
  if (
    !window.confirm(
      'Снять маркер производства с этой клетки?\n\nПлан постройки в этом регионе будет отменён. Это нельзя отменить.',
    )
  ) {
    return
  }
  emit('removeMarker')
}

function onConfirmPlace() {
  emit('confirmPlace')
}

function onBackToPick() {
  emit('backToPick')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (isConfirmPhase.value) {
      onBackToPick()
      return
    }
    emit('close')
  }
  if (e.key === 'Enter') {
    if (isConfirmPhase.value) {
      e.preventDefault()
      onConfirmPlace()
      return
    }
    if (hasBuildOrder.value) {
      e.preventDefault()
      onStartPick()
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="marker-modal-backdrop" @click.self="isConfirmPhase ? onBackToPick() : emit('close')">
    <div class="marker-modal" role="dialog" aria-modal="true" aria-labelledby="production-modal-title">
      <header class="modal-header">
        <div class="header-side header-side--left">
          <h2 id="production-modal-title">Производство</h2>
          <p class="modal-sub">
            Клетка ({{ source.q }}, {{ source.r }})
            <template v-if="isConfirmPhase">
              · предварительный вид постройки
            </template>
            <template v-else>
              <template v-if="showTokenChoice">
                · перезарядка или постройка — не оба
              </template>
              · корабли ставятся на клетку маркера
              · {{ regionPayHint }}
            </template>
          </p>
        </div>
        <div v-if="isConfirmPhase" class="confirm-hero" aria-live="polite">
          <p class="confirm-question">Разместить эти корабли?</p>
          <ProductionOrderStrip
            :slots="orderSlots"
            :player-color="playerColor"
            pulse-placed
          />
        </div>
        <div v-else-if="resourceBalance" class="resource-hero" aria-live="polite">
          <p class="resource-hero-label">Осталось после заявки</p>
          <div class="resource-hero-row">
            <span class="resource-chip resource-chip--credits">
              <span class="resource-symbol" aria-hidden="true">₡</span>
              <span
                class="resource-left"
                :class="{ 'resource-left--warn': resourceBalance.creditsLeft < 0 }"
              >
                {{ resourceBalance.creditsLeft }}
              </span>
              <span class="resource-meta">
                из {{ resourceBalance.creditsTotal }}
                <span v-if="resourceBalance.creditsUsed > 0" class="resource-spent">
                  −{{ resourceBalance.creditsUsed }}
                </span>
              </span>
            </span>
            <span class="resource-chip resource-chip--production">
              <span class="resource-symbol" aria-hidden="true">⚙</span>
              <span
                class="resource-left"
                :class="{ 'resource-left--warn': resourceBalance.productionLeft < 0 }"
              >
                {{ resourceBalance.productionLeft }}
              </span>
              <span class="resource-meta">
                из {{ resourceBalance.productionTotal }}
                <span v-if="resourceBalance.productionUsed > 0" class="resource-spent">
                  −{{ resourceBalance.productionUsed }}
                </span>
              </span>
            </span>
          </div>
          <p class="resource-hero-sub">
            слоты {{ totalShips }}/{{ placementCapacity }}
            <span class="resource-hint">ЛКМ + · ПКМ −</span>
          </p>
        </div>
        <div class="header-side header-side--right">
          <button
            type="button"
            class="close-btn"
            :title="isConfirmPhase ? 'Esc — назад к расстановке' : 'Esc — закрыть'"
            @click="isConfirmPhase ? onBackToPick() : emit('close')"
          >×</button>
        </div>
      </header>

      <div v-if="!isConfirmPhase" class="modal-body">
        <ul v-if="shipOptions.length" class="ship-list">
          <li v-for="opt in shipOptions" :key="opt.type">
            <div
              class="ship-row"
              :class="{
                disabled: !!opt.disabledReason && getCount(opt.type) < 1,
                selected: getCount(opt.type) > 0,
                'can-add': canAddShip(opt),
              }"
              :title="opt.disabledReason && getCount(opt.type) < 1
                ? `${SHIP_LABELS[opt.type]} — ${opt.disabledReason}`
                : SHIP_LABELS[opt.type]"
              @click="onShipRowClick(opt, $event)"
              @contextmenu.prevent="onShipRowContextMenu(opt)"
            >
              <svg width="22" height="22" viewBox="-14 -14 28 28" aria-hidden="true" class="ship-icon">
                <ShipGlyph
                  :type="opt.type"
                  :player-color="playerColor"
                  :scale="0.72"
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
                <span v-if="opt.disabledReason && getCount(opt.type) < 1" class="ship-disabled">
                  {{ opt.disabledReason }}
                </span>
              </span>
              <div class="count-stepper count-stepper--h" @click.stop>
                <button
                  type="button"
                  class="stepper-btn"
                  title="Убрать"
                  :disabled="getCount(opt.type) < 1"
                  @click="decrementCount(opt.type)"
                >
                  −
                </button>
                <span class="count-display">{{ getCount(opt.type) }}</span>
                <button
                  type="button"
                  class="stepper-btn"
                  title="Добавить"
                  :disabled="!canAddShip(opt)"
                  @click="incrementCount(opt.type)"
                >
                  +
                </button>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="empty">Нет доступных кораблей для этого маркера.</p>

        <div class="purchases" aria-label="Покупки и действия фазы">
          <div
            v-if="canRechargeResources"
            class="purchase-tile"
            :class="{ 'purchase-tile--warn': showTokenChoice || !shipOptions.some((o) => o.maxCount > 0) }"
          >
            <p class="purchase-title">Перезарядить фишки</p>
            <p class="purchase-sub">Перевёрнутые ресурсы региона лицом вверх</p>
            <button
              type="button"
              class="btn-primary purchase-btn"
              :disabled="!!rechargeBlockedReason"
              :title="rechargeBlockedReason ?? 'Перезарядить фишки региона'"
              @click="onRecharge"
            >
              Перезарядить
            </button>
          </div>

          <div class="purchase-tile">
            <p class="purchase-title">Маркер производства</p>
            <p class="purchase-sub">
              Лимит {{ productionMarkerLimit }}/{{ MAX_PRODUCTION_MARKERS_PER_PLAYER }}.
              {{ productionMarkerBuyHint }}
            </p>
            <button
              type="button"
              class="btn-secondary purchase-btn"
              :disabled="!canStartProductionMarkerBuy"
              :title="productionMarkerBuyHint"
              @click="onBuyProductionMarker"
            >
              Купить слот
            </button>
          </div>
        </div>

        <p v-if="hasBuildOrder" class="total-line">
          В заявке: {{ totalShips }} кор.
        </p>
      </div>

      <p v-if="!isConfirmPhase && stepError" class="step-error">{{ stepError }}</p>

      <footer v-if="isConfirmPhase" class="modal-footer">
        <button type="button" class="btn-secondary" @click="onBackToPick">
          Назад к расстановке
        </button>
        <button type="button" class="btn-primary" @click="onConfirmPlace">
          Да (Enter)
        </button>
      </footer>
      <footer v-else class="modal-footer">
        <button
          v-if="canDiscardProductionMarker"
          type="button"
          class="btn-danger-ghost"
          title="Снять маркер производства без постройки и без оплаты фишками"
          @click="onRemoveMarker"
        >
          Снять маркер
        </button>
        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!hasBuildOrder"
          @click="onStartPick"
        >
          Разместить (Enter)
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.marker-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0.6rem;
  background: rgba(2, 6, 23, 0.55);
  pointer-events: auto;
}
.marker-modal {
  width: min(100%, 820px);
  max-height: min(92vh, 640px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid rgba(100, 116, 139, 0.8);
  background: rgba(15, 23, 42, 0.97);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  color: #e2e8f0;
  overflow: hidden;
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
    border-radius: 12px 12px 0 0;
  }
}
.modal-header {
  display: grid;
  grid-template-columns: minmax(7.5rem, 1fr) auto minmax(7.5rem, 1fr);
  align-items: start;
  gap: 0.5rem 0.75rem;
  flex-shrink: 0;
  padding: 0.5rem 0.85rem 0.5rem;
  border-bottom: 1px solid #334155;
}
.header-side {
  min-width: 0;
}
.header-side--right {
  display: flex;
  justify-content: flex-end;
}
.modal-header h2 {
  margin: 0;
  font-size: 0.95rem;
}
.modal-sub {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #94a3b8;
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
.confirm-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-width: 0;
  text-align: center;
  padding: 0.15rem 0 0.1rem;
}
.confirm-question {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #fce7f3;
}
.resource-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  text-align: center;
}
.resource-hero-label {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #94a3b8;
}
.resource-hero-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.resource-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.28rem;
  padding: 0.22rem 0.7rem 0.18rem;
  border-radius: 12px;
  font-variant-numeric: tabular-nums;
}
.resource-chip--credits {
  background: rgba(234, 179, 8, 0.22);
  color: #fde047;
  border: 1px solid rgba(234, 179, 8, 0.4);
}
.resource-chip--production {
  background: rgba(249, 115, 22, 0.22);
  color: #fdba74;
  border: 1px solid rgba(249, 115, 22, 0.4);
}
.resource-symbol {
  font-size: 1.15rem;
  font-weight: 800;
  line-height: 1;
}
.resource-left {
  font-size: 1.55rem;
  font-weight: 800;
  line-height: 1;
  color: #e2e8f0;
}
.resource-chip--credits .resource-left,
.resource-chip--production .resource-left {
  color: inherit;
}
.resource-left--warn {
  color: #f87171 !important;
}
.resource-meta {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  margin-left: 0.1rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: #cbd5e1;
  opacity: 0.9;
}
.resource-spent {
  color: #f9a8d4;
  font-weight: 600;
}
.resource-hero-sub {
  margin: 0.22rem 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  font-size: 0.72rem;
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
}
.resource-hint {
  font-size: 0.68rem;
  color: #64748b;
}
@media (max-width: 639px) {
  .modal-header {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "title close"
      "hero hero";
  }
  .header-side--left {
    grid-area: title;
  }
  .header-side--right {
    grid-area: close;
  }
  .resource-hero,
  .confirm-hero {
    grid-area: hero;
  }
}
.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.5rem 0.85rem 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.ship-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.4rem;
  flex-shrink: 0;
}
@media (max-width: 720px) {
  .ship-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.ship-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.22rem;
  min-height: 0;
  padding: 0.35rem 0.4rem 0.3rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(30, 41, 59, 0.65);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, background 0.15s;
}
.ship-row.selected {
  border-color: rgba(244, 114, 182, 0.55);
  background: rgba(131, 24, 67, 0.28);
}
.ship-row.can-add:not(.disabled):hover {
  border-color: rgba(244, 114, 182, 0.45);
}
.ship-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ship-icon {
  flex-shrink: 0;
  align-self: center;
}
.ship-meta {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  font-size: 0.72rem;
  min-width: 0;
  text-align: center;
}
.ship-meta strong {
  font-size: 0.74rem;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ship-range {
  color: #94a3b8;
  font-size: 0.66rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cost-credits {
  color: #fde047;
  font-weight: 700;
}
.cost-production {
  color: #fb923c;
  font-weight: 700;
}
.ship-disabled {
  color: #f87171;
  font-size: 0.62rem;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.count-stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  flex-shrink: 0;
}
.count-stepper--h {
  flex-direction: row;
}
.stepper-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  height: 1.25rem;
  padding: 0;
  border: 1px solid #475569;
  border-radius: 5px;
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  color: #cbd5e1;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.stepper-btn:hover:not(:disabled) {
  border-color: #f472b6;
  color: #fce7f3;
  background: linear-gradient(180deg, #831843 0%, #500724 100%);
}
.stepper-btn:active:not(:disabled) {
  transform: scale(0.94);
}
.stepper-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.count-display {
  min-width: 1.2rem;
  text-align: center;
  font-size: 0.82rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #f9a8d4;
  line-height: 1.1;
}
.purchases {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.4rem;
  flex-shrink: 0;
}
.purchase-tile {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(30, 41, 59, 0.5);
}
.purchase-tile--warn {
  border-color: rgba(251, 191, 36, 0.45);
  background: rgba(120, 53, 15, 0.22);
}
.purchase-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 650;
  color: #e2e8f0;
}
.purchase-sub {
  margin: 0;
  flex: 1;
  font-size: 0.66rem;
  line-height: 1.3;
  color: #94a3b8;
}
.purchase-btn {
  align-self: flex-start;
  margin-top: 0.1rem;
}
.total-line {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.76rem;
  color: #f9a8d4;
}
.step-error {
  margin: 0;
  flex-shrink: 0;
  padding: 0 0.85rem 0.35rem;
  color: #f87171;
  font-size: 0.78rem;
}
.empty {
  margin: 0;
  color: #94a3b8;
  font-size: 0.8rem;
}
.modal-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
  flex-shrink: 0;
  padding: 0.45rem 0.85rem 0.6rem;
  border-top: 1px solid #334155;
}
.btn-primary,
.btn-secondary,
.btn-danger-ghost {
  padding: 0.38rem 0.7rem;
  border-radius: 8px;
  font-size: 0.78rem;
  cursor: pointer;
}
.btn-danger-ghost {
  margin-right: auto;
  border: 1px solid #7f1d1d;
  background: transparent;
  color: #fca5a5;
}
.btn-danger-ghost:hover {
  background: rgba(127, 29, 29, 0.35);
}
.btn-secondary {
  border: 1px solid #475569;
  background: #334155;
  color: #e2e8f0;
}
.btn-primary {
  border: 1px solid #db2777;
  background: #be185d;
  color: #fff;
  font-weight: 600;
}
.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
