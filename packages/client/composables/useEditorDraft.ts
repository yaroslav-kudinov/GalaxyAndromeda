import type { MapDefinition } from '@galaxy/rules'
import { galaxySaveFromMap, normalizeMapDefinition, parseGalaxySave, type GalaxySaveFile } from '@galaxy/rules'

const DRAFT_STORAGE_KEY = 'galaxy-editor-draft'

export interface EditorDraft {
  save: GalaxySaveFile
  selectedKey: string | null
}

export function persistEditorDraft(map: MapDefinition, selectedKey: string | null): void {
  if (!import.meta.client) return
  const normalized = normalizeMapDefinition(map)
  const draft: EditorDraft = {
    save: galaxySaveFromMap(normalized),
    selectedKey,
  }
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

export function loadEditorDraft(): EditorDraft | null {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as EditorDraft
    parseGalaxySave(draft.save)
    return draft
  } catch {
    return null
  }
}

export function useEditorDraft(
  map: Ref<MapDefinition>,
  selectedKey: Ref<string | null>,
  onRestore: (draft: EditorDraft) => void,
) {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  function persistNow() {
    persistEditorDraft(map.value, selectedKey.value)
  }

  function schedulePersist() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(persistNow, 400)
  }

  watch([map, selectedKey], schedulePersist, { deep: true })

  onMounted(() => {
    const draft = loadEditorDraft()
    if (draft) onRestore(draft)

    window.addEventListener('pagehide', persistNow)
    window.addEventListener('beforeunload', persistNow)
  })

  onUnmounted(() => {
    persistNow()
    if (debounceTimer) clearTimeout(debounceTimer)
    window.removeEventListener('pagehide', persistNow)
    window.removeEventListener('beforeunload', persistNow)
  })

  return { persistNow }
}
