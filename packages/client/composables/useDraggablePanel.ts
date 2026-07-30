export type UseDraggablePanelOptions = {
  /** Удерживать панель в пределах окна браузера */
  constrainToViewport?: boolean
  /** Отступ от краёв viewport при ограничении */
  viewportMargin?: number
}

export function useDraggablePanel(options: UseDraggablePanelOptions = {}) {
  const { constrainToViewport = true, viewportMargin = 8 } = options

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
    const deltaX = x - offsetX.value
    const deltaY = y - offsetY.value

    let adjustX = 0
    let adjustY = 0

    const left = rect.left + deltaX
    const top = rect.top + deltaY
    const right = rect.right + deltaX
    const bottom = rect.bottom + deltaY

    if (left < viewportMargin) adjustX = viewportMargin - left
    if (top < viewportMargin) adjustY = viewportMargin - top
    if (right > window.innerWidth - viewportMargin) {
      adjustX = window.innerWidth - viewportMargin - right
    }
    if (bottom > window.innerHeight - viewportMargin) {
      adjustY = window.innerHeight - viewportMargin - bottom
    }

    return { x: x + adjustX, y: y + adjustY }
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
    if ((e.target as HTMLElement).closest('button')) return

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
