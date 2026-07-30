import {
  normalizeGalaxySave,
  parseGalaxySave,
  serializeGalaxySave,
  type GalaxySaveFile,
} from '@galaxy/rules'

const LOBBY_SAVES_KEY = 'galaxy-lobby-saves'

export function loadLobbySaves(): GalaxySaveFile[] {
  if (!import.meta.client) return []
  try {
    const raw = JSON.parse(localStorage.getItem(LOBBY_SAVES_KEY) ?? '[]') as unknown[]
    return raw.map((entry) => normalizeGalaxySave(parseGalaxySave(entry)))
  } catch {
    return []
  }
}

export function upsertLobbySave(save: GalaxySaveFile): void {
  if (!import.meta.client) return
  const normalized = normalizeGalaxySave(save)
  const list = loadLobbySaves().filter((s) => s.map.id !== normalized.map.id)
  list.push(normalized)
  localStorage.setItem(LOBBY_SAVES_KEY, JSON.stringify(list.map((s) => JSON.parse(serializeGalaxySave(s, false)))))
}

export function removeLobbySave(mapId: string): void {
  if (!import.meta.client) return
  const list = loadLobbySaves().filter((s) => s.map.id !== mapId)
  localStorage.setItem(LOBBY_SAVES_KEY, JSON.stringify(list.map((s) => JSON.parse(serializeGalaxySave(s, false)))))
}
