<script setup lang="ts">
withDefaults(
  defineProps<{
    scale?: number
    highContrast?: boolean
  }>(),
  { scale: 1, highContrast: false },
)
</script>

<template>
  <g class="production-marker-glyph" :transform="`scale(${scale})`">
    <circle v-if="highContrast" r="7.5" fill="none" stroke="#f8fafc" stroke-width="1" opacity="0.9" />
    <rect
      x="-5"
      y="-5"
      width="10"
      height="10"
      transform="rotate(45)"
      fill="#f97316"
      stroke="#9a3412"
      stroke-width="0.8"
    />
  </g>
</template>
