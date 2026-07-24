<script setup lang="ts">
import type { GameSnapshot, HexCoord, MapDefinition } from '@galaxy/rules'
import { SHIP_LABELS, getMovableShipsAtMarker } from '@galaxy/rules'

const props = defineProps<{
  snapshot: GameSnapshot
  map: MapDefinition
  playerId: string
  source: HexCoord
}>()

const emit = defineEmits<{
  close: []
  startPick: [shipIds: string[]]
}>()

const selectedShipIds = ref<string[]>([])
const stepError = ref<string | null>(null)

const shipOptions = computed(() =>
  getMovableShipsAtMarker(props.snapshot, props.map, props.playerId, props.source),
)

const playerColor = computed(() => {
  return props.snapshot.players.find((p) => p.id === props.playerId)?.color ?? '#3B82F6'
})

function resetForm() {
  selectedShipIds.value = []
  stepError.value = null
}

watch(
  () => props.source,
  () => resetForm(),
  { immediate: true },
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

function onStartPick() {
  if (selectedShipIds.value.length === 0) {
    stepError.value = 'Выберите хотя бы один корабль'
    return
  }
  emit('startPick', [...selectedShipIds.value])
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
  if (e.key === 'Enter' && selectedShipIds.value.length > 0) {
    e.preventDefault()
    onStartPick()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="marker-modal-backdrop" @click.self="emit('close')">
    <div class="marker-modal" role="dialog" aria-modal="true" aria-labelledby="marker-modal-title">
      <header class="modal-header">
        <div>
          <h2 id="marker-modal-title">Движение с маркера</h2>
          <p class="modal-sub">
            Клетка ({{ source.q }}, {{ source.r }})
          </p>
        </div>
        <button type="button" class="close-btn" title="Esc — закрыть" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="modal-body">
        <p class="lead">
          Выберите корабли для перемещения. Затем укажите клетки назначения на карте.
        </p>
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
                <span class="ship-range">ход {{ opt.moveRange }}</span>
                <span v-if="opt.disabledReason" class="ship-disabled">{{ opt.disabledReason }}</span>
              </span>
            </label>
          </li>
        </ul>
        <p v-else class="empty">На клетке нет ваших кораблей для перемещения.</p>
      </div>

      <p v-if="stepError" class="step-error">{{ stepError }}</p>

      <footer class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="selectedShipIds.length === 0"
          @click="onStartPick"
        >
          Выбрать на карте (Enter)
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
  padding: 0.75rem;
  background: rgba(2, 6, 23, 0.55);
  pointer-events: auto;
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
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.82rem;
}
.ship-range {
  color: #94a3b8;
  font-size: 0.76rem;
}
.ship-disabled {
  color: #f87171;
  font-size: 0.76rem;
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
