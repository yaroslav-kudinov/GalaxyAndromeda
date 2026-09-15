<script setup lang="ts">
const props = defineProps<{
  title: string
  body: string
  objective?: string
  why?: string
  hint?: string
  manual?: boolean
  stepNumber?: number
  stepCount?: number
}>()

const emit = defineEmits<{ next: [] }>()
const { panelRef, panelStyle, isDragging, onDragHandlePointerDown } = useDraggablePanel()
</script>

<template>
  <aside
    ref="panelRef"
    class="coach-panel"
    :class="{ 'is-dragging': isDragging }"
    :style="panelStyle"
    aria-live="polite"
  >
    <header class="coach-head">
      <p class="coach-badge">
        Обучение
        <span v-if="stepNumber && stepCount">· {{ stepNumber }}/{{ stepCount }}</span>
        <!-- Панель пропускает клики к карте, поэтому тянем за отдельную ручку -->
        <span
          class="coach-grip drag-handle"
          role="button"
          tabindex="-1"
          title="Потяните, чтобы переставить подсказку"
          @pointerdown="onDragHandlePointerDown"
        >⠿</span>
      </p>
      <h2 class="coach-title">{{ title }}</h2>
    </header>
    <p class="coach-body">{{ body }}</p>
    <section v-if="objective" class="coach-objective">
      <strong>Сейчас</strong>
      <p>{{ objective }}</p>
    </section>
    <details v-if="why || hint" class="coach-more">
      <summary>Подробнее</summary>
      <p v-if="why"><strong>Зачем:</strong> {{ why }}</p>
      <p v-if="hint"><strong>Подсказка:</strong> {{ hint }}</p>
    </details>
    <button v-if="manual" type="button" class="coach-next" @click="emit('next')">
      {{ stepNumber === stepCount ? 'Завершить обучение' : 'Далее' }}
    </button>
  </aside>
</template>

<style scoped>
.coach-panel {
  width: min(22rem, calc(100vw - 1.5rem));
  padding: 0.7rem 0.8rem 0.75rem;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.45);
  backdrop-filter: blur(8px);
  /* Панель лежит поверх левого края карты (стартовые клетки обучения).
     Пропускаем клики к гексам; кнопки и «Подробнее» снова включают захват. */
  pointer-events: none;
}
.coach-panel .coach-next,
.coach-panel .coach-more {
  pointer-events: auto;
}
.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.is-dragging .drag-handle {
  cursor: grabbing;
}
.coach-grip {
  /* Сама панель прозрачна для кликов — ручке захват возвращаем */
  pointer-events: auto;
  margin-left: auto;
  padding: 0 0.15rem;
  color: #64748b;
  font-size: 0.85rem;
  line-height: 1;
}
.coach-grip:hover {
  color: #cbd5e1;
}
.coach-badge {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.coach-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.35rem;
}
.coach-badge {
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7dd3fc;
}
.coach-title {
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.25;
  color: #f8fafc;
}
.coach-body {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.4;
  color: #cbd5e1;
}
.coach-objective {
  margin-top: 0.55rem;
  padding: 0.45rem 0.55rem;
  border-radius: 7px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(14, 116, 144, 0.2);
}
.coach-objective strong {
  display: block;
  margin-bottom: 0.15rem;
  color: #e0f2fe;
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.coach-objective p,
.coach-more p {
  margin: 0;
  color: #e2e8f0;
  font-size: 0.82rem;
  line-height: 1.35;
}
.coach-more {
  margin-top: 0.45rem;
  color: #bae6fd;
  font-size: 0.78rem;
}
.coach-more summary {
  cursor: pointer;
  user-select: none;
}
.coach-more p + p {
  margin-top: 0.35rem;
}
.coach-more strong {
  color: #f8fafc;
}
.coach-next {
  display: block;
  width: 100%;
  margin-top: 0.65rem;
  padding: 0.45rem 0.75rem;
  border-radius: 7px;
  border: 1px solid rgba(56, 189, 248, 0.55);
  background: #0e7490;
  color: #f0f9ff;
  font-weight: 600;
  cursor: pointer;
}
.coach-next:hover {
  filter: brightness(1.08);
}
</style>
