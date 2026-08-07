<script setup lang="ts">
import type { ShipType } from '@galaxy/rules'
import { SHIP_GLYPHS } from '~/utils/ship-glyphs'

/** Hull border and type marks (diagonal strikes) share this weight */
const HULL_STROKE = 1.85

const props = withDefaults(
  defineProps<{
    type: ShipType
    playerColor: string
    scale?: number
    /** @deprecated plate/halo removed — contrast comes from fill + black stroke */
    showPlate?: boolean
    /** @deprecated owned-cell halo removed */
    onOwnedCell?: boolean
  }>(),
  { scale: 1, showPlate: false, onOwnedCell: false },
)

const glyph = computed(() => SHIP_GLYPHS[props.type])
</script>

<template>
  <g class="ship-glyph" :transform="`scale(${scale})`">
    <!-- offset player-color fill layer for slight depth -->
    <path
      :d="glyph.body"
      :fill="playerColor"
      fill-opacity="0.96"
      transform="translate(1, 1.2)"
    />
    <!-- main hull: bright player fill + crisp black outline -->
    <path
      :d="glyph.body"
      :fill="playerColor"
      fill-opacity="0.98"
      stroke="#000"
      :stroke-width="HULL_STROKE"
      stroke-linejoin="round"
      stroke-linecap="round"
      paint-order="stroke fill"
    />
    <!-- type marks (cruiser / battleship diagonals) — same stroke as hull border -->
    <path
      v-if="glyph.accent"
      :d="glyph.accent"
      fill="none"
      stroke="#000"
      :stroke-width="HULL_STROKE"
      stroke-linecap="butt"
      stroke-linejoin="miter"
    />
  </g>
</template>
