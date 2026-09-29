/**
 * Окна подтверждения и предупреждения в стиле игры вместо системных `alert` / `confirm` /
 * `prompt`. Системные окна выглядели чужеродно, их текст легко было принять за другое
 * подтверждение, а на телефоне они перекрывали игру целиком.
 *
 * Окно одно на всё приложение (`GameDialog.vue` в `app.vue`); запросы идут по очереди.
 */
export interface GameDialogOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Необратимое действие — кнопка подтверждения красная. */
  danger?: boolean
}

interface DialogRequest extends GameDialogOptions {
  kind: 'confirm' | 'alert' | 'prompt'
  placeholder?: string
  resolve: (value: boolean | string | null) => void
}

const queue = ref<DialogRequest[]>([])

function push(request: Omit<DialogRequest, 'resolve'>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    queue.value = [...queue.value, { ...request, resolve }]
  })
}

/** Да или нет. Отмена, Esc и щелчок мимо окна — «нет». */
export function gameConfirm(options: GameDialogOptions): Promise<boolean> {
  return push({ kind: 'confirm', ...options }).then((value) => value === true)
}

/** Сообщение с одной кнопкой. */
export function gameAlert(options: GameDialogOptions): Promise<void> {
  return push({ kind: 'alert', ...options }).then(() => undefined)
}

/** Короткий ответ текстом; `null` — отмена. */
export function gamePrompt(options: GameDialogOptions & { placeholder?: string }): Promise<string | null> {
  return push({ kind: 'prompt', ...options }).then((value) => (typeof value === 'string' ? value : null))
}

/** Для `GameDialog.vue`: текущий запрос и ответ на него. */
export function useGameDialogQueue() {
  const current = computed(() => queue.value[0] ?? null)
  function answer(value: boolean | string | null) {
    const request = queue.value[0]
    if (!request) return
    queue.value = queue.value.slice(1)
    request.resolve(value)
  }
  return { current, answer }
}
