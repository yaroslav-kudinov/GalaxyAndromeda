/**
 * Ограничения для перетаскиваемых окон.
 *
 * Окно можно увести за левый, правый и нижний край экрана — важно лишь, чтобы
 * от него осталась видимая полоска и чтобы шапка, за которую его тянут, не ушла
 * выше верхнего края: иначе окно нельзя будет вернуть обратно.
 */

export type PanelRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type Viewport = {
  width: number
  height: number
}

export type PanelOffset = {
  x: number
  y: number
}

export type ClampPanelOffsetInput = {
  /** Текущее положение окна на экране */
  rect: PanelRect
  /** Смещение, которое уже применено к окну */
  current: PanelOffset
  /** Смещение, которое хочет применить перетаскивание */
  next: PanelOffset
  viewport: Viewport
  /** Сколько пикселей окна обязано остаться на экране */
  minVisible?: number
  /** Отступ сверху: ниже него шапка окна всегда доступна для захвата */
  topMargin?: number
}

export const DEFAULT_MIN_VISIBLE = 72
export const DEFAULT_TOP_MARGIN = 0

export function clampPanelOffset(input: ClampPanelOffsetInput): PanelOffset {
  const minVisible = input.minVisible ?? DEFAULT_MIN_VISIBLE
  const topMargin = input.topMargin ?? DEFAULT_TOP_MARGIN
  const { rect, viewport } = input

  const deltaX = input.next.x - input.current.x
  const deltaY = input.next.y - input.current.y

  const left = rect.left + deltaX
  const top = rect.top + deltaY
  const right = rect.right + deltaX
  const bottom = rect.bottom + deltaY

  const width = Math.max(0, rect.right - rect.left)
  const height = Math.max(0, rect.bottom - rect.top)

  // Полоска окна, которая обязана остаться видимой, не может быть больше самого окна
  const keepX = Math.min(minVisible, width)
  const keepY = Math.min(minVisible, height)

  let adjustX = 0
  if (right < keepX) adjustX = keepX - right
  else if (left > viewport.width - keepX) adjustX = viewport.width - keepX - left

  let adjustY = 0
  if (top < topMargin) adjustY = topMargin - top
  else if (top > viewport.height - keepY) adjustY = viewport.height - keepY - top
  // Окно выше экрана: держим его так, чтобы снизу осталась видимая полоска
  if (adjustY === 0 && bottom < keepY) adjustY = keepY - bottom

  return { x: input.next.x + adjustX, y: input.next.y + adjustY }
}
