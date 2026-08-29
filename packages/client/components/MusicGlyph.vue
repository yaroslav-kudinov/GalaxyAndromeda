<script setup lang="ts">
defineProps<{
  name:
    | 'mute'
    | 'unmute'
    | 'vol-down'
    | 'vol-up'
    | 'play'
    | 'pause'
    | 'shuffle'
    | 'repeat'
    | 'repeat-one'
    | 'exclude'
    | 'restore'
    | 'music'
    | 'volume'
}>()
</script>

<template>
  <svg class="music-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <g v-if="name === 'play'">
      <path fill="currentColor" d="M4 2.4v11.2L13.4 8z" />
    </g>
    <g v-else-if="name === 'pause'">
      <rect x="3.2" y="2.4" width="3.1" height="11.2" rx="0.5" fill="currentColor" />
      <rect x="9.7" y="2.4" width="3.1" height="11.2" rx="0.5" fill="currentColor" />
    </g>
    <g v-else-if="name === 'music'">
      <path
        fill="currentColor"
        d="M12.8 2.2v7.15a2.35 2.35 0 1 1-1.5-2.2V5.1L6.7 6.35v5.2a2.35 2.35 0 1 1-1.5-2.2V4.05z"
      />
    </g>
    <g v-else-if="name === 'shuffle'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M2.2 4.4h3.1L11.8 11.6h2M11.8 4.4h2M2.2 11.6h3.1L7.2 9.4"
      />
      <path
        fill="currentColor"
        d="M12.35 3.05 15 4.4l-2.65 1.35V3.05zm0 7.2L15 11.6l-2.65 1.35V10.25z"
      />
    </g>
    <g v-else-if="name === 'repeat' || name === 'repeat-one'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M4.4 4.2h6.4a2.4 2.4 0 0 1 2.4 2.4v1.1M11.6 11.8H5.2A2.4 2.4 0 0 1 2.8 9.4V8.3"
      />
      <path fill="currentColor" d="M9.7 2.35 12.8 4.2 9.7 6.05V2.35zm-3.4 11.3L3.2 11.8l3.1-1.85v3.7z" />
      <text
        v-if="name === 'repeat-one'"
        x="8"
        y="9.35"
        fill="currentColor"
        font-size="5.4"
        font-weight="700"
        text-anchor="middle"
        font-family="system-ui, sans-serif"
      >1</text>
    </g>
    <g v-else-if="name === 'exclude'">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M5.4 8h5.2" />
    </g>
    <g v-else-if="name === 'restore'">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 5.4v5.2M5.4 8h5.2" />
    </g>
    <g v-else>
      <path fill="currentColor" d="M2.1 6.05h2.45L8.1 3.4v9.2L4.55 9.95H2.1z" />
      <g v-if="name === 'mute'">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          d="M10.3 5.4 14.1 10.6M14.1 5.4 10.3 10.6"
        />
      </g>
      <g v-else-if="name === 'vol-down'">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          d="M10.2 6.35a2.4 2.4 0 0 1 0 3.3"
        />
      </g>
      <g v-else>
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          d="M10.15 5.55a3.35 3.35 0 0 1 0 4.9M12.35 4.15a5.4 5.4 0 0 1 0 7.7"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.music-glyph {
  width: 1rem;
  height: 1rem;
  display: block;
  flex-shrink: 0;
}
</style>
