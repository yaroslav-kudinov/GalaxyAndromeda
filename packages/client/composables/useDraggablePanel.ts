import { clampPanelOffset, DEFAULT_MIN_VISIBLE } from '~/utils/drag-panel-bounds'

export type UseDraggablePanelOptions = {
  /** Не давать панели полностью уйти за край окна браузера */
  constrainToViewport?: boolean
  /** Сколько пикселей панели обязано остаться на экране */
  minVisible?: number
  /** Отступ сверху: ниже него шапка панели всегда доступна для захвата */
  topMargin?: number
}

export function useDraggablePanel(options: UseDraggablePanelOptions = {}) {
  const {
    constrainToViewport = true,
    minVisible = DEFAULT_MIN_VISIBLE,
    topMargin = 0,
  } = options

  const panelRef = ref<HTMLElement | null>(null)
  const offsetX = ref(0)
  const offsetY = ref(0)
  const isDragging = ref(false)

  let dragStartX = 0
  let dragStartY = 0
  let dragStartOffsetX = 0
  let dragStartOffsetY = 0
  let movedDuringDrag = false

  const panelStyle = computed(() => ({
    transform: `translate(${offsetX.value}px, ${offsetY.value}px)`,
  }))

  function clampOffset(x: number, y: number): { x: number; y: number } {
    const el = panelRef.value
    if (!el || !constrainToViewport) return { x, y }

    const rect = el.getBoundingClientRect()
    return clampPanelOffset({
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      current: { x: offsetX.value, y: offsetY.value },
      next: { x, y },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      minVisible,
      topMargin,
    })
  }

  function stopDragging() {
    if (!isDragging.value) return
    isDragging.value = false
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('cursor')
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging.value) return

    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedDuringDrag = true

    const next = clampOffset(dragStartOffsetX + dx, dragStartOffsetY + dy)
    offsetX.value = next.x
    offsetY.value = next.y
  }

  function onPointerUp() {
    stopDragging()
  }

  function onDragHandlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // Кнопки, поля и ссылки в шапке остаются кликабельными
    if (target.closest('button, a, input, select, textarea, label')) return

    isDragging.value = true
    movedDuringDrag = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragStartOffsetX = offsetX.value
    dragStartOffsetY = offsetY.value

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    e.preventDefault()
  }

  function resetPosition() {
    offsetX.value = 0
    offsetY.value = 0
  }

  /** Подавить click по backdrop сразу после перетаскивания */
  function consumeDragClick(): boolean {
    if (!movedDuringDrag) return false
    movedDuringDrag = false
    return true
  }

  onUnmounted(stopDragging)

  return {
    panelRef,
    panelStyle,
    isDragging,
    onDragHandlePointerDown,
    resetPosition,
    consumeDragClick,
  }
}
