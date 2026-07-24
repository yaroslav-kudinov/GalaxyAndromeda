<script setup lang="ts">
import {
  createEmptyMap,
  galaxySaveFromMap,
  gameSnapshotFromMap,
  normalizeMapDefinition,
  parseGalaxySave,
  serializeGalaxySave,
  type MapDefinition,
} from '@galaxy/rules'
import { checkServerHealth, createRoom, joinRoom } from '~/composables/useGameApi'
import { gameSaveStorageKey, saveGameSession } from '~/composables/useGameSession'

const MAPS_STORAGE_KEY = 'galaxy-maps'
const DRAFT_STORAGE_KEY = 'galaxy-editor-draft'

interface MapOption {
  id: string
  name: string
  map: MapDefinition
}

const router = useRouter()
const playerName = ref('Игрок 1')
const selectedMapId = ref('default')
const serverOnline = ref<boolean | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const defaultMap = ref<MapDefinition>(normalizeMapDefinition(createEmptyMap('default', 'Default')))

const mapOptions = ref<MapOption[]>([])

async function loadBundledDefaultMap() {
  try {
    const res = await fetch('/maps/default.json')
    if (res.ok) {
      defaultMap.value = normalizeMapDefinition((await res.json()) as MapDefinition)
    }
  } catch {
    /* keep createEmptyMap fallback */
  }
}

function refreshMapList() {
  const options: MapOption[] = [
    { id: defaultMap.value.id, name: defaultMap.value.name, map: defaultMap.value },
  ]
  const seen = new Set<string>([defaultMap.value.id])

  if (import.meta.client) {
    try {
      const list = JSON.parse(localStorage.getItem(MAPS_STORAGE_KEY) ?? '[]') as unknown[]
      for (const entry of list) {
        try {
          const save = parseGalaxySave(entry)
          if (seen.has(save.map.id)) continue
          seen.add(save.map.id)
          options.push({
            id: save.map.id,
            name: save.map.name || save.map.id,
            map: normalizeMapDefinition(save.map),
          })
        } catch {
          /* skip */
        }
      }

      const draftRaw = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as { save?: unknown }
        if (draft.save) {
          const save = parseGalaxySave(draft.save)
          if (!seen.has(save.map.id)) {
            options.push({
              id: save.map.id,
              name: `${save.map.name || save.map.id} (черновик)`,
              map: normalizeMapDefinition(save.map),
            })
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  mapOptions.value = options
  if (!options.some((o) => o.id === selectedMapId.value)) {
    selectedMapId.value = options[0]?.id ?? 'default'
  }
}

const selectedMap = computed(
  () => mapOptions.value.find((o) => o.id === selectedMapId.value)?.map ?? defaultMap.value,
)

async function startGame() {
  error.value = null
  busy.value = true
  try {
    const map = normalizeMapDefinition(JSON.parse(JSON.stringify(selectedMap.value)) as MapDefinition)
    const name = playerName.value.trim() || 'Игрок 1'

    if (serverOnline.value) {
      const { roomId, code } = await createRoom(map)
      const { playerId } = await joinRoom(roomId, name)
      const save = galaxySaveFromMap(map)
      save.game = gameSnapshotFromMap(map)
      localStorage.setItem(gameSaveStorageKey(roomId), serializeGalaxySave(save))
      saveGameSession({ roomId, playerId, playerName: name, code })
      await router.push(`/game/${roomId}`)
      return
    }

    const offlineId = `local-${Date.now()}`
    const save = galaxySaveFromMap(map)
    save.game = gameSnapshotFromMap(map)
    save.game.activePlayerId = 'player-1'
    localStorage.setItem(gameSaveStorageKey(offlineId), serializeGalaxySave(save))
    saveGameSession({
      roomId: offlineId,
      playerId: 'player-1',
      playerName: name,
    })
    await router.push(`/game/${offlineId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось создать игру'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadBundledDefaultMap()
  refreshMapList()
  serverOnline.value = await checkServerHealth()
})
</script>

<template>
  <div class="lobby">
    <header class="lobby-header">
      <h1>Galaxy Andromeda</h1>
      <p>
        <NuxtLink to="/editor">Редактор карт</NuxtLink>
        <span class="dot">·</span>
        <span class="server" :class="{ online: serverOnline, offline: serverOnline === false }">
          {{ serverOnline === null ? '…' : serverOnline ? 'Сервер online' : 'Offline — локальная игра' }}
        </span>
      </p>
    </header>

    <section class="card">
      <h2>Новая игра</h2>

      <label class="field">
        Имя
        <input v-model="playerName" type="text" maxlength="32" />
      </label>

      <label class="field">
        Карта
        <select v-model="selectedMapId">
          <option v-for="m in mapOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <button type="button" class="primary" :disabled="busy" @click="startGame">
        {{ busy ? 'Создание…' : 'Играть' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.lobby {
  max-width: 420px;
  margin: 0 auto;
}
.lobby-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.lobby-header p {
  margin: 0 0 1.25rem;
  color: #94a3b8;
  font-size: 0.9rem;
}
.lobby-header a {
  color: #93c5fd;
}
.dot {
  margin: 0 0.35rem;
}
.server.online {
  color: #86efac;
}
.server.offline {
  color: #fca5a5;
}
.card {
  padding: 1rem;
  border: 1px solid #334155;
  border-radius: 10px;
  background: #1e293b;
}
.card h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: #94a3b8;
}
.field input,
.field select {
  padding: 0.45rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
  font-size: 0.9rem;
}
.primary {
  width: 100%;
  padding: 0.55rem;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #fff;
  cursor: pointer;
  font-size: 0.95rem;
}
.primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.err {
  margin: 0 0 0.5rem;
  color: #f87171;
  font-size: 0.85rem;
}
</style>
