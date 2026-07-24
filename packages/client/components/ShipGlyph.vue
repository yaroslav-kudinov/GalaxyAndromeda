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
const hullStroke = computed(() => (props.onOwnedCell ? '#f8fafc' : props.playerColor))
const plateFill = computed(() => (props.onOwnedCell ? '#0f172a' : props.playerColor))
const plateOpacity = computed(() => (props.onOwnedCell ? 0.55 : 0.22))
</script>

<template>
  <g class="ship-glyph" :class="{ 'on-owned-cell': onOwnedCell }" :transform="`scale(${scale})`">
    <circle
      v-if="showPlate"
      r="10"
      :fill="plateFill"
      :opacity="plateOpacity"
      stroke="#f8fafc"
      :stroke-width="onOwnedCell ? 1.2 : 0"
    />
    <path
      :d="glyph.body"
      fill="#0f172a"
      :stroke="hullStroke"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <path
      v-if="glyph.detail"
      :d="glyph.detail"
      :fill="glyph.detailStrokeOnly ? 'none' : '#0f172a'"
      :stroke="hullStroke"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <circle
      v-if="glyph.circle"
      :cx="glyph.circle.cx"
      :cy="glyph.circle.cy"
      :r="glyph.circle.r"
      fill="#0f172a"
      :stroke="hullStroke"
      stroke-width="1.5"
    />
  </g>
</template>
