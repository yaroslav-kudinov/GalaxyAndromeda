<script setup lang="ts">
import { useUiStrings } from '~/i18n/ui-strings'

/**
 * Сколько маркеров действия у вас осталось — формой, а не числом.
 *
 * Строка «3/5 · осталось 3» требует прочитать её и сопоставить два числа. Три
 * закрашенных треугольника из пяти считываются до чтения. Треугольник взят тот
 * же, что рисуется на клетке (`ActionMarkerGlyph`): игрок узнаёт знакомую
 * фигуру, а не запоминает новое обозначение.
 *
 * Показывается только тогда, когда счётчик участвует в решении: при расстановке
 * и при исполнении. В остальное время маркеры видно на самой карте.
 */
const props = withDefaults(
  defineProps<{
    /** Сколько маркеров уже поставлено */
    placed: number
    /** Сколько всего можно поставить в этом ходу */
    limit: number
    /**
     * `planning` — закрашенные показывают поставленные, пустые — свободное место.
     * `actions` — закрашенные показывают ещё не исполненные маркеры.
     */
    mode?: 'planning' | 'actions'
  }>(),
  { mode: 'planning' },
)

const t = useUiStrings().belt

const slots = computed(() => {
  const limit = Math.max(props.limit, props.placed)
  return Array.from({ length: limit }, (_, index) => index < props.placed)
})

const label = computed(() =>
  props.mode === 'actions'
    ? t.markersActions(props.placed)
    : t.markersPlanning(props.placed, props.limit),
)
</script>

<template>
  <span
    v-if="slots.length"
    class="marker-gauge"
    :class="`marker-gauge--${mode}`"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <svg
      v-for="(filled, index) in slots"
      :key="index"
      class="marker-gauge-pip"
      :class="{ 'marker-gauge-pip--filled': filled }"
      viewBox="-8 -9 16 16"
      aria-hidden="true"
    >
      <path d="M0,-7 L5,5 L-5,5 Z" />
      <circle v-if="filled" cx="0" cy="1" r="2" class="marker-gauge-core" />
    </svg>
  </span>
</template>

<style scoped>
.marker-gauge {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.marker-gauge-pip {
  width: 0.95rem;
  height: 0.95rem;
  overflow: visible;
}

/* Свободное место: контур без заливки — отличается формой, а не только цветом. */
.marker-gauge-pip path {
  fill: none;
  stroke: var(--g-border-strong);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.marker-gauge-pip--filled path {
  fill: var(--g-accent);
  stroke: var(--g-accent-strong);
  stroke-width: 0.8;
}

.marker-gauge-core {
  fill: #dbeafe;
  stroke: var(--g-accent-strong);
  stroke-width: 0.5;
}

/* В фазе действий невыполненные маркеры — то, что требует внимания. */
.marker-gauge--actions .marker-gauge-pip--filled path {
  fill: var(--g-warn);
  stroke: #92400e;
}

.marker-gauge--actions .marker-gauge-core {
  fill: #fef3c7;
  stroke: #92400e;
}
</style>
