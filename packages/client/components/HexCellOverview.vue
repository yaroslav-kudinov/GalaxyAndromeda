<script setup lang="ts">
import type { MapCellDefinition } from '@galaxy/rules'
import { getCellResourceToken } from '@galaxy/rules'
import { cellOverviewLines } from '~/utils/cell-display'

const props = defineProps<{
  cell: MapCellDefinition
  cx: number
  cy: number
  hexSize: number
  contentScale: number
  showResource: boolean
  showPowerCenter: boolean
  showActionMarker: boolean
  showProductionMarker: boolean
  actionMarkerAvailable?: boolean
  productionMarkerAvailable?: boolean
}>()

const lines = computed(() => cellOverviewLines(props.cell))
const token = computed(() => getCellResourceToken(props.cell))

const s = computed(() => props.hexSize)
const chipR = computed(() => s.value * 0.18)
const labelSize = computed(() => s.value * 0.24)
const badgeR = computed(() => s.value * 0.11)

const contentTopY = computed(() => {
  if (props.showPowerCenter && lines.value.isPowerCenter) return -s.value * 0.34
  if (props.showResource && lines.value.resource) return -s.value * 0.14
  return 0
})
</script>

<template>
  <g
    class="hex-overlay"
    :transform="`translate(${cx}, ${cy}) scale(${contentScale})`"
    pointer-events="none"
  >
    <g v-if="showPowerCenter && lines.isPowerCenter" :transform="`translate(0, ${-s * 0.34})`">
      <circle class="power-halo" :r="s * 0.12" />
      <path
        class="power-glyph"
        :d="`M0,${-s * 0.08} L${s * 0.06},${s * 0.012} L${s * 0.085},${-s * 0.012} L${s * 0.035},${s * 0.07} L${-s * 0.035},${s * 0.07} L${-s * 0.085},${-s * 0.012} L${-s * 0.06},${s * 0.012} Z`"
      />
    </g>

    <g
      v-if="showResource && lines.resource"
      class="chip-group"
      :class="{ 'chip-group--spent': token?.faceUp === false }"
      :transform="`translate(0, ${showPowerCenter && lines.isPowerCenter ? -s * 0.02 : -s * 0.14})`"
    >
      <circle
        class="chip-bg"
        :class="{
          credits: token?.type === 'credits',
          production: token?.type === 'production',
        }"
        :r="chipR"
      />
      <text class="chip-label" :font-size="labelSize">
        {{ lines.resource }}
      </text>
    </g>

    <g v-if="showActionMarker" :transform="`translate(${-s * 0.38}, ${contentTopY - s * 0.04})`">
      <circle
        class="marker-badge marker-badge--action"
        :class="{ 'marker-badge--available': actionMarkerAvailable }"
        :r="badgeR"
      />
      <text class="marker-badge-label" :font-size="labelSize * 0.75">A</text>
    </g>
    <g v-if="showProductionMarker" :transform="`translate(${s * 0.38}, ${contentTopY - s * 0.04})`">
      <circle
        class="marker-badge marker-badge--production"
        :class="{ 'marker-badge--available': productionMarkerAvailable }"
        :r="badgeR"
      />
      <text class="marker-badge-label" :font-size="labelSize * 0.75">P</text>
    </g>
  </g>
</template>

<style scoped>
.power-halo {
  fill: #0f172a;
  stroke: #facc15;
  stroke-width: 1.8;
}
.power-glyph {
  fill: #facc15;
  stroke: #422006;
  stroke-width: 0.6;
}
.chip-bg {
  fill: #0f172a;
  stroke-width: 2;
}
.chip-bg.credits {
  stroke: #fde047;
}
.chip-bg.production {
  stroke: #f472b6;
}
.chip-group--spent {
  opacity: 0.42;
}
.chip-label {
  fill: #fffbeb;
  text-anchor: middle;
  dominant-baseline: middle;
  font-weight: 800;
  paint-order: stroke fill;
  stroke: #0f172a;
  stroke-width: 2.2px;
}
.marker-badge {
  stroke: #0f172a;
  stroke-width: 1.4;
}
.marker-badge--action {
  fill: #fef08a;
}
.marker-badge--production {
  fill: #f472b6;
}
.marker-badge--available {
  animation: marker-badge-available 1.55s ease-in-out infinite;
}
@keyframes marker-badge-available {
  0%,
  100% {
    opacity: 0.58;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}
.marker-badge-label {
  fill: #0f172a;
  text-anchor: middle;
  dominant-baseline: middle;
  font-weight: 800;
}
</style>
