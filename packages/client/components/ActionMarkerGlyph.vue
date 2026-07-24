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
  <g class="action-marker-glyph" :transform="`scale(${scale})`">
    <circle v-if="highContrast" r="7" fill="none" stroke="#f8fafc" stroke-width="1" opacity="0.9" />
    <path
      d="M0,-7 L5,5 L-5,5 Z"
      fill="#3b82f6"
      stroke="#1e3a8a"
      stroke-width="0.8"
      stroke-linejoin="round"
    />
    <circle cx="0" cy="1" r="2" fill="#dbeafe" stroke="#1e40af" stroke-width="0.5" />
  </g>
</template>
