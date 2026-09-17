<script setup lang="ts">
import { useUiStrings } from '~/i18n/ui-strings'

const t = useUiStrings().turnEvents
import type { ActiveEventObservation, Phase, TurnEventHistoryEntry } from '@galaxy/rules'

const props = defineProps<{
  activeEvent: ActiveEventObservation | null
  history: TurnEventHistoryEntry[]
  currentTurn: number
  phase?: Phase
  resolvedAt?: string
  rechargeBanner?: string | null
}>()

const pastHistory = computed(() =>
  props.history.filter((entry) => entry.turn !== props.currentTurn),
)

const showPanel = computed(
  () =>
    !!props.rechargeBanner
    || !!props.activeEvent
    || pastHistory.value.length > 0
    || props.history.length > 0,
)

function formatTimestamp(ts?: number, iso?: string): string {
  const date = ts != null ? new Date(ts) : iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function historyAppliedLabel(entry: TurnEventHistoryEntry): string {
  if (entry.applied) {
    const when = formatTimestamp(entry.appliedAt)
    return when ? t.appliedAt(when) : t.applied
  }
  return t.notApplied
}
</script>

<template>
  <section v-if="showPanel" class="turn-events">
    <h3 class="turn-events-heading">{{ t.heading }}</h3>

    <ResourceRechargeBanner
      v-if="rechargeBanner"
      class="turn-events-recharge"
      :text="rechargeBanner"
      variant="panel"
    />

    <EventCardPanel
      v-if="activeEvent"
      :event="activeEvent"
      :phase="phase"
      :turn-number="currentTurn"
      :resolved-at="resolvedAt"
    />

    <details v-if="pastHistory.length" class="turn-events-history" open>
      <summary class="turn-events-history-summary">
        {{ t.pastTurns(pastHistory.length) }}
      </summary>
      <ul class="turn-events-list">
        <li v-for="entry in pastHistory" :key="entry.turn" class="turn-events-item">
          <span class="turn-events-item-turn">{{ t.turn(entry.turn) }}</span>
          <span class="turn-events-item-name">{{ entry.name }}</span>
          <span class="turn-events-item-effect">{{ entry.effectSummary }}</span>
          <span
            class="turn-events-item-status"
            :class="{ 'turn-events-item-status--applied': entry.applied }"
          >
            {{ historyAppliedLabel(entry) }}
          </span>
        </li>
      </ul>
    </details>

    <p v-else-if="!activeEvent && history.length" class="turn-events-empty">
      {{ t.empty }}
    </p>
  </section>
</template>

<style scoped>
.turn-events {
  margin-bottom: 0;
}

/* Один уровень раздела в боковой панели — одно оформление заголовка */
.turn-events-heading {
  margin: 0 0 var(--g-s-2);
  font-size: var(--g-text-xs);
  font-weight: 700;
  color: var(--g-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.turn-events-recharge {
  margin-bottom: 0.65rem;
}

.turn-events-history {
  margin-top: 0.65rem;
}

.turn-events-history-summary {
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  color: #cbd5e1;
  user-select: none;
}

.turn-events-list {
  margin: 0.45rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.turn-events-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.5rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(100, 116, 139, 0.35);
  font-size: 0.78rem;
  line-height: 1.35;
}

.turn-events-item-turn {
  grid-column: 1;
  font-weight: 700;
  color: #e2e8f0;
  white-space: nowrap;
}

.turn-events-item-name {
  grid-column: 2;
  font-weight: 600;
  color: #f8fafc;
}

.turn-events-item-effect {
  grid-column: 1 / -1;
  color: #fbbf24;
}

.turn-events-item-status {
  grid-column: 1 / -1;
  color: #94a3b8;
}

.turn-events-item-status--applied {
  color: #86efac;
}

.turn-events-empty {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: #64748b;
}
</style>
