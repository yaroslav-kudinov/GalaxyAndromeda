<script setup lang="ts">
import type { ShipType } from '@galaxy/rules'
import { SHIP_GLYPHS } from '~/utils/ship-glyphs'

const props = withDefaults(
  defineProps<{
    type: ShipType
    playerColor: string
    scale?: number
    showPlate?: boolean
    onOwnedCell?: boolean
  }>(),
  { scale: 1, showPlate: true, onOwnedCell: false },
)

const glyph = computed(() => SHIP_GLYPHS[props.type])

const fillOpacity = computed(() => (props.onOwnedCell ? 0.95 : 0.9))
const offsetX = computed(() => (props.onOwnedCell ? 1.4 : 1))
const offsetY = computed(() => (props.onOwnedCell ? 1.6 : 1.2))
</script>

<template>
  <g class="ship-glyph" :class="{ 'on-owned-cell': onOwnedCell }" :transform="`scale(${scale})`">
    <!-- dark halo on owned cells — separates icon from same-color cell tint -->
    <circle
      v-if="showPlate && onOwnedCell"
      r="11.5"
      fill="#0f172a"
      opacity="0.4"
    />
    <!-- offset player-color fill layer -->
    <path
      :d="glyph.body"
      :fill="playerColor"
      :fill-opacity="fillOpacity"
      fill-rule="evenodd"
      :transform="`translate(${offsetX}, ${offsetY})`"
    />
    <!-- main hull: player fill + crisp black outline -->
    <path
      :d="glyph.body"
      :fill="playerColor"
      :fill-opacity="fillOpacity"
      fill-rule="evenodd"
      stroke="#000"
      stroke-width="1.75"
      stroke-linejoin="round"
      stroke-linecap="round"
      paint-order="stroke fill"
    />
    <path
      v-if="glyph.accent"
      :d="glyph.accent"
      fill="none"
      stroke="#000"
      stroke-width="1.25"
      stroke-linecap="round"
    />
  </g>
</template>
