<script setup lang="ts">
import { submitBugReport } from '~/composables/useGameApi'

const props = defineProps<{
  open: boolean
  roomId?: string
  playerId?: string
  playerName?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const description = ref('')
const screenshotDataUrl = ref<string | null>(null)
const screenshotName = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const successId = ref<string | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      description.value = ''
      screenshotDataUrl.value = null
      screenshotName.value = null
      busy.value = false
      error.value = null
      successId.value = null
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape' && !busy.value) {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function clearScreenshot() {
  screenshotDataUrl.value = null
  screenshotName.value = null
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = 'Нужен файл изображения (PNG, JPEG, WebP или GIF)'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    error.value = 'Скриншот слишком большой (макс. 5 МБ)'
    return
  }
  try {
    screenshotDataUrl.value = await readFileAsDataUrl(file)
    screenshotName.value = file.name
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось прочитать файл'
  }
}

async function submit() {
  if (busy.value) return
  const text = description.value.trim()
  if (!text) {
    error.value = 'Опишите проблему'
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await submitBugReport({
      description: text,
      screenshotBase64: screenshotDataUrl.value ?? undefined,
      roomId: props.roomId,
      playerId: props.playerId,
      playerName: props.playerName,
    })
    successId.value = result.id
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось отправить репорт'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="bug-backdrop"
      role="presentation"
      @click.self="!busy && emit('close')"
    >
      <div
        class="bug-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        <header class="bug-header">
          <div>
            <h2 id="bug-report-title">Сообщить о баге</h2>
            <p class="bug-sub">
              Описание и скриншот сохраняются на сервере на 60 дней, затем удаляются.
            </p>
          </div>
          <button
            type="button"
            class="bug-close"
            title="Закрыть"
            :disabled="busy"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div v-if="successId" class="bug-success">
          <p>Репорт сохранён. Номер: <code>{{ successId }}</code></p>
          <button type="button" class="bug-primary" @click="emit('close')">Закрыть</button>
        </div>

        <form v-else class="bug-form" @submit.prevent="submit">
          <label class="bug-label" for="bug-description">Что произошло?</label>
          <textarea
            id="bug-description"
            v-model="description"
            class="bug-textarea"
            rows="6"
            maxlength="4000"
            placeholder="Шаги воспроизведения, ожидаемое и фактическое поведение…"
            :disabled="busy"
          />
          <p class="bug-hint">{{ description.trim().length }} / 4000</p>

          <div class="bug-shot-block">
            <label class="bug-label">Скриншот (необязательно)</label>
            <div class="bug-shot-actions">
              <label class="bug-file-btn">
                Выбрать файл
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  :disabled="busy"
                  @change="onFileChange"
                >
              </label>
              <button
                v-if="screenshotDataUrl"
                type="button"
                class="bug-secondary"
                :disabled="busy"
                @click="clearScreenshot"
              >
                Убрать
              </button>
            </div>
            <p v-if="screenshotName" class="bug-hint">{{ screenshotName }}</p>
            <img
              v-if="screenshotDataUrl"
              :src="screenshotDataUrl"
              alt="Превью скриншота"
              class="bug-preview"
            >
          </div>

          <p v-if="error" class="bug-error">{{ error }}</p>

          <div class="bug-footer">
            <button type="button" class="bug-secondary" :disabled="busy" @click="emit('close')">
              Отмена
            </button>
            <button type="submit" class="bug-primary" :disabled="busy">
              {{ busy ? 'Отправка…' : 'Отправить' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bug-backdrop {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(3px);
}

.bug-modal {
  --bug-font: 'Manrope', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  width: min(520px, 100%);
  max-height: min(88vh, 720px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid #475569;
  background: linear-gradient(165deg, #0f172a 0%, #111827 100%);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  color: #e8eef7;
  font-family: var(--bug-font);
  -webkit-font-smoothing: antialiased;
}

.bug-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.2rem 0.85rem;
  border-bottom: 1px solid #334155;
}

.bug-header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
}

.bug-sub {
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
  font-weight: 500;
  line-height: 1.4;
  color: #94a3b8;
}

.bug-close {
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid #475569;
  border-radius: 8px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.bug-form,
.bug-success {
  padding: 1rem 1.2rem 1.2rem;
}

.bug-success p {
  margin: 0 0 1rem;
  font-size: 0.98rem;
  line-height: 1.45;
}

.bug-success code {
  font-size: 0.85rem;
  word-break: break-all;
  color: #bae6fd;
}

.bug-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
  font-weight: 700;
}

.bug-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 8rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid #475569;
  background: #0b1220;
  color: #f1f5f9;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.45;
}

.bug-textarea:focus {
  outline: 2px solid rgba(56, 189, 248, 0.45);
  outline-offset: 1px;
}

.bug-hint {
  margin: 0.3rem 0 0.8rem;
  font-size: 0.78rem;
  color: #94a3b8;
}

.bug-shot-block {
  margin-bottom: 0.75rem;
}

.bug-shot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.bug-file-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  border: 1px solid #64748b;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.bug-file-btn input {
  display: none;
}

.bug-preview {
  display: block;
  margin-top: 0.65rem;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #020617;
}

.bug-error {
  margin: 0 0 0.75rem;
  color: #fca5a5;
  font-size: 0.88rem;
  font-weight: 600;
}

.bug-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.bug-primary,
.bug-secondary {
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.bug-primary {
  border: 1px solid #0284c7;
  background: #0369a1;
  color: #f0f9ff;
}

.bug-primary:disabled,
.bug-secondary:disabled,
.bug-close:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bug-secondary {
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
}
</style>
