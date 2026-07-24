<script setup lang="ts">
import type { BuildableShipOption, GameSnapshot, HexCoord, MapDefinition, ShipType } from '@galaxy/rules'
import {
  SHIP_LABELS,
  canBuildShipInRegionSize,
  getBuildableShipsForMarker,
  getRegionForMarker,
  getRegionResourceSummary,
  needsProductionTokenChoice,
  regionPlacementCapacity,
} from '@galaxy/rules'
import type { ShipBuildOrder } from '~/composables/useProductionShipPick'

const props = defineProps<{
  snapshot: GameSnapshot
  map: MapDefinition
  playerId: string
  source: HexCoord
  markerId: string
}>()

const emit = defineEmits<{
  close: []
  recharge: []
  startPick: [orders: ShipBuildOrder[]]
}>()

const step = ref(0)
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

const canRechargeProduction = computed(
  () => (regionSummary.value?.faceDownProductionCount ?? 0) > 0,
)

const shipOptions = computed(() =>
  getBuildableShipsForMarker(props.snapshot, props.map.id, props.playerId, props.markerId),
)

const canBuildAny = computed(() =>
  shipOptions.value.some((o) => o.maxCount > 0 && !o.disabledReason),
)

const showRechargeOnly = computed(
  () => canRechargeProduction.value && !canBuildAny.value && !showTokenChoice.value,
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

function resetForm() {
  step.value = showTokenChoice.value || showRechargeOnly.value ? 0 : 1
  counts.value = {}
  stepError.value = null
}

watch(() => props.markerId, () => resetForm(), { immediate: true })

watch([showTokenChoice, showRechargeOnly], () => {
  if (step.value === 0 && !showTokenChoice.value && !showRechargeOnly.value) step.value = 1
})

function getCount(type: ShipType): number {
  return counts.value[type] ?? 0
}

function setCount(type: ShipType, value: number) {
  counts.value = { ...counts.value, [type]: Math.max(0, Math.floor(value)) }
  stepError.value = null
}

function canAddShip(opt: BuildableShipOption): boolean {
  if (!marker.value || !regionSummary.value || !resourceBalance.value) return false

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

function chooseBuild() {
  step.value = 1
  stepError.value = null
}

function onRecharge() {
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
  if (totalShips.value < 1) {
    stepError.value = 'Выберите хотя бы один корабль'
    return
  }
  emit('startPick', buildOrders())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
  if (e.key === 'Enter' && step.value === 1 && totalShips.value > 0) {
    e.preventDefault()
    onStartPick()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="marker-modal-backdrop" @click.self="emit('close')">
    <div class="marker-modal" role="dialog" aria-modal="true" aria-labelledby="production-modal-title">
      <header class="modal-header">
        <div>
          <h2 id="production-modal-title">Постройка по маркеру</h2>
          <p class="modal-sub">Клетка ({{ source.q }}, {{ source.r }})</p>
        </div>
        <button type="button" class="close-btn" title="Esc — закрыть" @click="emit('close')">×</button>
      </header>

      <div v-if="step === 0 && showTokenChoice" class="modal-body">
        <p class="lead">
          В регионе есть и лицевые, и перевёрнутые фишки производства. За этот маркер можно
          либо перезарядить производство, либо построить корабли — не оба сразу.
        </p>
        <div class="choice-actions">
          <button type="button" class="btn-primary" @click="onRecharge">
            Перезарядить (перевёрнутые фишки)
          </button>
          <button type="button" class="btn-secondary" @click="chooseBuild">
            Построить корабли
          </button>
        </div>
      </div>

      <div v-else-if="step === 0 && showRechargeOnly" class="modal-body">
        <p class="lead">
          Лицевых фишек производства не осталось — построить корабли нельзя. Можно перезарядить
          перевёрнутые фишки производства в регионе.
        </p>
        <div class="choice-actions">
          <button type="button" class="btn-primary" @click="onRecharge">
            Перезарядить производство
          </button>
        </div>
      </div>

      <div v-else-if="step === 1" class="modal-body">
        <div v-if="resourceBalance" class="resource-bar">
          <div class="resource-row">
            <span class="resource-chip resource-chip--credits">Кредиты</span>
            <span class="resource-values">
              <span class="resource-total">{{ resourceBalance.creditsTotal }}</span>
              <span class="resource-arrow">→</span>
              <span
                class="resource-left"
                :class="{ 'resource-left--warn': resourceBalance.creditsLeft < 0 }"
              >
                {{ resourceBalance.creditsLeft }}
              </span>
            </span>
            <span v-if="resourceBalance.creditsUsed > 0" class="resource-spent">
              −{{ resourceBalance.creditsUsed }}
            </span>
          </div>
          <div class="resource-row">
            <span class="resource-chip resource-chip--production">Производство</span>
            <span class="resource-values">
              <span class="resource-total">{{ resourceBalance.productionTotal }}</span>
              <span class="resource-arrow">→</span>
              <span
                class="resource-left"
                :class="{ 'resource-left--warn': resourceBalance.productionLeft < 0 }"
              >
                {{ resourceBalance.productionLeft }}
              </span>
            </span>
            <span v-if="resourceBalance.productionUsed > 0" class="resource-spent">
              −{{ resourceBalance.productionUsed }}
            </span>
          </div>
          <p class="resource-hint">
            ЛКМ по кораблю — добавить · ПКМ — убрать · слотов в регионе:
            {{ totalShips }}/{{ placementCapacity }}
          </p>
        </div>

        <p class="lead">
          Сформируйте заявку, затем разместите корабли по клеткам региона на карте.
        </p>

        <ul v-if="shipOptions.length" class="ship-list">
          <li v-for="opt in shipOptions" :key="opt.type">
            <div
              class="ship-row"
              :class="{
                disabled: !!opt.disabledReason && getCount(opt.type) < 1,
                selected: getCount(opt.type) > 0,
                'can-add': canAddShip(opt),
              }"
              @click="onShipRowClick(opt, $event)"
              @contextmenu.prevent="onShipRowContextMenu(opt)"
            >
              <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true" class="ship-icon">
                <ShipGlyph
                  :type="opt.type"
                  :player-color="playerColor"
                  :scale="0.85"
                  :show-plate="true"
                />
              </svg>
              <span class="ship-meta">
                <strong>{{ SHIP_LABELS[opt.type] }}</strong>
                <span class="ship-range">
                  {{ opt.cost.credits }} кр. · {{ opt.cost.production }} пр.
                </span>
                <span v-if="opt.disabledReason && getCount(opt.type) < 1" class="ship-disabled">
                  {{ opt.disabledReason }}
                </span>
              </span>
              <div class="count-stepper" @click.stop>
                <button
                  type="button"
                  class="stepper-btn stepper-btn--up"
                  title="Добавить"
                  :disabled="!canAddShip(opt)"
                  @click="incrementCount(opt.type)"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M6 2 L10 8 H2 Z" fill="currentColor" />
                  </svg>
                </button>
                <span class="count-display">{{ getCount(opt.type) }}</span>
                <button
                  type="button"
                  class="stepper-btn stepper-btn--down"
                  title="Убрать"
                  :disabled="getCount(opt.type) < 1"
                  @click="decrementCount(opt.type)"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M6 10 L2 4 H10 Z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="empty">Нет доступных кораблей для этого маркера.</p>
        <p v-if="totalShips > 0" class="total-line">В заявке: {{ totalShips }}</p>
      </div>

      <p v-if="stepError" class="step-error">{{ stepError }}</p>

      <footer v-if="step === 1" class="modal-footer">
        <button v-if="showTokenChoice" type="button" class="btn-secondary" @click="step = 0">
          Назад
        </button>
        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="totalShips < 1"
          @click="onStartPick"
        >
          Разместить на карте (Enter)
        </button>
      </footer>
      <footer v-else-if="step === 0" class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>
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
  padding: 0.75rem;
  background: rgba(2, 6, 23, 0.55);
  pointer-events: auto;
}
.marker-modal {
  width: min(100%, 440px);
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
  padding: 0.75rem 1rem;
}
.resource-bar {
  margin-bottom: 0.75rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(15, 23, 42, 0.85);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.resource-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
}
.resource-chip {
  min-width: 5.5rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-align: center;
}
.resource-chip--credits {
  background: rgba(234, 179, 8, 0.2);
  color: #fde047;
  border: 1px solid rgba(234, 179, 8, 0.35);
}
.resource-chip--production {
  background: rgba(249, 115, 22, 0.2);
  color: #fdba74;
  border: 1px solid rgba(249, 115, 22, 0.35);
}
.resource-values {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1;
}
.resource-total {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.resource-arrow {
  color: #64748b;
  font-size: 0.75rem;
}
.resource-left {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
}
.resource-left--warn {
  color: #f87171;
}
.resource-spent {
  font-size: 0.76rem;
  color: #f9a8d4;
  font-variant-numeric: tabular-nums;
}
.resource-hint {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #64748b;
  line-height: 1.35;
}
.lead {
  margin: 0 0 0.75rem;
  font-size: 0.84rem;
  color: #cbd5e1;
}
.choice-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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
}
.ship-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.82rem;
  flex: 1;
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
  flex-direction: column;
  align-items: center;
  gap: 0.12rem;
  flex-shrink: 0;
}
.stepper-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.15rem;
  padding: 0;
  border: 1px solid #475569;
  border-radius: 5px;
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  color: #cbd5e1;
  cursor: pointer;
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
.stepper-btn--up {
  border-bottom-left-radius: 3px;
  border-bottom-right-radius: 3px;
}
.stepper-btn--down {
  border-top-left-radius: 3px;
  border-top-right-radius: 3px;
}
.count-display {
  min-width: 1.5rem;
  text-align: center;
  font-size: 0.88rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #f9a8d4;
  line-height: 1.1;
}
.total-line {
  margin: 0.65rem 0 0;
  font-size: 0.82rem;
  color: #f9a8d4;
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
.btn-secondary {
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
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
.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
