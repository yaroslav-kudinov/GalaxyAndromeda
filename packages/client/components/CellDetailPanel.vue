<script setup lang="ts">
import type { PlayerState } from '@galaxy/rules'
import { PLAYER_COLORS, getCellResourceToken } from '@galaxy/rules'
import type { BoardCellView } from '~/utils/board-adapter'
import {
  groupShipsByPlayer,
  markerSummary,
  ownerLabel,
  resourceTokenLongLabel,
  SHIP_LABELS,
} from '~/utils/cell-display'

const props = defineProps<{
  cell: BoardCellView | null
  cellKey: string | null
  players?: PlayerState[]
  canRemoveActionMarker?: boolean
  canRemoveProductionMarker?: boolean
}>()

const emit = defineEmits<{
  removeActionMarker: []
  removeProductionMarker: []
}>()

const token = computed(() => (props.cell ? getCellResourceToken(props.cell) : undefined))
const shipGroups = computed(() => groupShipsByPlayer(props.cell?.startingShips))
const markers = computed(() => (props.cell ? markerSummary(props.cell) : null))
</script>

<template>
  <section v-if="cell && cellKey" class="cell-detail">
    <h3>Клетка ({{ cellKey }})</h3>

    <dl class="detail-grid">
      <dt>Владелец</dt>
      <dd>
        <span
          v-if="cell.startPlayer != null"
          class="owner-swatch"
          :style="{ background: PLAYER_COLORS[cell.startPlayer] }"
        />
        {{ ownerLabel(cell.startPlayer, players) }}
      </dd>

      <dt>Центр власти</dt>
      <dd>{{ cell.isPowerCenter ? 'Да ♛' : 'Нет' }}</dd>

      <dt>Ресурс</dt>
      <dd v-if="token" class="resource-summary" :class="`resource-summary--${token.type}`">
        <span class="resource-symbol" aria-hidden="true">{{ token.type === 'credits' ? '₡' : '⚙' }}</span>
        {{ resourceTokenLongLabel(token) }}
      </dd>
      <dd v-else>—</dd>

      <dt>Маркеры</dt>
      <dd>{{ markers ?? '—' }}</dd>

      <dt>Корабли</dt>
      <dd>
        <template v-if="shipGroups.length">
          <ul class="ship-detail-list">
            <li v-for="group in shipGroups" :key="group.player">
              <span
                class="owner-swatch"
                :style="{ background: PLAYER_COLORS[group.player] }"
              />
              <span class="player-tag">Игрок {{ group.player }}</span>
              <ul class="ship-types">
                <li v-for="entry in group.entries" :key="entry.type">
                  {{ SHIP_LABELS[entry.type] }}
                  <span v-if="entry.count > 1" class="count">×{{ entry.count }}</span>
                </li>
              </ul>
            </li>
          </ul>
        </template>
        <span v-else>—</span>
      </dd>
    </dl>

    <button
      v-if="canRemoveActionMarker && cell.actionMarker"
      type="button"
      class="remove-marker-btn"
      @click="emit('removeActionMarker')"
    >
      Снять маркер действия
    </button>
    <button
      v-if="canRemoveProductionMarker && cell.productionMarker"
      type="button"
      class="remove-marker-btn remove-marker-btn--production"
      @click="emit('removeProductionMarker')"
    >
      Снять маркер производства
    </button>
  </section>
  <section v-else class="cell-detail cell-detail--empty">
    <p class="hint">Кликните по клетке на карте для подробностей.</p>
  </section>
</template>

<style scoped>
.cell-detail h3 {
  margin: 0 0 0.5rem;
  font-size: 0.88rem;
  color: #e2e8f0;
}
.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 0.65rem;
  margin: 0;
  font-size: 0.78rem;
}
.detail-grid dt {
  color: #94a3b8;
  margin: 0;
}
.detail-grid dd {
  margin: 0;
  color: #e2e8f0;
}
.resource-summary {
  font-weight: 600;
}
.resource-symbol {
  display: inline-block;
  min-width: 1.1rem;
  font-size: 0.95rem;
  font-weight: 800;
  text-align: center;
}
.resource-summary--credits .resource-symbol {
  color: #facc15;
}
.resource-summary--production .resource-symbol {
  color: #fb923c;
}
.owner-swatch {
  display: inline-block;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
  margin-right: 0.35rem;
  vertical-align: middle;
  border: 1px solid rgba(0, 0, 0, 0.25);
}
.ship-detail-list,
.ship-types {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ship-detail-list > li + li {
  margin-top: 0.45rem;
}
.ship-types li {
  padding-left: 1rem;
  color: #cbd5e1;
}
.player-tag {
  font-weight: 600;
}
.count {
  color: #94a3b8;
}
.cell-detail--empty .hint {
  margin: 0;
  font-size: 0.78rem;
  color: #94a3b8;
}
.remove-marker-btn {
  margin-top: 0.65rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #ca8a04;
  background: rgba(113, 63, 18, 0.55);
  color: #fef08a;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.remove-marker-btn:hover {
  background: rgba(133, 77, 14, 0.75);
}
.remove-marker-btn--production {
  border-color: #db2777;
  background: rgba(131, 24, 67, 0.45);
  color: #fbcfe8;
}
.remove-marker-btn--production:hover {
  background: rgba(157, 23, 77, 0.65);
}
</style>
