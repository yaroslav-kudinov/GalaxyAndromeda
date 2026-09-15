<script setup lang="ts">
import type { RoomChatMessage } from '~/composables/useGameApi'
import { useUiStrings } from '~/i18n/ui-strings'

export type ChatPeer = { id: string; name: string }

const props = defineProps<{
  open: boolean
  messages: RoomChatMessage[]
  peers: ChatPeer[]
  selfPlayerId: string
  sending?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  send: [payload: { text: string; toPlayerId: string | null }]
}>()

const t = useUiStrings().chat
const { panelRef, panelStyle, isDragging, onDragHandlePointerDown } = useDraggablePanel()
const draft = ref('')
/** '' = общий канал */
const toPlayerId = ref('')
const listRef = ref<HTMLElement | null>(null)

const placeholder = computed(() =>
  toPlayerId.value ? t.placeholderDm : t.placeholderPublic,
)

function peerName(id: string): string {
  return props.peers.find((p) => p.id === id)?.name ?? id
}

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function onSubmit() {
  const text = draft.value.trim()
  if (!text || props.sending) return
  emit('send', { text, toPlayerId: toPlayerId.value || null })
  draft.value = ''
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <div
    ref="panelRef"
    class="room-chat"
    :class="{ 'room-chat--open': open, 'is-dragging': isDragging }"
    :style="panelStyle"
  >
    <button
      type="button"
      class="room-chat-toggle"
      :aria-expanded="open"
      @click="emit('update:open', !open)"
    >
      {{ open ? t.close : t.open }}
      <span v-if="!open && messages.length" class="room-chat-badge">{{ messages.length }}</span>
    </button>

    <div v-if="open" class="room-chat-panel" role="log" aria-live="polite">
      <header
        class="room-chat-head drag-handle"
        title="Потяните, чтобы переставить окно чата"
        @pointerdown="onDragHandlePointerDown"
      >
        <strong>{{ t.title }}</strong>
        <label class="room-chat-peer">
          <span>{{ t.pickPeer }}</span>
          <select v-model="toPlayerId">
            <option value="">{{ t.everyone }}</option>
            <option v-for="p in peers" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
        </label>
      </header>

      <div ref="listRef" class="room-chat-list">
        <p v-if="!messages.length" class="room-chat-empty">{{ t.empty }}</p>
        <div
          v-for="m in messages"
          :key="m.id"
          class="room-chat-msg"
          :class="{
            'room-chat-msg--mine': m.fromPlayerId === selfPlayerId,
            'room-chat-msg--dm': m.toPlayerId != null,
          }"
        >
          <div class="room-chat-meta">
            <span class="room-chat-from">
              {{ m.fromPlayerId === selfPlayerId ? t.you : m.fromName }}
            </span>
            <span v-if="m.toPlayerId" class="room-chat-dm-tag">
              →
              {{
                m.toPlayerId === selfPlayerId
                  ? t.you
                  : peerName(m.toPlayerId)
              }}
            </span>
            <time class="room-chat-time">{{ formatTime(m.at) }}</time>
          </div>
          <!-- текст как текст: Vue экранирует, без v-html -->
          <p class="room-chat-text">{{ m.text }}</p>
        </div>
      </div>

      <p v-if="error" class="room-chat-error">{{ error }}</p>

      <form class="room-chat-compose" @submit.prevent="onSubmit">
        <input
          v-model="draft"
          type="text"
          maxlength="400"
          :placeholder="placeholder"
          autocomplete="off"
          :disabled="sending"
        />
        <button type="submit" :disabled="sending || !draft.trim()">
          {{ t.send }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.room-chat {
  position: fixed;
  right: 0.75rem;
  bottom: 0.75rem;
  z-index: 220;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
  pointer-events: none;
}
.room-chat > * {
  pointer-events: auto;
}
.room-chat-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #475569;
  background: rgba(15, 23, 42, 0.94);
  color: #e2e8f0;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.room-chat-badge {
  min-width: 1.25rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: #1d4ed8;
  font-size: 0.72rem;
  text-align: center;
}
.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.is-dragging .drag-handle {
  cursor: grabbing;
}
.room-chat-panel {
  width: min(22rem, calc(100vw - 1.5rem));
  height: min(22rem, 48vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #334155;
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.room-chat-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid #334155;
}
.room-chat-peer {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: #94a3b8;
}
.room-chat-peer select {
  max-width: 9rem;
  padding: 0.2rem 0.35rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #e2e8f0;
}
.room-chat-list {
  flex: 1;
  overflow: auto;
  padding: 0.55rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.room-chat-empty {
  margin: auto 0;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}
.room-chat-msg {
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.85);
}
.room-chat-msg--mine {
  background: rgba(30, 64, 175, 0.45);
}
.room-chat-msg--dm {
  border-left: 2px solid #a78bfa;
}
.room-chat-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.45rem;
  font-size: 0.72rem;
  color: #94a3b8;
}
.room-chat-from {
  font-weight: 600;
  color: #cbd5e1;
}
.room-chat-dm-tag {
  color: #c4b5fd;
}
.room-chat-text {
  margin: 0.2rem 0 0;
  font-size: 0.88rem;
  color: #f1f5f9;
  white-space: pre-wrap;
  word-break: break-word;
}
.room-chat-error {
  margin: 0;
  padding: 0 0.7rem;
  color: #f87171;
  font-size: 0.78rem;
}
.room-chat-compose {
  display: flex;
  gap: 0.35rem;
  padding: 0.55rem 0.7rem;
  border-top: 1px solid #334155;
}
.room-chat-compose input {
  flex: 1;
  min-width: 0;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
}
.room-chat-compose button {
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.room-chat-compose button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .room-chat {
    right: 0.5rem;
    bottom: 0.5rem;
    left: auto;
    align-items: flex-end;
  }
  .room-chat-toggle {
    align-self: flex-end;
    min-height: 2.6rem;
    padding: 0.55rem 0.9rem;
    font-size: 0.88rem;
  }
  .room-chat-panel {
    width: min(100vw - 1rem, 22rem);
    height: min(42vh, 18rem);
  }
  .room-chat-compose input,
  .room-chat-compose button,
  .room-chat-peer select {
    min-height: 2.45rem;
    font-size: 1rem;
  }
}
</style>
