<script setup lang="ts">
import {
  POWER_CENTER_COLORS,
  POWER_CENTER_GLYPH,
} from '~/utils/power-center-glyph'

withDefaults(
  defineProps<{
    scale?: number
    highContrast?: boolean
  }>(),
  { scale: 1, highContrast: false },
)
</script>

<template>
  <g class="power-center-glyph" :transform="`scale(${scale})`">
    <circle
      v-if="highContrast"
      r="9"
      fill="none"
      stroke="#f8fafc"
      stroke-width="0.8"
      opacity="0.75"
    />
    <path
      :d="POWER_CENTER_GLYPH.body"
      :fill="POWER_CENTER_COLORS.fill"
      :stroke="POWER_CENTER_COLORS.stroke"
      stroke-width="0.9"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <path
      :d="POWER_CENTER_GLYPH.band"
      :fill="POWER_CENTER_COLORS.fillDark"
      :stroke="POWER_CENTER_COLORS.stroke"
      stroke-width="0.9"
      stroke-linejoin="round"
    />
    <circle
      v-for="(jewel, idx) in POWER_CENTER_GLYPH.jewels"
      :key="idx"
      :cx="jewel.cx"
      :cy="jewel.cy"
      :r="jewel.r"
      :fill="POWER_CENTER_COLORS.jewel"
      :stroke="POWER_CENTER_COLORS.stroke"
      stroke-width="0.45"
    />
  </g>
</template>
