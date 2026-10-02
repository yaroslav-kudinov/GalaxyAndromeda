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
  if (busy.value) return
  emit('close')
}

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

/**
 * Снимок из буфера обмена: игрок нажимает Ctrl+V (или «Вставить из буфера») — отдельный файл
 * сохранять не нужно. Окно открыто на весь экран, поэтому слушаем вставку на документе: курсор
 * чаще всего стоит в поле описания, но вставить картинку должно получаться и мимо него.
 */
async function onPaste(e: ClipboardEvent) {
  if (!props.open || busy.value) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    e.preventDefault()
    await acceptScreenshot(file, 'Снимок из буфера обмена')
    return
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('paste', onPaste)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onPaste)
})

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

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

/** Проверка и чтение снимка — одна для файла, вставки из буфера и перетаскивания. */
async function acceptScreenshot(file: File, fallbackName: string) {
  if (!file.type.startsWith('image/')) {
    error.value = 'Нужен файл изображения (PNG, JPEG, WebP или GIF)'
    return
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    error.value = 'Скриншот слишком большой (макс. 5 МБ)'
    return
  }
  try {
    screenshotDataUrl.value = await readFileAsDataUrl(file)
    screenshotName.value = file.name || fallbackName
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось прочитать файл'
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await acceptScreenshot(file, 'Снимок экрана')
}

/** Перетаскивание картинки в окно — тот же путь, что вставка из буфера. */
async function onDrop(e: DragEvent) {
  if (busy.value) return
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  await acceptScreenshot(file, 'Перенесённый снимок')
}

/**
 * Кнопка «Вставить из буфера» — для тех, кому Ctrl+V не подсказали. Браузер спрашивает
 * разрешение на чтение буфера и в некоторых браузерах такого доступа не даёт вовсе: тогда
 * честно просим нажать Ctrl+V.
 */
async function pasteFromClipboard() {
  if (busy.value) return
  const read = navigator.clipboard?.read
  if (!read) {
    error.value = 'Браузер не даёт прочитать буфер обмена. Нажмите Ctrl+V в этом окне.'
    return
  }
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'))
      if (!type) continue
      const blob = await item.getType(type)
      await acceptScreenshot(
        new File([blob], 'Снимок из буфера обмена', { type }),
        'Снимок из буфера обмена',
      )
      return
    }
    error.value = 'В буфере обмена нет картинки. Сделайте снимок экрана и попробуйте снова.'
  } catch {
    error.value = 'Не удалось прочитать буфер обмена. Нажмите Ctrl+V в этом окне.'
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
      @click.self="onBackdropClick"
    >
      <div
        ref="panelRef"
        class="bug-modal"
        :class="{ 'is-dragging': isDragging }"
        :style="panelStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        <header class="bug-header drag-handle" @pointerdown="onDragHandlePointerDown">
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

          <div class="bug-shot-block" @drop.prevent="onDrop" @dragover.prevent>
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
                type="button"
                class="bug-secondary"
                :disabled="busy"
                @click="pasteFromClipboard"
              >
                Вставить из буфера
              </button>
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
            <p class="bug-hint">
              Снимок можно вставить из буфера обмена — нажмите Ctrl+V в этом окне — или перенести
              картинку мышью. Сохранять отдельный файл не нужно.
            </p>
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

.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.is-dragging .drag-handle {
  cursor: grabbing;
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
