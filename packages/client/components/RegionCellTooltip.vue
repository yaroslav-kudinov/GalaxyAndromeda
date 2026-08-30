<script setup lang="ts">
import type { MapCellDefinition, PlayerState, RegionInfo } from '@galaxy/rules'
import { PLAYER_COLORS, getCellResourceToken, hexKey } from '@galaxy/rules'
import {
  groupShipsByPlayer,
  ownerLabel,
  resourceTokenLongLabel,
  shipTypeCountLabel,
} from '~/utils/cell-display'

const props = defineProps<{
  cell: MapCellDefinition
  regionInfo?: RegionInfo | null
  players?: PlayerState[]
  x: number
  y: number
}>()

const token = computed(() => getCellResourceToken(props.cell))
const shipGroups = computed(() => groupShipsByPlayer(props.cell.startingShips))
const ownerName = computed(() => ownerLabel(props.cell.startPlayer, props.players))
const coord = computed(() => hexKey(props.cell.q, props.cell.r))
const regionOwnerName = computed(() => {
  const info = props.regionInfo
  if (!info?.ownerId) return '—'
  return props.players?.find((p) => p.id === info.ownerId)?.name ?? info.ownerId
})
</script>

<template>
  <div
    class="hex-cell-tooltip"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="tooltip"
  >
    <header class="tooltip-head">
      <span class="tooltip-coord">{{ coord }}</span>
      <span class="tooltip-owner">
        <span
          v-if="cell.startPlayer != null"
          class="owner-swatch"
          :style="{ background: PLAYER_COLORS[cell.startPlayer] }"
          aria-hidden="true"
        />
        <span v-else class="owner-swatch owner-swatch--neutral" aria-hidden="true" />
        <span>{{ ownerName }}</span>
      </span>
    </header>

    <ul v-if="cell.isPowerCenter || token" class="tooltip-tokens">
      <li v-if="cell.isPowerCenter" class="token-row token-row--power">
        <span class="token-icon" aria-hidden="true">♛</span>
        <span>Центр власти</span>
      </li>
      <li
        v-if="token"
        class="token-row"
        :class="token.type === 'credits' ? 'token-row--credits' : 'token-row--production'"
      >
        <span class="token-icon" aria-hidden="true">{{ token.type === 'credits' ? '₡' : '⚙' }}</span>
        <span>{{ resourceTokenLongLabel(token) }}</span>
      </li>
    </ul>

    <section v-if="regionInfo" class="region-block">
      <p class="region-title">Регион</p>
      <ul class="region-stats">
        <li>Владелец: {{ regionOwnerName }}</li>
        <li>Клеток в регионе: {{ regionInfo.totalCells }}</li>
        <li>Клеток с фишками ресурсов: {{ regionInfo.resourceCells }}</li>
        <li>Клеток с активными фишками: {{ regionInfo.activeResourceCells }}</li>
        <li v-if="regionInfo.inactiveResourceCells > 0">
          Клеток только с фишками рубашкой вверх: {{ regionInfo.inactiveResourceCells }}
        </li>
        <li v-if="regionInfo.faceUpCredits > 0">
          Кредитов лицом вверх: {{ regionInfo.faceUpCredits }}
        </li>
        <li v-if="regionInfo.faceUpProduction > 0">
          Производства лицом вверх: {{ regionInfo.faceUpProduction }}
        </li>
        <li v-if="regionInfo.faceDownTokenCount > 0">
          Фишек рубашкой вверх: {{ regionInfo.faceDownTokenCount }}
        </li>
        <li v-if="regionInfo.powerCenterCount > 0">
          Центров власти: {{ regionInfo.powerCenterCount }}
        </li>
      </ul>
    </section>

    <div v-if="shipGroups.length" class="tooltip-fleet">
      <p class="fleet-label">Корабли</p>
      <ul class="fleet-list">
        <li v-for="group in shipGroups" :key="group.player" class="fleet-group">
          <div class="fleet-group-head">
            <span
              class="owner-swatch"
              :style="{ background: PLAYER_COLORS[group.player] }"
              aria-hidden="true"
            />
            <span class="fleet-owner">{{ ownerLabel(group.player, players) }}</span>
          </div>
          <ul class="fleet-ships">
            <li
              v-for="entry in group.entries"
              :key="entry.type"
              class="ship-row"
              :aria-label="shipTypeCountLabel(entry.type, entry.count)"
            >
              <svg class="ship-glyph-svg" viewBox="-14 -14 28 28" aria-hidden="true">
                <ShipGlyph
                  :type="entry.type"
                  :player-color="PLAYER_COLORS[group.player]"
                  :scale="0.58"
                />
              </svg>
              <span class="ship-label">{{ shipTypeCountLabel(entry.type, entry.count) }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </div>
    <p v-else-if="!regionInfo" class="fleet-empty">Кораблей нет</p>
  </div>
</template>

<style scoped>
.hex-cell-tooltip {
  --tooltip-font: 'Manrope', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  position: fixed;
  z-index: 200;
  max-width: 17rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(71, 85, 105, 0.85);
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  pointer-events: none;
  font-family: var(--tooltip-font);
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.45;
  color: #e8eef7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.tooltip-head {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.35rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgba(71, 85, 105, 0.55);
}
.tooltip-coord {
  font-size: 0.68rem;
  font-weight: 600;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.tooltip-owner {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 700;
  color: #f1f5f9;
}
.owner-swatch {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.3);
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
.tooltip-tokens {
  list-style: none;
  margin: 0 0 0.35rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.token-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  color: #cbd5e1;
}
.token-row--power {
  color: #fde68a;
}
.token-row--credits .token-icon {
  color: #facc15;
}
.token-row--production .token-icon {
  color: #fb923c;
}
.token-icon {
  font-weight: 700;
  width: 0.85rem;
  text-align: center;
}
.region-block {
  margin-bottom: 0.35rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgba(71, 85, 105, 0.55);
}
.region-title {
  margin: 0 0 0.25rem;
  font-size: 0.64rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.region-stats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 0.76rem;
}
.region-note {
  color: #94a3b8;
  font-weight: 500;
}
.tooltip-fleet {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.fleet-label {
  margin: 0;
  font-size: 0.64rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fleet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.fleet-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.fleet-group-head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.fleet-owner {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fleet-ships {
  list-style: none;
  margin: 0;
  padding: 0 0 0 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.ship-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: #cbd5e1;
}
.ship-glyph-svg {
  width: 1.05rem;
  height: 1.05rem;
  flex-shrink: 0;
  display: block;
}
.ship-label {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.fleet-empty {
  margin: 0;
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 500;
}
</style>
