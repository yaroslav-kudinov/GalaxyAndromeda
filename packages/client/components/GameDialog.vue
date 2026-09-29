<script setup lang="ts">
import { useGameDialogQueue } from '~/composables/useGameDialog'
import { useUiStrings } from '~/i18n/ui-strings'

const t = useUiStrings().dialog
const { current, answer } = useGameDialogQueue()
const input = ref('')
const confirmRef = ref<HTMLButtonElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

watch(current, async (request) => {
  if (!request) return
  input.value = ''
  await nextTick()
  if (request.kind === 'prompt') inputRef.value?.focus()
  else confirmRef.value?.focus()
})

function confirm() {
  const request = current.value
  if (!request) return
  if (request.kind === 'prompt') {
    const text = input.value.trim()
    if (!text) return
    answer(text)
    return
  }
  answer(true)
}

function cancel() {
  const request = current.value
  if (!request) return
  answer(request.kind === 'prompt' ? null : false)
}

function onKeydown(e: KeyboardEvent) {
  if (!current.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  } else if (e.key === 'Enter' && current.value.kind !== 'prompt') {
    e.preventDefault()
    confirm()
  }
}
</script>

<template>
  <div v-if="current" class="gd-backdrop" role="presentation" @click.self="cancel" @keydown="onKeydown">
    <section
      class="gd"
      :class="{ 'gd--danger': current.danger }"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="gd-title"
      :aria-describedby="current.message ? 'gd-message' : undefined"
    >
      <h2 id="gd-title" class="gd-title">{{ current.title }}</h2>
      <p v-if="current.message" id="gd-message" class="gd-message">{{ current.message }}</p>
      <form v-if="current.kind === 'prompt'" class="gd-form" @submit.prevent="confirm">
        <input ref="inputRef" v-model="input" type="text" :placeholder="current.placeholder" maxlength="400" />
      </form>
      <div class="gd-actions">
        <button v-if="current.kind !== 'alert'" type="button" class="gd-btn gd-btn--secondary" @click="cancel">
          {{ current.cancelLabel ?? t.cancel }}
        </button>
        <button
          ref="confirmRef"
          type="button"
          class="gd-btn gd-btn--primary"
          :disabled="current.kind === 'prompt' && !input.trim()"
          @click="confirm"
        >
          {{ current.confirmLabel ?? (current.kind === 'alert' ? t.ok : t.confirm) }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
}
.gd {
  width: min(26rem, 100%);
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 1.1rem 1.2rem 1rem;
  border-radius: 14px;
  border: 2px solid rgba(251, 191, 36, 0.6);
  background: linear-gradient(160deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.99));
  color: #f8fafc;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
}
.gd--danger {
  border-color: rgba(248, 113, 113, 0.7);
}
.gd-title {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  line-height: 1.3;
}
.gd-message {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.45;
  color: #cbd5e1;
  white-space: pre-line;
}
.gd-form input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 0.7rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
  font-size: 0.92rem;
}
.gd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}
.gd-btn {
  padding: 0.45rem 1rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}
.gd-btn--secondary {
  border: 1px solid #475569;
  background: transparent;
  color: #e2e8f0;
}
.gd-btn--primary {
  border: 0;
  background: #d97706;
  color: #fff;
}
.gd--danger .gd-btn--primary {
  background: #dc2626;
}
.gd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
