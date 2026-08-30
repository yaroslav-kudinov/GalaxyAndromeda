<script setup lang="ts">
import type { MapCellDefinition } from '@galaxy/rules'
import { getCellResourceToken } from '@galaxy/rules'
import { resourceTokenGlyphScale } from '~/utils/board-glyphs'
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
  actionMarkerAvailable?: boolean
}>()

const lines = computed(() => cellOverviewLines(props.cell))
const token = computed(() => getCellResourceToken(props.cell))

const s = computed(() => props.hexSize)
const labelSize = computed(() => s.value * 0.24)
const badgeR = computed(() => s.value * 0.11)
const tokenScale = computed(() => resourceTokenGlyphScale(s.value))
const tokenLocalScale = computed(() => tokenScale.value / Math.max(0.01, props.contentScale))

const contentTopY = computed(() => {
  if (props.showPowerCenter && lines.value.isPowerCenter) return -s.value * 0.34
  if (props.showResource && token.value) return -s.value * 0.14
  return 0
})
</script>

<template>
  <g
    class="hex-overlay"
    :transform="`translate(${cx}, ${cy}) scale(${contentScale})`"
    pointer-events="none"
  >
    <g
      v-if="showResource && token"
      class="chip-group"
      :class="{ 'chip-group--spent': token.faceUp === false }"
      :transform="`translate(0, ${showPowerCenter && lines.isPowerCenter ? -s * 0.02 : -s * 0.14})`"
    >
      <ResourceTokenGlyph
        :token="token"
        :scale="tokenLocalScale"
        :high-contrast="true"
      />
    </g>

    <g v-if="showPowerCenter && lines.isPowerCenter" :transform="`translate(0, ${-s * 0.34})`">
      <circle class="power-halo" :r="s * 0.12" />
      <path
        class="power-glyph"
        :d="`M0,${-s * 0.08} L${s * 0.06},${s * 0.012} L${s * 0.085},${-s * 0.012} L${s * 0.035},${s * 0.07} L${-s * 0.035},${s * 0.07} L${-s * 0.085},${-s * 0.012} L${-s * 0.06},${s * 0.012} Z`"
      />
    </g>

    <g v-if="showActionMarker" :transform="`translate(${-s * 0.38}, ${contentTopY - s * 0.04})`">
      <circle
        class="marker-badge marker-badge--action"
        :class="{ 'marker-badge--available': actionMarkerAvailable }"
        :r="badgeR"
      />
      <text class="marker-badge-label" :font-size="labelSize * 0.75">A</text>
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
.marker-badge {
  stroke: #0f172a;
  stroke-width: 1.4;
}
.marker-badge--action {
  fill: #fef08a;
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
