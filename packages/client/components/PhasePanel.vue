<script setup lang="ts">
defineProps<{ phase?: string }>()
</script>

<template>
  <div class="phase-panel">
    <span>Фаза: {{ phase ?? 'planning' }}</span>
  </div>
</template>

<style scoped>
.phase-panel {
  padding: 0.5rem 1rem;
  background: #334155;
  border-radius: 6px;
  display: inline-block;
}
</style>
