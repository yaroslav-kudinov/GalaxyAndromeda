<script setup lang="ts">
import type { ActiveEventObservation, Phase } from '@galaxy/rules'

const props = defineProps<{
  event: ActiveEventObservation
  phase?: Phase
  turnNumber?: number
  resolvedAt?: string
}>()

const statusLabel = computed(() => {
  if (!props.event.resolved) return 'Ожидает применения'
  if (props.phase && props.phase !== 'events') return 'Действует до конца хода'
  return 'Применено'
})

const hintText = computed(() => {
  if (!props.event.resolved) {
    return 'Нажмите «Применить», чтобы активировать эффект и перейти к планированию.'
  }
  if (props.phase && props.phase !== 'events') {
    return `Эффект активен на ходу ${props.turnNumber ?? '—'}.`
  }
  return 'Событие применено — можно переходить к следующей фазе.'
})

const appliedWhen = computed(() => {
  if (!props.resolvedAt) return ''
  const date = new Date(props.resolvedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
})
</script>

<template>
  <section
    class="event-card"
    :class="{
      'event-card--resolved': event.resolved,
      'event-card--active': event.resolved && phase && phase !== 'events',
    }"
  >
    <div class="event-card-head">
      <p class="event-card-label">
        Событие хода<span v-if="turnNumber != null"> · ход {{ turnNumber }}</span>
      </p>
      <span
        class="event-card-status"
        :class="{
          'event-card-status--pending': !event.resolved,
          'event-card-status--done': event.resolved,
        }"
      >
        {{ statusLabel }}
      </span>
    </div>
    <h3 class="event-card-title">{{ event.name }}</h3>
    <p class="event-card-desc">{{ event.description }}</p>
    <p class="event-card-effect">{{ event.effectSummary }}</p>
    <p v-if="event.resolved && appliedWhen" class="event-card-applied-at">
      Применено: {{ appliedWhen }}
    </p>
    <p
      class="event-card-hint"
      :class="{ 'event-card-hint--done': event.resolved }"
    >
      {{ hintText }}
    </p>
  </section>
</template>

<style scoped>
.event-card {
  padding: 0.85rem 1rem;
  border-radius: 10px;
  border: 2px solid rgba(192, 132, 252, 0.55);
  background: linear-gradient(145deg, rgba(88, 28, 135, 0.92), rgba(49, 16, 80, 0.95));
  color: #f8fafc;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.event-card--resolved {
  border-color: rgba(134, 239, 172, 0.45);
  background: linear-gradient(145deg, rgba(22, 78, 56, 0.85), rgba(49, 16, 80, 0.9));
}

.event-card--active {
  border-color: rgba(96, 165, 250, 0.5);
  background: linear-gradient(145deg, rgba(30, 58, 95, 0.9), rgba(49, 16, 80, 0.92));
}

.event-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.event-card-status {
  flex-shrink: 0;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.event-card-status--pending {
  background: rgba(251, 191, 36, 0.2);
  color: #fcd34d;
}

.event-card-status--done {
  background: rgba(134, 239, 172, 0.18);
  color: #86efac;
}

.event-card-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #e9d5ff;
}

.event-card-title {
  margin: 0.35rem 0 0.5rem;
  font-size: 1.15rem;
  line-height: 1.25;
}

.event-card-desc {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.4;
  color: #e2e8f0;
}

.event-card-effect {
  margin: 0.55rem 0 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fbbf24;
}

.event-card-applied-at {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.event-card-hint {
  margin: 0.65rem 0 0;
  font-size: 0.8rem;
  color: #cbd5e1;
}

.event-card-hint--done {
  color: #86efac;
}
</style>
