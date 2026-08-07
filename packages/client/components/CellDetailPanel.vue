<script setup lang="ts">
import type { PlayerState } from '@galaxy/rules'
import { PLAYER_COLORS, getCellResourceToken } from '@galaxy/rules'
import type { BoardCellView } from '~/utils/board-adapter'
import {
  groupShipsByPlayer,
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
const ownerName = computed(() =>
  props.cell ? ownerLabel(props.cell.startPlayer, props.players) : '—',
)
</script>

<template>
  <section v-if="cell && cellKey" class="cell-detail">
    <header class="cell-head">
      <h3 class="cell-title">
        <span class="cell-coord" :title="`Клетка ${cellKey}`">{{ cellKey }}</span>
      </h3>
      <div class="cell-chips" role="list">
        <span
          class="chip chip--owner"
          role="listitem"
          :title="`Владелец: ${ownerName}`"
        >
          <span
            v-if="cell.startPlayer != null"
            class="owner-swatch"
            :style="{ background: PLAYER_COLORS[cell.startPlayer] }"
            aria-hidden="true"
          />
          <span v-else class="owner-swatch owner-swatch--neutral" aria-hidden="true" />
          <span class="chip-text">{{ ownerName }}</span>
        </span>

        <span
          v-if="cell.isPowerCenter"
          class="chip chip--power"
          role="listitem"
          title="Центр власти"
          aria-label="Центр власти"
        >
          <span class="chip-icon" aria-hidden="true">♛</span>
        </span>

        <span
          v-if="token"
          class="chip"
          role="listitem"
          :class="token.type === 'credits' ? 'chip--credits' : 'chip--production'"
          :title="resourceTokenLongLabel(token)"
          :aria-label="resourceTokenLongLabel(token)"
        >
          <span class="chip-icon" aria-hidden="true">{{ token.type === 'credits' ? '₡' : '⚙' }}</span>
          <span class="chip-text">{{ token.value }}</span>
          <span v-if="token.faceUp === false" class="chip-muted" aria-label="использовано">↻</span>
        </span>

        <span
          v-if="cell.actionMarker"
          class="chip chip--marker-action"
          role="listitem"
          title="Маркер действия"
          aria-label="Маркер действия"
        >
          <span class="marker-glyph marker-glyph--action" aria-hidden="true" />
        </span>
        <span
          v-if="cell.productionMarker"
          class="chip chip--marker-prod"
          role="listitem"
          title="Маркер производства"
          aria-label="Маркер производства"
        >
          <span class="marker-glyph marker-glyph--prod" aria-hidden="true" />
        </span>
      </div>
    </header>

    <div v-if="shipGroups.length" class="fleet-block">
      <p class="fleet-label">Флот</p>
      <ul class="fleet-groups">
        <li v-for="group in shipGroups" :key="group.player" class="fleet-group">
          <span
            class="owner-swatch"
            :style="{ background: PLAYER_COLORS[group.player] }"
            :title="`Игрок ${group.player}`"
            aria-hidden="true"
          />
          <ul class="fleet-ships">
            <li
              v-for="entry in group.entries"
              :key="entry.type"
              class="ship-pill"
              :title="`${SHIP_LABELS[entry.type]}${entry.count > 1 ? ` ×${entry.count}` : ''}`"
              :aria-label="`${SHIP_LABELS[entry.type]}${entry.count > 1 ? ` ×${entry.count}` : ''}`"
            >
              <svg class="ship-glyph-svg" viewBox="-14 -14 28 28" aria-hidden="true">
                <ShipGlyph
                  :type="entry.type"
                  :player-color="PLAYER_COLORS[group.player]"
                  :scale="0.72"
                  :show-plate="false"
                />
              </svg>
              <span v-if="entry.count > 1" class="ship-count">×{{ entry.count }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </div>
    <p v-else class="fleet-empty">Нет кораблей</p>

    <div v-if="canRemoveActionMarker && cell.actionMarker" class="remove-row">
      <button
        type="button"
        class="remove-marker-btn"
        title="Снять маркер действия без исполнения"
        @click="emit('removeActionMarker')"
      >
        <span class="marker-glyph marker-glyph--action" aria-hidden="true" />
        Снять
      </button>
    </div>
    <div v-if="canRemoveProductionMarker && cell.productionMarker" class="remove-row">
      <button
        type="button"
        class="remove-marker-btn remove-marker-btn--production"
        title="Снять маркер производства без постройки"
        @click="emit('removeProductionMarker')"
      >
        <span class="marker-glyph marker-glyph--prod" aria-hidden="true" />
        Снять
      </button>
    </div>
  </section>
  <section v-else class="cell-detail cell-detail--empty">
    <div class="empty-visual" aria-hidden="true">
      <span class="empty-hex" />
    </div>
    <p class="hint">Кликните клетку на карте</p>
  </section>
</template>

<style scoped>
.cell-detail {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.cell-head {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.cell-title {
  margin: 0;
  font-size: 0.82rem;
  color: #94a3b8;
  font-weight: 600;
}
.cell-coord {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: #e2e8f0;
}
.cell-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 1.55rem;
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.65);
  font-size: 0.74rem;
  font-weight: 600;
  color: #e2e8f0;
}
.chip--owner {
  max-width: 100%;
}
.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 9.5rem;
}
.chip-icon {
  font-size: 0.9rem;
  line-height: 1;
  font-weight: 800;
}
.chip-muted {
  color: #94a3b8;
  font-size: 0.72rem;
}
.chip--power {
  color: #fde68a;
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(113, 63, 18, 0.45);
}
.chip--credits {
  border-color: rgba(250, 204, 21, 0.4);
  background: rgba(66, 32, 6, 0.45);
}
.chip--credits .chip-icon {
  color: #facc15;
}
.chip--production {
  border-color: rgba(251, 146, 60, 0.45);
  background: rgba(67, 20, 7, 0.45);
}
.chip--production .chip-icon {
  color: #fb923c;
}
.chip--marker-action {
  border-color: rgba(250, 204, 21, 0.55);
  background: rgba(113, 63, 18, 0.4);
}
.chip--marker-prod {
  border-color: rgba(244, 114, 182, 0.55);
  background: rgba(131, 24, 67, 0.4);
}
.owner-swatch {
  display: inline-block;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.25);
}
.owner-swatch--neutral {
  background: repeating-linear-gradient(
    -45deg,
    #64748b,
    #64748b 2px,
    #334155 2px,
    #334155 4px
  );
}
.marker-glyph {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.marker-glyph--action {
  background: #facc15;
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.35);
}
.marker-glyph--prod {
  background: #f472b6;
  border-radius: 2px;
  box-shadow: 0 0 0 2px rgba(244, 114, 182, 0.35);
}
.fleet-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.fleet-label {
  margin: 0;
  font-size: 0.72rem;
  color: #94a3b8;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fleet-groups {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.fleet-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.fleet-ships {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.ship-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.3rem 0.1rem 0.15rem;
  border-radius: 6px;
  border: 1px solid rgba(71, 85, 105, 0.7);
  background: rgba(15, 23, 42, 0.75);
}
.ship-glyph-svg {
  width: 1.35rem;
  height: 1.35rem;
  display: block;
}
.ship-count {
  font-size: 0.72rem;
  font-weight: 700;
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
}
.fleet-empty {
  margin: 0;
  font-size: 0.76rem;
  color: #64748b;
}
.cell-detail--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0;
}
.empty-visual {
  opacity: 0.55;
}
.empty-hex {
  display: block;
  width: 1.6rem;
  height: 1.85rem;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  background: linear-gradient(160deg, #475569, #1e293b);
  border: 1px solid #64748b;
}
.hint {
  margin: 0;
  font-size: 0.76rem;
  color: #94a3b8;
  text-align: center;
}
.remove-row {
  margin-top: 0.1rem;
}
.remove-marker-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #ca8a04;
  background: rgba(113, 63, 18, 0.55);
  color: #fef08a;
  font-size: 0.76rem;
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
