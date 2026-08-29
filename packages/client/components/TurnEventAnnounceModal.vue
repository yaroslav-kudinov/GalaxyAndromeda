<script setup lang="ts">
import type { ActiveEventObservation } from '@galaxy/rules'

defineProps<{
  event: ActiveEventObservation
  turnNumber: number
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div
    class="event-announce-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <div
      class="event-announce"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-announce-title"
    >
      <p class="event-announce-kicker">Новый ход {{ turnNumber }}</p>
      <h2 id="event-announce-title" class="event-announce-title">
        {{ event.name }}
      </h2>
      <p class="event-announce-desc">{{ event.description }}</p>
      <p class="event-announce-effect">{{ event.effectSummary }}</p>
      <p class="event-announce-hint">
        Карта уже применена автоматически. Это объявление, не подтверждение.
      </p>
      <button type="button" class="event-announce-ok" @click="emit('close')">
        Понятно
      </button>
    </div>
  </div>
</template>

<style scoped>
.event-announce-backdrop {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
}

.event-announce {
  width: min(28rem, calc(100vw - 2rem));
  padding: 1.15rem 1.2rem 1rem;
  border-radius: 14px;
  border: 2px solid rgba(192, 132, 252, 0.55);
  background: linear-gradient(145deg, rgba(88, 28, 135, 0.96), rgba(15, 23, 42, 0.98));
  color: #f8fafc;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  font-family: Manrope, system-ui, sans-serif;
}

.event-announce-kicker {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #e9d5ff;
}

.event-announce-title {
  margin: 0.4rem 0 0.55rem;
  font-size: 1.25rem;
  line-height: 1.25;
}

.event-announce-desc {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: #e2e8f0;
}

.event-announce-effect {
  margin: 0.65rem 0 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #fbbf24;
}

.event-announce-hint {
  margin: 0.7rem 0 0;
  font-size: 0.78rem;
  color: #94a3b8;
}

.event-announce-ok {
  display: block;
  margin: 1rem 0 0 auto;
  padding: 0.4rem 1rem;
  border: 0;
  border-radius: 8px;
  background: #7c3aed;
  color: #f8fafc;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
}

.event-announce-ok:hover {
  background: #6d28d9;
}
</style>
