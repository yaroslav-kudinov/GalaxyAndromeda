<script setup lang="ts">
const props = defineProps<{
  title: string
  body: string
  manual?: boolean
}>()

const emit = defineEmits<{ next: [] }>()
</script>

<template>
  <aside class="coach-panel" aria-live="polite">
    <p class="coach-badge">Обучение</p>
    <h2 class="coach-title">{{ title }}</h2>
    <p class="coach-body">{{ body }}</p>
    <button v-if="manual" type="button" class="coach-next" @click="emit('next')">
      Далее
    </button>
  </aside>
</template>

<style scoped>
.coach-panel {
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid #475569;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  max-width: 22rem;
  margin-bottom: 0.5rem;
}
.coach-badge {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin: 0 0 0.35rem;
}
.coach-title {
  font-size: 1rem;
  margin: 0 0 0.35rem;
  color: #f8fafc;
}
.coach-body {
  font-size: 0.9rem;
  line-height: 1.45;
  color: #cbd5e1;
  margin: 0;
}
.coach-next {
  margin-top: 0.65rem;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #f1f5f9;
  cursor: pointer;
}
</style>
