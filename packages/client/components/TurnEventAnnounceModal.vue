<script setup lang="ts">
import { useUiStrings } from '~/i18n/ui-strings'
const props = defineProps<{
  turnNumber: number
  rechargeBanner?: string | null
  /** Захват в начале хода: лимит и сколько клеток можно занять. */
  claimLine?: string | null
  /** Что произошло в начале хода: тик осад, захваты, выбывания, доктрины. */
  events?: readonly string[]
  /** Что делать дальше: решения, маркеры или ждать своей очереди. */
  nextStep?: string | null
  /** «Действует сейчас» — неочевидные условия игрока. */
  notes?: readonly { tone: string; text: string }[]
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  panelRef,
  panelStyle,
  isDragging,
  onDragHandlePointerDown,
  consumeDragClick,
} = useDraggablePanel()

/** Клик по фону закрывает окно, но не после перетаскивания за шапку */
function onBackdropClick() {
  if (consumeDragClick()) return
  emit('close')
}

const t = useUiStrings().turnAnnounce

const kicker = computed(() => (props.turnNumber <= 1 ? t.matchStart : t.newTurn))
</script>

<template>
  <div
    class="event-announce-backdrop"
    role="presentation"
    @click.self="onBackdropClick"
  >
    <div
      ref="panelRef"
      class="event-announce drag-handle"
      :class="{ 'is-dragging': isDragging }"
      :style="panelStyle"
      role="dialog"
      @pointerdown="onDragHandlePointerDown"
      aria-modal="true"
      aria-labelledby="event-announce-title"
    >
      <p class="event-announce-kicker">{{ kicker }}</p>
      <h2 id="event-announce-title" class="event-announce-title">{{ t.turnTitle(turnNumber) }}</h2>
      <ul v-if="events?.length" class="event-announce-events">
        <li v-for="(line, index) in events" :key="index">{{ line }}</li>
      </ul>
      <ResourceRechargeBanner
        v-if="rechargeBanner"
        id="event-announce-recharge"
        :text="rechargeBanner"
        variant="modal"
      />
      <p v-if="claimLine" class="event-announce-desc">{{ claimLine }}</p>
      <template v-if="notes?.length">
        <p class="event-announce-subhead">{{ t.nowActive }}</p>
        <ul class="event-announce-events">
          <li v-for="(note, index) in notes.slice(0, 5)" :key="index">{{ note.text }}</li>
        </ul>
      </template>
      <p v-if="nextStep" class="event-announce-effect">{{ nextStep }}</p>
      <p v-if="turnNumber <= 1" class="event-announce-hint">{{ t.rechargeHint }}</p>
      <button type="button" class="event-announce-ok" @click="emit('close')">
        {{ t.ok }}
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

.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.drag-handle.is-dragging {
  cursor: grabbing;
}
.event-announce {
  width: min(28rem, calc(100vw - 2rem));
  /* Объявление хода бывает длинным: на низком экране оно прокручивается, а не обрезается. */
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
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

.event-announce-events {
  margin: 0 0 0.6rem;
  padding-left: 1.1rem;
  font-size: 0.86rem;
  line-height: 1.4;
  color: #e2e8f0;
}
.event-announce-events li + li {
  margin-top: 0.2rem;
}

.event-announce-subhead {
  margin: 0.6rem 0 0.25rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #e9d5ff;
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
