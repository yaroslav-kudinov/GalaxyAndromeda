import type { MapDefinition } from '@galaxy/rules'
import { hexKey, normalizeMapDefinition } from '@galaxy/rules'

const MAX_UNDO_STEPS = 60

export interface MapEditorSnapshot {
  map: MapDefinition
  selectedKey: string | null
}

function cloneMap(map: MapDefinition): MapDefinition {
  return JSON.parse(JSON.stringify(map)) as MapDefinition
}

function resolveSelection(map: MapDefinition, selectedKey: string | null): string | null {
  if (!map.cells.length) return null
  if (selectedKey && map.cells.some((c) => hexKey(c.q, c.r) === selectedKey)) return selectedKey
  return hexKey(map.cells[0].q, map.cells[0].r)
}

export function useMapEditorHistory(
  map: Ref<MapDefinition>,
  selectedKey: Ref<string | null>,
) {
  const undoStack = ref<MapEditorSnapshot[]>([])
  const redoStack = ref<MapEditorSnapshot[]>([])
  let restoring = false

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function captureSnapshot(): MapEditorSnapshot {
    return {
      map: cloneMap(map.value),
      selectedKey: selectedKey.value,
    }
  }

  function pushHistory() {
    if (restoring) return
    undoStack.value.push(captureSnapshot())
    if (undoStack.value.length > MAX_UNDO_STEPS) undoStack.value.shift()
    redoStack.value = []
  }

  function restoreSnapshot(snapshot: MapEditorSnapshot) {
    restoring = true
    map.value = normalizeMapDefinition(cloneMap(snapshot.map))
    selectedKey.value = resolveSelection(map.value, snapshot.selectedKey)
    restoring = false
  }

  function undo() {
    if (!undoStack.value.length) return
    redoStack.value.push(captureSnapshot())
    restoreSnapshot(undoStack.value.pop()!)
  }

  function redo() {
    if (!redoStack.value.length) return
    undoStack.value.push(captureSnapshot())
    restoreSnapshot(redoStack.value.pop()!)
  }

  function resetHistory() {
    undoStack.value = []
    redoStack.value = []
  }

  return {
    canUndo,
    canRedo,
    pushHistory,
    undo,
    redo,
    resetHistory,
  }
}
