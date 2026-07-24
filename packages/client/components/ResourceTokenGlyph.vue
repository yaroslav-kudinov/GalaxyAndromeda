<script setup lang="ts">
import type { ResourceTokenDef } from '@galaxy/rules'
import {
  TOKEN_CHIP_RADIUS,
  TOKEN_COLORS,
  TOKEN_PIP_RADIUS,
  TOKEN_PIP_SPREAD,
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
const colors = computed(() => TOKEN_COLORS[props.token.type])
const pips = computed(() => pipPositions(props.token.value))
</script>

<template>
  <g
    class="resource-token"
    :class="{ 'high-contrast': highContrast, 'resource-token--spent': !faceUp }"
    :transform="`scale(${scale})`"
  >
    <circle
      v-if="highContrast"
      :r="TOKEN_CHIP_RADIUS + 1.4"
      fill="none"
      stroke="#f8fafc"
      stroke-width="0.9"
      opacity="0.85"
    />
    <circle
      :r="TOKEN_CHIP_RADIUS + 0.6"
      :fill="TOKEN_COLORS.chip.rim"
    />
    <circle
      :r="TOKEN_CHIP_RADIUS"
      :fill="TOKEN_COLORS.chip.face"
      stroke="rgba(0,0,0,0.12)"
      stroke-width="0.5"
    />
    <g v-for="(pip, idx) in pips" :key="idx">
      <circle
        :cx="pip.x * TOKEN_PIP_SPREAD"
        :cy="pip.y * TOKEN_PIP_SPREAD"
        :r="TOKEN_PIP_RADIUS + 0.35"
        fill="rgba(255,255,255,0.35)"
      />
      <circle
        :cx="pip.x * TOKEN_PIP_SPREAD"
        :cy="pip.y * TOKEN_PIP_SPREAD"
        :r="TOKEN_PIP_RADIUS"
        :fill="colors.pip"
        :stroke="colors.pipStroke"
        stroke-width="0.55"
      />
      <circle
        :cx="pip.x * TOKEN_PIP_SPREAD - 0.55"
        :cy="pip.y * TOKEN_PIP_SPREAD - 0.55"
        :r="TOKEN_PIP_RADIUS * 0.35"
        :fill="colors.pipHighlight"
        opacity="0.85"
      />
    </g>
  </g>
</template>

<style scoped>
.resource-token--spent {
  opacity: 0.42;
}
</style>
