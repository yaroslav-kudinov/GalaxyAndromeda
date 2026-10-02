<script setup lang="ts">
import type { Phase, TurnQueueEntry } from '@galaxy/rules'
import { PHASE_LABELS } from '~/utils/game-help'
import { useUiStrings } from '~/i18n/ui-strings'

/**
 * Пояс состояния — единственная постоянно видимая часть интерфейса партии.
 *
 * Заменяет прежнюю шапку, где одновременно висели название комнаты, состояние
 * сервера, семь служебных кнопок, плашка фазы, номер хода, «Ваш ход» и полоса
 * очерёдности, а та же очерёдность дублировалась в боковой панели.
 *
 * В поясе остаётся только то, без чего нельзя принять текущее решение:
 * какая фаза, чья очередь и что от вас ждут. Всё остальное вызывается.
 *
 * Фаза обозначается тем же треугольником, которым маркер действия нарисован на
 * клетке: в планировании он пустой с пунктиром — его предстоит поставить, в
 * действиях закрашен и со стрелкой — его предстоит исполнить. Игрок связывает
 * фазу с тем, что делает руками, а не запоминает два слова.
 */
export type BeltStatusTone = 'idle' | 'info' | 'warn' | 'error'

const props = withDefaults(
  defineProps<{
    phase?: Phase
    turnNumber?: number
    /** Очередь текущего круга, уже в порядке хода */
    entries?: TurnQueueEntry[]
    myPlayerId?: string | null
    /** Что от вас ждут прямо сейчас — одна строка, уже выбранная по приоритету */
    statusText?: string | null
    statusTone?: BeltStatusTone
    /** Счётчик маркеров: показывается только когда участвует в решении */
    markers?: { placed: number; limit: number; mode: 'planning' | 'actions' } | null
    /** Узкий экран — пояс перестраивается в две строки */
    compact?: boolean
    /** Служебное меню раскрыто */
    toolsOpen?: boolean
  }>(),
  {
    entries: () => [],
    myPlayerId: null,
    statusText: null,
    statusTone: 'idle',
    markers: null,
    compact: false,
    toolsOpen: false,
  },
)

defineEmits<{ (event: 'toggle-tools'): void }>()

const t = useUiStrings().belt

const phaseLabel = computed(() => PHASE_LABELS[props.phase ?? 'planning'])
const isActions = computed(() => props.phase === 'actions' || props.phase === 'production')
</script>

<template>
  <div class="belt" :class="[`belt--${isActions ? 'actions' : 'planning'}`, { 'belt--compact': compact }]">
    <div class="belt-row">
      <slot name="back" />

      <span class="belt-phase" :title="t.phaseTitle(phaseLabel, turnNumber == null ? '—' : String(turnNumber))">
        <svg class="belt-phase-glyph" viewBox="-9 -10 18 18" aria-hidden="true">
          <path d="M0,-7 L5,5 L-5,5 Z" class="belt-phase-marker" />
          <circle v-if="isActions" cx="0" cy="1" r="2" class="belt-phase-core" />
          <path v-if="isActions" d="M6,-4 L9,-1 L6,2" class="belt-phase-arrow" />
        </svg>
        <span class="belt-phase-name">{{ phaseLabel }}</span>
        <span v-if="turnNumber != null" class="belt-turn">{{ turnNumber }}</span>
      </span>

      <TurnOrderPanel
        v-if="entries.length"
        variant="dots"
        :entries="entries"
        :my-player-id="myPlayerId"
      />

      <p v-if="statusText && !compact" class="belt-status" :class="`belt-status--${statusTone}`">
        {{ statusText }}
      </p>

      <MarkerBudgetGauge
        v-if="markers"
        class="belt-markers"
        :placed="markers.placed"
        :limit="markers.limit"
        :mode="markers.mode"
      />

      <button
        type="button"
        class="belt-tools-toggle"
        :aria-expanded="toolsOpen"
        aria-controls="game-belt-tools"
        :title="toolsOpen ? t.toolsClose : t.toolsOpen"
        :aria-label="t.toolsLabel"
        @click="$emit('toggle-tools')"
      >
        <span class="belt-tools-dots" aria-hidden="true" />
      </button>
    </div>

    <p v-if="statusText && compact" class="belt-status belt-status--row" :class="`belt-status--${statusTone}`">
      {{ statusText }}
    </p>

    <div v-show="toolsOpen" id="game-belt-tools" class="belt-tools">
      <slot name="tools" />
    </div>
  </div>
