<script setup lang="ts">
import type { ResourceTokenDef } from '@galaxy/rules'
import {
  TOKEN_CHIP_RADIUS,
  TOKEN_COLORS,
  TOKEN_PIP_RADIUS,
  TOKEN_PIP_SPREAD,
  TOKEN_PIP_SQUARE_HALF,
  pipPositions,
} from '~/utils/resource-token-pips'

const props = withDefaults(
  defineProps<{
    token: ResourceTokenDef
    scale?: number
    highContrast?: boolean
  }>(),
  { scale: 1, highContrast: false },
)

const faceUp = computed(() => props.token.faceUp !== false)
const isProduction = computed(() => props.token.type === 'production')
const colors = computed(() => TOKEN_COLORS[props.token.type])
const pips = computed(() => pipPositions(props.token.value))
const pipR = computed(() => (props.highContrast ? TOKEN_PIP_RADIUS + 0.2 : TOKEN_PIP_RADIUS))
const pipSquare = computed(() =>
  props.highContrast ? TOKEN_PIP_SQUARE_HALF + 0.18 : TOKEN_PIP_SQUARE_HALF,
)
</script>

<template>
  <g
    class="resource-token"
    :class="{
      'high-contrast': highContrast,
      'resource-token--spent': !faceUp,
      'resource-token--production': isProduction,
    }"
    :transform="`scale(${scale})`"
  >
    <circle
      v-if="highContrast"
      :r="TOKEN_CHIP_RADIUS + 1.6"
      fill="none"
      stroke="#f8fafc"
      stroke-width="1.35"
      opacity="0.95"
    />
    <circle
      :r="TOKEN_CHIP_RADIUS + 0.7"
      :fill="TOKEN_COLORS.chip.rim"
    />
    <circle
      :r="TOKEN_CHIP_RADIUS"
      :fill="TOKEN_COLORS.chip.face"
      stroke="#0f172a"
      :stroke-width="highContrast ? 0.9 : 0.5"
    />
    <g v-for="(pip, idx) in pips" :key="idx">
      <template v-if="isProduction">
        <rect
          v-if="!highContrast"
          :x="pip.x * TOKEN_PIP_SPREAD - pipSquare - 0.35"
          :y="pip.y * TOKEN_PIP_SPREAD - pipSquare - 0.35"
          :width="(pipSquare + 0.35) * 2"
          :height="(pipSquare + 0.35) * 2"
          rx="0.35"
          fill="rgba(255,255,255,0.35)"
        />
        <rect
          :x="pip.x * TOKEN_PIP_SPREAD - pipSquare"
          :y="pip.y * TOKEN_PIP_SPREAD - pipSquare"
          :width="pipSquare * 2"
          :height="pipSquare * 2"
          rx="0.4"
          :fill="colors.pip"
          :stroke="highContrast ? '#0f172a' : colors.pipStroke"
          :stroke-width="highContrast ? 0.95 : 0.55"
        />
      </template>
      <template v-else>
        <circle
          v-if="!highContrast"
          :cx="pip.x * TOKEN_PIP_SPREAD"
          :cy="pip.y * TOKEN_PIP_SPREAD"
          :r="pipR + 0.35"
          fill="rgba(255,255,255,0.35)"
        />
        <circle
          :cx="pip.x * TOKEN_PIP_SPREAD"
          :cy="pip.y * TOKEN_PIP_SPREAD"
          :r="pipR"
          :fill="colors.pip"
          :stroke="highContrast ? '#0f172a' : colors.pipStroke"
          :stroke-width="highContrast ? 0.95 : 0.55"
        />
        <circle
          v-if="!highContrast"
          :cx="pip.x * TOKEN_PIP_SPREAD - 0.55"
          :cy="pip.y * TOKEN_PIP_SPREAD - 0.55"
          :r="TOKEN_PIP_RADIUS * 0.35"
          :fill="colors.pipHighlight"
          opacity="0.85"
        />
      </template>
    </g>
  </g>
</template>

<style scoped>
.resource-token--spent {
  opacity: 0.42;
}
</style>
