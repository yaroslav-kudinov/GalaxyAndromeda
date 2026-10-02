/**
 * Состояние связи с сервером — для плашки игроку.
 *
 * Обрыв связи сейчас проходит молча: страница отваливается к экрану входа и возвращается сама,
 * когда связь появилась. Со стороны это выглядит как «игру выбросило в главное меню и она
 * вернулась», и игрок не понимает, можно ли доверять тому, что на экране. Поэтому обрыв и
 * возвращение связи называются вслух.
 */

export type ServerStatus = 'idle' | 'loading' | 'online' | 'offline'

export interface ConnectionState {
  /** Комната `local-*` играется целиком в браузере: связи с сервером у неё нет и не было. */
  roomId: string
  serverStatus: ServerStatus
  /** Видна ли плашка рассинхрона: сервер отвечает, но состояние не сходится. */
  syncWarningVisible: boolean
}

export function isConnectionLost({
  roomId,
  serverStatus,
  syncWarningVisible,
}: ConnectionState): boolean {
  if (roomId.startsWith('local-')) return false
  return serverStatus === 'offline' || syncWarningVisible
}

export type ConnectionToast =
  | { title: 'Связь потеряна'; detail: string; accent: false }
  | { title: 'Связь восстановлена'; detail: string; accent: true }
  | null

/**
 * Что показать на смене состояния связи. `wasLost === undefined` — это первое срабатывание
 * наблюдателя, то есть обычная загрузка страницы, а не возвращение связи: молчим.
 */
export function connectionToastFor(lost: boolean, wasLost: boolean | undefined): ConnectionToast {
  if (lost && !wasLost) {
    return { title: 'Связь потеряна', detail: 'Пробуем подключиться заново', accent: false }
  }
  if (!lost && wasLost) {
    return { title: 'Связь восстановлена', detail: 'Состояние партии обновлено', accent: true }
  }
  return null
}
