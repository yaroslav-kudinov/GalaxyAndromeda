<script setup lang="ts">
import type { Phase, PlayerState } from '@galaxy/rules'

const props = defineProps<{
  phase?: Phase
  turnNumber?: number
  activePlayerId?: string | null
  players?: PlayerState[]
}>()

const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Производство',
}

const phaseLabel = computed(() => PHASE_LABELS[props.phase ?? 'planning'])

const activePlayer = computed(() => {
  if (!props.activePlayerId || !props.players?.length) return null
  return props.players.find((p) => p.id === props.activePlayerId) ?? null
})

const activePlayerName = computed(() => activePlayer.value?.name ?? props.activePlayerId ?? '—')

const activePlayerStyle = computed(() => {
  const color = activePlayer.value?.color ?? '#3B82F6'
  return { '--player-color': color }
})
</script>

<template>
  <div class="phase-panel">
    <span class="phase-badge">{{ phaseLabel }}</span>
    <span v-if="turnNumber != null" class="meta">Ход {{ turnNumber }}</span>
    <span
      v-if="activePlayerId != null"
      class="active-player-badge"
      :style="activePlayerStyle"
    >
      <span class="active-player-dot" aria-hidden="true" />
      Активный: {{ activePlayerName }}
    </span>
  </div>
</template>

<style scoped>
.phase-panel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
}
.phase-badge {
  padding: 0.35rem 0.65rem;
  background: rgba(51, 65, 85, 0.85);
  border: 1px solid rgba(100, 116, 139, 0.6);
  border-radius: 6px;
  font-weight: 600;
  color: #f8fafc;
}
.meta {
  color: #cbd5e1;
}
.active-player-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  font-weight: 700;
  color: #fff;
  border: 2px solid color-mix(in srgb, var(--player-color, #3b82f6) 55%, #fff);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--player-color, #3b82f6) 82%, #fff),
    var(--player-color, #3b82f6)
  );
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  animation: active-player-pulse 1.55s ease-in-out infinite;
  box-shadow:
    0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 40%, transparent),
    0 2px 8px rgba(0, 0, 0, 0.25);
}
.active-player-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.85);
  animation: active-player-dot 1.55s ease-in-out infinite;
}
@keyframes active-player-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 35%, transparent),
      0 2px 8px rgba(0, 0, 0, 0.25);
  }
  50% {
    box-shadow:
      0 0 0 5px color-mix(in srgb, var(--player-color, #3b82f6) 0%, transparent),
      0 2px 12px color-mix(in srgb, var(--player-color, #3b82f6) 35%, transparent);
  }
}
@keyframes active-player-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.85;
  }
}
</style>
