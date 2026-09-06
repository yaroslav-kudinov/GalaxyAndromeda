import { ref } from 'vue'
import { normalizeMapDefinition, type MapDefinition } from '@galaxy/rules'
import { fetchCatalogMap, fetchCatalogMaps, type CatalogMapEntry } from '~/composables/useGameApi'

const BUNDLED_MANIFEST: CatalogMapEntry[] = [
  { id: 'duel', name: 'Дуэль', playerCount: 2 },
  { id: 'trio-start', name: 'Карта на троих (Старт)', playerCount: 3 },
  { id: 'maltese-cross-4', name: 'Мальтийский крест (4)', playerCount: 4 },
  { id: 'five-point-path', name: 'Пятиконечный путь', playerCount: 5 },
]

export function useCatalogMaps() {
  const officialMaps = ref<CatalogMapEntry[]>([])
  const mapCache = ref(new Map<string, MapDefinition>())

  async function refreshOfficialMaps() {
    const fromApi = await fetchCatalogMaps()
    if (fromApi.length) {
      officialMaps.value = fromApi
      return
    }
    const fallback: CatalogMapEntry[] = []
    for (const entry of BUNDLED_MANIFEST) {
      try {
        const res = await fetch(`/maps/${entry.id}.json`)
        if (res.ok) fallback.push(entry)
      } catch {
        /* skip */
      }
    }
    officialMaps.value = fallback.length ? fallback : BUNDLED_MANIFEST
  }

  async function loadOfficialMap(id: string): Promise<MapDefinition | null> {
    const cached = mapCache.value.get(id)
    if (cached) return cached
    const fromApi = await fetchCatalogMap(id)
    if (fromApi) {
      const normalized = normalizeMapDefinition(fromApi)
      mapCache.value.set(id, normalized)
      return normalized
    }
    try {
      const res = await fetch(`/maps/${id}.json`)
      if (!res.ok) return null
      const map = normalizeMapDefinition((await res.json()) as MapDefinition)
      mapCache.value.set(id, map)
      return map
    } catch {
      return null
    }
  }

  return { officialMaps, refreshOfficialMaps, loadOfficialMap }
}
