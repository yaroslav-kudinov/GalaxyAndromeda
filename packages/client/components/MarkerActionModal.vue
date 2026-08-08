<script setup lang="ts">

import type { GameSnapshot, HexCoord, MapDefinition } from '@galaxy/rules'

import {

  SHIP_LABELS,

  getBombardableShipsAtMarker,

  getMovableShipsAtMarker,

} from '@galaxy/rules'

import type { MarkerActionMode } from '~/composables/useActionOrderDraft'



const props = defineProps<{

  snapshot: GameSnapshot

  map: MapDefinition

  playerId: string

  source: HexCoord

}>()



const emit = defineEmits<{

  close: []

  startPick: [payload: { shipIds: string[]; mode: MarkerActionMode }]

  removeMarker: []

}>()



const actionMode = ref<MarkerActionMode>('movement')

const selectedShipIds = ref<string[]>([])

const stepError = ref<string | null>(null)

function shipRangeLabel(
  opt: import('@galaxy/rules').MovableShipOption | import('@galaxy/rules').BombardableShipOption,
): string {
  if ('fireRange' in opt) return `обстрел ${opt.fireRange}`
  return `ход ${opt.moveRange}`
}

const movableShipOptions = computed(() =>
  getMovableShipsAtMarker(props.snapshot, props.map, props.playerId, props.source),
)

const bombardableShipOptions = computed(() =>
  getBombardableShipsAtMarker(props.snapshot, props.map, props.playerId, props.source),
)

const shipOptions = computed(() =>
  actionMode.value === 'bombardment' ? bombardableShipOptions.value : movableShipOptions.value,
)



const selectableShipIds = computed(() =>

  shipOptions.value.filter((opt) => !opt.disabledReason).map((opt) => opt.ship.id),

)



const allSelectableSelected = computed(() => {

  const ids = selectableShipIds.value

  return ids.length > 0 && ids.every((id) => selectedShipIds.value.includes(id))

})



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



watch(actionMode, () => {

  selectedShipIds.value = []

  stepError.value = null

})



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



function onStartPick() {

  if (selectedShipIds.value.length === 0) {

    stepError.value = 'Выберите хотя бы один корабль'

    return

  }

  emit('startPick', {

    shipIds: [...selectedShipIds.value],

    mode: actionMode.value,

  })

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

          <h2 id="marker-modal-title">Маркер действия</h2>

          <p class="modal-sub">

            Клетка ({{ source.q }}, {{ source.r }})

          </p>

        </div>

        <button type="button" class="close-btn" title="Esc — закрыть" @click="emit('close')">

          ×

        </button>

      </header>



      <div class="mode-tabs" role="tablist" aria-label="Тип приказа">

        <button

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

          type="button"

          role="tab"

          class="mode-tab"

          :class="{ active: actionMode === 'bombardment' }"

          :aria-selected="actionMode === 'bombardment'"

          @click="actionMode = 'bombardment'"

        >

          Обстрел

        </button>

      </div>



      <div class="modal-body">

        <p v-if="actionMode === 'movement'" class="lead">

          Выберите корабли для перемещения. Затем укажите клетки назначения на карте.

          Красные клетки — бой; за один приказ — только одна клетка боя.

        </p>

        <p v-else class="lead">

          Выберите корабли с дальним огнём (крейсер, линкор, гиперпространственное орудие).

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

      </div>



      <p v-if="stepError" class="step-error">{{ stepError }}</p>



      <footer class="modal-footer">

        <button type="button" class="btn-danger-ghost" @click="onRemoveMarker">
          Снять маркер без действия
        </button>

        <button type="button" class="btn-secondary" @click="emit('close')">Отмена</button>

        <button

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

.mode-tabs {

  display: flex;

  gap: 0.35rem;

  padding: 0.55rem 1rem 0;

}

.mode-tab {

  flex: 1;

  padding: 0.4rem 0.5rem;

  border-radius: 8px;

  border: 1px solid #334155;

  background: rgba(30, 41, 59, 0.65);

  color: #94a3b8;

  font-size: 0.82rem;

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

  letter-spacing: 0.01em;

  cursor: pointer;

  transition:

    background 0.15s ease,

    border-color 0.15s ease,

    color 0.15s ease;

}

.btn-select-all:hover:not(:disabled) {

  color: #e0f2fe;

  border-color: rgba(56, 189, 248, 0.62);

  background: rgba(14, 165, 233, 0.18);

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

.btn-danger-ghost:hover {

  background: rgba(127, 29, 29, 0.35);

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

