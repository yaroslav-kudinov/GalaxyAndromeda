import type { MapDefinition } from '@galaxy/rules'
import { parseHexKey } from '@galaxy/rules'
import { hexCenter, loadStoredOrientation } from '~/utils/hex-layout'

const BOARD_HEX_SIZE = 36

const ARROW_VECTORS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
} as const

type ArrowKey = keyof typeof ARROW_VECTORS

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!target.closest('input, textarea, select, [contenteditable="true"]')
}

function digitFromCode(code: string): number | null {
  if (!code.startsWith('Digit')) return null
  const digit = Number(code.slice(5))
  return Number.isFinite(digit) ? digit : null
}

function findTargetInDirection(
  from: { q: number; r: number },
  targets: { q: number; r: number }[],
  arrow: ArrowKey,
): { q: number; r: number } | null {
  const orientation = loadStoredOrientation()
  const origin = hexCenter(from.q, from.r, BOARD_HEX_SIZE, orientation)
  const vec = ARROW_VECTORS[arrow]

  let best: { target: { q: number; r: number }; score: number; dist: number } | null = null

  for (const target of targets) {
    if (target.q === from.q && target.r === from.r) continue
    const c = hexCenter(target.q, target.r, BOARD_HEX_SIZE, orientation)
    const dx = c.x - origin.x
    const dy = c.y - origin.y
    const dot = dx * vec.x + dy * vec.y
    if (dot <= 1e-6) continue
    const dist = Math.hypot(dx, dy)
    const score = dot / dist
    if (
      !best
      || score > best.score + 1e-6
      || (Math.abs(score - best.score) <= 1e-6 && dist < best.dist)
    ) {
      best = { target, score, dist }
    }
  }

  return best?.target ?? null
}

export function useMapEditorHotkeys(options: {
  selectedKey: Ref<string | null>
  ghosts: ComputedRef<{ q: number; r: number }[]>
  map: Ref<MapDefinition>
  shipsFull: ComputedRef<boolean>
  hasCellClipboard: ComputedRef<boolean>
  selectCell: (q: number, r: number) => void
  addCell: (q: number, r: number) => void
  removeSelected: () => void
  togglePowerCenter: () => void
  setStartPlayer: (player: number | null) => void
  addShip: () => void
  saveLocal: () => void
  copySelectedCell: () => void
  pasteToSelectedCell: () => void
  undo: () => void
  redo: () => void
  canUndo: ComputedRef<boolean>
}) {
  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || isTypingTarget(event.target)) return

    const mod = event.ctrlKey || event.metaKey
    if (mod) {
      if (event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) {
          options.redo()
        } else if (options.canUndo.value) {
          options.undo()
        }
        return
      }
      if (!event.shiftKey && event.code === 'KeyS') {
        event.preventDefault()
        options.saveLocal()
        return
      }
      if (!event.shiftKey && event.code === 'KeyC') {
        if (!options.selectedKey.value) return
        event.preventDefault()
        options.copySelectedCell()
        return
      }
      if (!event.shiftKey && event.code === 'KeyV') {
        if (!options.selectedKey.value || !options.hasCellClipboard.value) return
        event.preventDefault()
        options.pasteToSelectedCell()
        return
      }
      return
    }

    if (event.altKey) return

    const selected = options.selectedKey.value
      ? parseHexKey(options.selectedKey.value)
      : null

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selected || options.map.value.cells.length <= 1) return
      event.preventDefault()
      options.removeSelected()
      return
    }

    if (selected && event.key in ARROW_VECTORS) {
      const arrow = event.key as ArrowKey
      if (event.shiftKey) {
        const ghost = findTargetInDirection(selected, options.ghosts.value, arrow)
        if (!ghost) return
        event.preventDefault()
        options.addCell(ghost.q, ghost.r)
      } else {
        const next = findTargetInDirection(selected, options.map.value.cells, arrow)
        if (!next) return
        event.preventDefault()
        options.selectCell(next.q, next.r)
      }
      return
    }

    if (!selected) return

    if (event.code === 'KeyP') {
      event.preventDefault()
      options.togglePowerCenter()
      return
    }

    if (event.code === 'KeyA') {
      if (options.shipsFull.value) return
      event.preventDefault()
      options.addShip()
      return
    }

    const digit = digitFromCode(event.code)
    if (digit === 0) {
      event.preventDefault()
      options.setStartPlayer(null)
      return
    }
    if (digit != null && digit >= 1 && digit <= 6) {
      event.preventDefault()
      options.setStartPlayer(digit)
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown, true))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown, true))
}

export const MAP_EDITOR_HOTKEYS = [
  { keys: 'Ctrl+Z', action: 'Отменить последнее действие' },
  { keys: 'Ctrl+Shift+Z', action: 'Повторить отменённое' },
  { keys: 'Ctrl+C', action: 'Скопировать состояние клетки' },
  { keys: 'Ctrl+V', action: 'Вставить в выбранную клетку' },
  { keys: 'Del / Backspace', action: 'Удалить выбранную клетку' },
  { keys: '← ↑ → ↓', action: 'Перейти к соседней клетке' },
  { keys: 'Shift + стрелки', action: 'Добавить клетку в этом направлении' },
  { keys: 'P', action: 'Центр Власти вкл/выкл' },
  { keys: '0–6', action: 'Стартовый игрок (0 — нейтральная)' },
  { keys: 'A', action: 'Добавить корабль на клетку' },
  { keys: 'Ctrl+S', action: 'Сохранить в браузере' },
] as const