</template>

<style scoped>
.belt {
  position: relative;
  z-index: var(--g-z-belt);
  display: flex;
  flex-direction: column;
  padding: 0.3rem var(--g-s-3);
  border-bottom: 1px solid var(--g-border);
  background: var(--g-surface-glass);
  backdrop-filter: blur(8px);
  font-size: var(--g-text-sm);
  pointer-events: auto;
}

/* Цвет фазы живёт на поясе целиком: он же задаёт рамку экрана. */
.belt--planning {
  border-bottom-color: color-mix(in srgb, var(--g-accent) 55%, transparent);
}
.belt--actions {
  border-bottom-color: color-mix(in srgb, var(--g-warn) 55%, transparent);
}

.belt-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-width: 0;
}

.belt-phase {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  padding: 0.18rem var(--g-s-2) 0.18rem 0.25rem;
  border-radius: var(--g-r-pill);
  border: 1px solid transparent;
  font-weight: 650;
  color: var(--g-text-strong);
}

.belt--planning .belt-phase {
  border-color: color-mix(in srgb, var(--g-accent) 50%, transparent);
  background: var(--g-accent-soft);
}
.belt--actions .belt-phase {
  border-color: color-mix(in srgb, var(--g-warn) 50%, transparent);
  background: var(--g-warn-soft);
}

.belt-phase-glyph {
  width: 1.1rem;
  height: 1.1rem;
  flex-shrink: 0;
  overflow: visible;
}

/* Планирование: контур с пунктиром — маркер ещё только предстоит поставить */
.belt--planning .belt-phase-marker {
  fill: none;
  stroke: var(--g-accent);
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-dasharray: 2.5 2;
}

/* Действия: маркер закрашен и уходит стрелкой — его предстоит исполнить */
.belt--actions .belt-phase-marker {
  fill: var(--g-warn);
  stroke: #92400e;
  stroke-width: 0.8;
  stroke-linejoin: round;
}

.belt-phase-core {
  fill: #fef3c7;
  stroke: #92400e;
  stroke-width: 0.5;
}

.belt-phase-arrow {
  fill: none;
  stroke: var(--g-warn);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.belt-turn {
  display: grid;
  place-items: center;
  min-width: 1.15rem;
  height: 1.15rem;
  padding: 0 0.2rem;
  border-radius: var(--g-r-pill);
  background: var(--g-surface-2);
  font-size: var(--g-text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--g-text);
}

.belt-status {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--g-text-dim);
}

.belt-status--info {
  color: var(--g-text);
}
.belt-status--warn {
  color: var(--g-warn);
}
.belt-status--error {
  color: var(--g-danger);
  font-weight: 600;
}

/* Вторая строка на телефоне. Больше двух строк пояс не отдаёт: он должен
   оставаться поясом, а не вырастать в карточку поверх карты. */
.belt-status--row {
  flex: none;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  padding: 0.15rem 0 0.1rem;
  white-space: normal;
  line-height: 1.3;
  font-size: var(--g-text-xs);
}

.belt-markers {
  margin-left: auto;
}

.belt-status + .belt-markers {
  margin-left: 0;
}

.belt-tools-toggle {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  margin-left: auto;
  padding: 0;
  border: 1px solid var(--g-border-strong);
  border-radius: var(--g-r-pill);
  background: var(--g-surface-1);
  color: var(--g-text);
  cursor: pointer;
}

.belt-markers + .belt-tools-toggle,
.belt-status + .belt-tools-toggle {
  margin-left: var(--g-s-2);
}

.belt-tools-toggle:hover {
  border-color: var(--g-accent);
}

.belt-tools-dots {
  width: 0.95rem;
  height: 0.2rem;
  background:
    radial-gradient(circle, currentColor 45%, transparent 50%) left center / 0.2rem 0.2rem no-repeat,
    radial-gradient(circle, currentColor 45%, transparent 50%) center / 0.2rem 0.2rem no-repeat,
    radial-gradient(circle, currentColor 45%, transparent 50%) right center / 0.2rem 0.2rem no-repeat;
}

.belt-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
  align-items: center;
  padding: var(--g-s-2) 0 var(--g-s-1);
  margin-top: var(--g-s-2);
  border-top: 1px solid var(--g-border);
}

.belt--compact .belt-row {
  gap: var(--g-s-2);
}
</style>
