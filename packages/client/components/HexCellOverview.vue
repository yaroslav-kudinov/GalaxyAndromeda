<script setup lang="ts">
import type { MapCellDefinition } from '@galaxy/rules'
import { getCellResourceToken } from '@galaxy/rules'
import { markerPaletteForSlot } from '~/utils/marker-colors'
import { resourceTokenGlyphScale } from '~/utils/board-glyphs'
import { TOKEN_CHIP_RADIUS } from '~/utils/resource-token-pips'
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
  /** Слоты владельцев маркеров действия: значок каждого — в цвете игрока. */
  actionMarkerPlayers?: number[]
  actionMarkerAvailable?: boolean
  /** Фишку на этой клетке можно выбрать для оплаты постройки */
  tokenPickable?: boolean
  /** Фишка выбрана для оплаты постройки */
  tokenPicked?: boolean
}>()

const lines = computed(() => cellOverviewLines(props.cell))
const token = computed(() => getCellResourceToken(props.cell))

const s = computed(() => props.hexSize)
const labelSize = computed(() => s.value * 0.24)
const badgeR = computed(() => s.value * 0.11)
const tokenScale = computed(() => resourceTokenGlyphScale(s.value))
const tokenLocalScale = computed(() => tokenScale.value / Math.max(0.01, props.contentScale))

/**
 * Цвета значка маркера. Один владелец — светлый тон его цвета; два (осада) — тот же кружок,
 * разрезанный по вертикали: слева первый, справа второй. Без владельца (редактор) — жёлтый.
 */
const markerHalves = computed(() => (props.actionMarkerPlayers ?? []).slice(0, 2).map(markerPaletteForSlot))

const tokenPickRingR = computed(() => (TOKEN_CHIP_RADIUS + 3.4) * tokenLocalScale.value)

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
      <circle
        v-if="tokenPickable || tokenPicked"
        class="token-pick-ring"
        :class="{ 'token-pick-ring--picked': tokenPicked }"
        :r="tokenPickRingR"
        fill="none"
      />
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
      <g class="marker-badge-wrap" :class="{ 'marker-badge--available': actionMarkerAvailable }">
        <template v-if="markerHalves.length === 2">
          <circle
            class="marker-badge-half"
            clip-path="url(#marker-half-left)"
            :style="{ fill: markerHalves[0]!.fill }"
            :r="badgeR"
          />
          <circle
            class="marker-badge-half"
            clip-path="url(#marker-half-right)"
            :style="{ fill: markerHalves[1]!.fill }"
            :r="badgeR"
          />
          <line class="marker-badge-split" :x1="0" :y1="-badgeR" :x2="0" :y2="badgeR" />
          <circle class="marker-badge marker-badge--outline" :r="badgeR" />
          <text class="marker-badge-label" :font-size="labelSize * 0.75">A</text>
        </template>
        <template v-else-if="markerHalves.length === 1">
          <circle
            class="marker-badge"
            :style="{ fill: markerHalves[0]!.fill, stroke: markerHalves[0]!.ink }"
            :r="badgeR"
          />
          <text class="marker-badge-label" :style="{ fill: markerHalves[0]!.ink }" :font-size="labelSize * 0.75">A</text>
        </template>
        <template v-else>
          <circle class="marker-badge marker-badge--action" :r="badgeR" />
          <text class="marker-badge-label" :font-size="labelSize * 0.75">A</text>
        </template>
      </g>
    </g>
  </g>
</template>

<style scoped>
.token-pick-ring {
  stroke: #facc15;
  stroke-width: 1.6;
  stroke-dasharray: 3.2 2.4;
  opacity: 0.9;
  animation: token-pick-pulse 1.6s ease-in-out infinite;
}
.token-pick-ring--picked {
  stroke: #f472b6;
  stroke-width: 2.4;
  stroke-dasharray: none;
  opacity: 1;
  animation: none;
  filter: drop-shadow(0 0 3px rgba(244, 114, 182, 0.8));
}
@keyframes token-pick-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .token-pick-ring {
    animation: none;
    opacity: 0.9;
  }
}
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
/* Осада: один кружок, разрезанный по вертикали на цвета двух владельцев маркеров. */
.marker-badge-half {
  stroke: none;
}
.marker-badge--outline {
  fill: none;
}
.marker-badge-split {
  stroke: #0f172a;
  stroke-width: 1.2;
}
</style>
