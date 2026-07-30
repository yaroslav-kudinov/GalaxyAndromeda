<script setup lang="ts">
import type { MapCellDefinition } from '@galaxy/rules'
import type { HexOrientation } from '~/utils/hex-layout'
import { hexCenter } from '~/utils/hex-layout'
import { usePlayerTerritoryLabels, type TerritoryLabelPlayer } from '~/composables/usePlayerTerritoryLabels'

const props = defineProps<{
  cells: MapCellDefinition[]
  players: TerritoryLabelPlayer[]
  hexSize: number
  orientation: HexOrientation
}>()

const labels = computed(() =>
  usePlayerTerritoryLabels(
    props.cells,
    props.players,
    (q, r) => hexCenter(q, r, props.hexSize, props.orientation),
    props.hexSize,
  ),
)
</script>

<template>
  <g class="territory-labels" aria-hidden="true" pointer-events="none">
    <g v-for="label in labels" :key="label.key" :transform="`translate(${label.x}, ${label.y})`">
      <rect class="territory-label-backdrop" x="-90" y="-12" width="180" height="24" rx="12" />
      <circle class="territory-label-dot" cx="-78" cy="0" r="4" :fill="label.color" />
      <text class="territory-label-text" x="-68" y="0">{{ label.name }}</text>
    </g>
  </g>
</template>

<style scoped>
.territory-label-backdrop {
  fill: rgba(2, 6, 23, 0.72);
  stroke: rgba(148, 163, 184, 0.35);
  stroke-width: 1;
}
.territory-label-dot {
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 1;
}
.territory-label-text {
  fill: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  dominant-baseline: middle;
  paint-order: stroke;
  stroke: rgba(2, 6, 23, 0.85);
  stroke-width: 2px;
  stroke-linejoin: round;
}
</style>
