<script setup lang="ts">
import type { Phase, PlayerState } from '@galaxy/rules'
import { PHASE_LABELS, phaseAccentClass } from '~/utils/game-help'

const props = defineProps<{
  phase?: Phase
  turnNumber?: number
  activePlayerId?: string | null
  players?: PlayerState[]
  /** Локальный игрок — подсветка «ваш ход» */
  isMyTurn?: boolean
  /** Короткая подсказка для hero-варианта */
  prompt?: string
  /** Счётчик маркеров / ёмкость — крупнее основной подсказки */
  countHint?: string
  /** Доп. CSS-класс для акцента подсказки */
  guidanceAccent?: string
  variant?: 'inline' | 'hero'
}>()

const phaseLabel = computed(() => PHASE_LABELS[props.phase ?? 'planning'])
const accentClass = computed(() => phaseAccentClass(props.phase))

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
  <div class="phase-panel" :class="[accentClass, variant === 'hero' ? 'phase-panel--hero' : 'phase-panel--inline']">
    <div class="phase-primary">
      <span class="phase-badge">{{ phaseLabel }}</span>
      <span v-if="turnNumber != null" class="meta turn-meta">
        Ход {{ turnNumber }}
      </span>
    </div>

    <div v-if="variant === 'hero' && (countHint || prompt)" class="phase-guidance" :class="guidanceAccent">
      <p v-if="countHint" class="phase-count">{{ countHint }}</p>
      <p v-if="prompt" class="phase-prompt">{{ prompt }}</p>
    </div>

    <span
      v-if="activePlayerId != null"
      class="active-player-badge"
      :class="{ 'active-player-badge--you': isMyTurn }"
      :style="activePlayerStyle"
    >
      <span class="active-player-dot" aria-hidden="true" />
      <template v-if="isMyTurn">Ваш ход</template>
      <template v-else>Активный: {{ activePlayerName }}</template>
    </span>
  </div>
</template>

<style scoped>
.phase-panel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.phase-panel--inline {
  font-size: 0.85rem;
}

.phase-panel--hero {
  flex: 1;
  min-width: 0;
  gap: 0.5rem 1rem;
  font-size: 0.92rem;
}

.phase-primary {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.phase-badge {
  padding: 0.35rem 0.75rem;
  border-radius: 8px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #f8fafc;
  border: 2px solid transparent;
}

.phase-panel--hero .phase-badge {
  padding: 0.45rem 0.9rem;
  font-size: 1rem;
}

.phase--events .phase-badge {
  background: rgba(88, 28, 135, 0.85);
  border-color: rgba(192, 132, 252, 0.55);
}
.phase--planning .phase-badge {
  background: rgba(12, 74, 110, 0.9);
  border-color: rgba(56, 189, 248, 0.55);
}
.phase--actions .phase-badge {
  background: rgba(120, 53, 15, 0.9);
  border-color: rgba(251, 191, 36, 0.55);
}
.phase--production .phase-badge {
  background: rgba(131, 24, 67, 0.9);
  border-color: rgba(244, 114, 182, 0.55);
}

.meta {
  color: #cbd5e1;
}

.phase-panel--hero .turn-meta {
  font-size: 0.95rem;
  font-weight: 600;
  color: #e2e8f0;
}

.phase-guidance {
  flex: 1 1 12rem;
  min-width: 0;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.55);
}

.phase-guidance.planning-action {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(12, 74, 110, 0.45);
}
.phase-guidance.planning-production {
  border-color: rgba(244, 114, 182, 0.5);
  background: rgba(131, 24, 67, 0.4);
}
.phase-guidance.actions {
  border-color: rgba(251, 191, 36, 0.5);
  background: rgba(120, 53, 15, 0.45);
}
.phase-guidance.production {
  border-color: rgba(244, 114, 182, 0.5);
  background: rgba(131, 24, 67, 0.4);
}
.phase-guidance.events {
  border-color: rgba(192, 132, 252, 0.45);
  background: rgba(88, 28, 135, 0.4);
}

.phase-count {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.3;
  color: #f8fafc;
}

.phase-prompt {
  margin: 0.15rem 0 0;
  min-width: 0;
  font-size: 0.84rem;
  line-height: 1.35;
  color: #cbd5e1;
}

.phase-count + .phase-prompt {
  margin-top: 0.2rem;
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
  box-shadow:
    0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 40%, transparent),
    0 2px 8px rgba(0, 0, 0, 0.25);
}

.phase-panel--hero .active-player-badge {
  padding: 0.4rem 0.85rem;
  font-size: 0.9rem;
}

.active-player-badge--you {
  animation: active-player-pulse 1.25s ease-in-out infinite;
}

.active-player-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.85);
}

.active-player-badge--you .active-player-dot {
  animation: active-player-dot 1.25s ease-in-out infinite;
}

@keyframes active-player-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 0 color-mix(in srgb, var(--player-color, #3b82f6) 45%, transparent),
      0 2px 8px rgba(0, 0, 0, 0.25);
    filter: brightness(1);
  }
  50% {
    box-shadow:
      0 0 0 8px color-mix(in srgb, var(--player-color, #3b82f6) 0%, transparent),
      0 0 18px 4px color-mix(in srgb, var(--player-color, #3b82f6) 55%, transparent),
      0 2px 12px rgba(0, 0, 0, 0.3);
    filter: brightness(1.12);
  }
}

@keyframes active-player-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.9;
  }
}
</style>
