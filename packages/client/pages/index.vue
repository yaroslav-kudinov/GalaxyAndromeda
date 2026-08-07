<script setup lang="ts">
import {
  createEmptyMap,
  galaxySaveFromMap,
  gameSnapshotFromMap,
  MAX_LOBBY_PLAYERS,
  ensurePlayerSlots,
  normalizeMapDefinition,
  parseGalaxySave,
  resolveMapPlayerCount,
  serializeGalaxySave,
  type GalaxySaveFile,
  type MapDefinition,
} from '@galaxy/rules'
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'
import { checkServerHealth, createRoom, createRoomFromSave, fetchRoomBootstrap, GameApiError, joinRoom } from '~/composables/useGameApi'
import { gameSaveStorageKey, saveGameSession } from '~/composables/useGameSession'
import { savePlayerClaim } from '~/composables/usePlayerClaim'
import { bootstrapToLobbySlots, defaultSlotForRoom, roomHasFreeSlot } from '~/utils/lobby-slot'
import { loadLobbySaves, upsertLobbySave } from '~/composables/useLobbySaves'
import { usePlayerProfile } from '~/composables/usePlayerProfile'
import {
  boardMarkerKeys,
  mapCellsToBoardCells,
  snapshotToBoardCells,
} from '~/utils/board-adapter'

const MAPS_STORAGE_KEY = 'galaxy-maps'
const DRAFT_STORAGE_KEY = 'galaxy-editor-draft'

interface MapOption {
  id: string
  name: string
  map: MapDefinition
  fullSave?: GalaxySaveFile
}

const importError = ref<string | null>(null)
const importBusy = ref(false)

const router = useRouter()
const { nickname, hasNickname, confirmNickname, resetNickname } = usePlayerProfile()

const nicknameDraft = ref('')
const nicknameError = ref<string | null>(null)
const lobbyReady = ref(false)

const joinRoomId = ref('')
const joinPreview = ref<Awaited<ReturnType<typeof fetchRoomBootstrap>> | null>(null)
const joinPreviewLoading = ref(false)
const joinPreviewError = ref<string | null>(null)
const selectedJoinSlot = ref<string | null>(null)

const selectedMapId = ref('default')
const serverOnline = ref<boolean | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const selectedCreatorSlot = ref<string | null>(null)

const defaultMap = ref<MapDefinition>(normalizeMapDefinition(createEmptyMap('default', 'Default')))
const mapOptions = ref<MapOption[]>([])

let joinPreviewTimer: ReturnType<typeof setTimeout> | null = null

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
      for (const save of loadLobbySaves()) {
        if (seen.has(save.map.id)) continue
        seen.add(save.map.id)
        const label = save.game
          ? `${save.map.name || save.map.id} (продолжить)`
          : (save.map.name || save.map.id)
        options.push({
          id: save.map.id,
          name: label,
          map: normalizeMapDefinition(save.map),
          fullSave: save,
        })
      }

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
  () => mapOptions.value.find((o) => o.id === selectedMapId.value) ?? null,
)

const selectedMapDefinition = computed(
  () => selectedMap.value?.map ?? defaultMap.value,
)

/** Клетки превью: из снимка партии (контроль, флот, маркеры), иначе стартовая карта */
const previewBoardCells = computed(() => {
  const game = selectedMap.value?.fullSave?.game
  if (game) return snapshotToBoardCells(game)
  return mapCellsToBoardCells(selectedMapDefinition.value.cells)
})

const previewMarkerKeys = computed(() => boardMarkerKeys(previewBoardCells.value))

const isContinueSave = computed(() => Boolean(selectedMap.value?.fullSave?.game))

const savePlayerCount = computed(() => {
  const fullSave = selectedMap.value?.fullSave
  if (fullSave?.game?.players.length) return fullSave.game.players.length
  return resolveMapPlayerCount(selectedMapDefinition.value)
})

const continuePlayerOptions = computed(() => {
  const game = selectedMap.value?.fullSave?.game
  if (!game) return []
  const participating = game.participatingPlayerIds?.length
    ? game.participatingPlayerIds
    : game.players.map((p) => p.id)
  return game.players.filter((p) => participating.includes(p.id))
})

const continuePlayerId = ref('player-1')

const creatorMaxPlayers = computed(() => {
  const mapMax = resolveMapPlayerCount(selectedMapDefinition.value)
  const savePlayers = selectedMap.value?.fullSave?.game?.players.length
  return Math.min(MAX_LOBBY_PLAYERS, mapMax, savePlayers ?? mapMax)
})

const creatorSlots = computed((): LobbyPlayerSlot[] => {
  const savedPlayers = selectedMap.value?.fullSave?.game?.players
  const players = savedPlayers ?? gameSnapshotFromMap(selectedMapDefinition.value).players
  return players.slice(0, creatorMaxPlayers.value).map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
    joined: false,
  }))
})

const previewTerritoryPlayers = computed(() =>
  creatorSlots.value.map((player, index) => ({
    slot: index + 1,
    name: player.name,
    color: player.color,
  })),
)

const joinPreviewSlots = computed((): LobbyPlayerSlot[] => {
  const preview = joinPreview.value
  if (!preview) return []
  return bootstrapToLobbySlots(preview)
})

const joinPreviewFull = computed(() => {
  const preview = joinPreview.value
  if (!preview) return false
  return !roomHasFreeSlot(preview)
})

function syncJoinPreviewDefaultSlot() {
  const preview = joinPreview.value
  const id = joinRoomId.value.trim()
  if (!preview || !id) {
    selectedJoinSlot.value = null
    return
  }
  selectedJoinSlot.value = defaultSlotForRoom(id, preview)
}

function syncCreatorDefaultSlot() {
  if (!creatorSlots.value.some((slot) => slot.id === selectedCreatorSlot.value)) {
    selectedCreatorSlot.value = creatorSlots.value[0]?.id ?? null
  }
}

function enterLobby() {
  nicknameError.value = null
  if (!confirmNickname(nicknameDraft.value)) {
    nicknameError.value = 'Введите никнейм (1–32 символа)'
    return
  }
  lobbyReady.value = true
}

function changeNickname() {
  resetNickname()
  nicknameDraft.value = ''
  lobbyReady.value = false
}

async function refreshJoinPreview() {
  const id = joinRoomId.value.trim()
  if (!id || !serverOnline.value) {
    joinPreview.value = null
    joinPreviewError.value = null
    return
  }

  joinPreviewLoading.value = true
  joinPreviewError.value = null
  try {
    joinPreview.value = await fetchRoomBootstrap(id)
    syncJoinPreviewDefaultSlot()
  } catch {
    joinPreview.value = null
    joinPreviewError.value = 'Комната не найдена'
  } finally {
    joinPreviewLoading.value = false
  }
}

watch(joinRoomId, () => {
  if (joinPreviewTimer) clearTimeout(joinPreviewTimer)
  joinPreviewTimer = setTimeout(refreshJoinPreview, 350)
})

watch(selectedMapId, () => {
  const players = continuePlayerOptions.value
  if (players.length) {
    const active = selectedMap.value?.fullSave?.game?.activePlayerId
    continuePlayerId.value = active && players.some((p) => p.id === active)
      ? active
      : players[0].id
  }
  syncCreatorDefaultSlot()
})

function importSaveFile(event: Event) {
  importError.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importBusy.value = true
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const save = parseGalaxySave(JSON.parse(String(reader.result)))
      upsertLobbySave(save)
      refreshMapList()
      selectedMapId.value = save.map.id
      importError.value = null
    } catch (e) {
      importError.value = e instanceof Error ? e.message : 'Не удалось прочитать файл сохранения'
    } finally {
      importBusy.value = false
    }
  }
  reader.onerror = () => {
    importError.value = 'Не удалось прочитать файл'
    importBusy.value = false
  }
  reader.readAsText(file)
  input.value = ''
}

async function startGame() {
  error.value = null
  busy.value = true
  try {
    const option = selectedMap.value
    const fullSave = option?.fullSave

    if (fullSave?.game) {
      const save = parseGalaxySave(JSON.parse(serializeGalaxySave(fullSave)))
      const name = nickname.value.trim() || 'Игрок'

      if (serverOnline.value) {
        const { roomId, code } = await createRoomFromSave(save, MAX_LOBBY_PLAYERS)
        const preferredPlayerId = selectedCreatorSlot.value
        if (!preferredPlayerId) {
          error.value = 'Выберите слот'
          return
        }
        const { playerId } = await joinRoom(roomId, name, preferredPlayerId)
        localStorage.setItem(gameSaveStorageKey(roomId), serializeGalaxySave(save))
        saveGameSession({ roomId, playerId, playerName: name, code })
        savePlayerClaim({ roomId, playerId, playerName: name })
        await router.push(`/game/${roomId}`)
        return
      }

      const offlineId = `local-${Date.now()}`
      localStorage.setItem(gameSaveStorageKey(offlineId), serializeGalaxySave(save))
      const playerId = continuePlayerId.value || save.game!.activePlayerId || 'player-1'
      const playerName =
        save.game!.players.find((p) => p.id === playerId)?.name
        ?? (nickname.value.trim() || 'Игрок')
      saveGameSession({
        roomId: offlineId,
        playerId,
        playerName,
      })
      await router.push(`/game/${offlineId}`)
      return
    }

    const map = normalizeMapDefinition(JSON.parse(JSON.stringify(selectedMapDefinition.value)) as MapDefinition)
    const name = nickname.value.trim() || 'Игрок'
    const preferredPlayerId = selectedCreatorSlot.value
    if (!preferredPlayerId) {
      error.value = 'Выберите слот'
      return
    }

    if (serverOnline.value) {
      const mapMax = resolveMapPlayerCount(map)
      const { roomId, code } = await createRoom(map, Math.min(MAX_LOBBY_PLAYERS, mapMax))
      const { playerId } = await joinRoom(roomId, name, preferredPlayerId)
      const save = galaxySaveFromMap(map)
      save.game = gameSnapshotFromMap(map)
      ensurePlayerSlots(save.game, resolveMapPlayerCount(map))
      localStorage.setItem(gameSaveStorageKey(roomId), serializeGalaxySave(save))
      saveGameSession({ roomId, playerId, playerName: name, code })
      savePlayerClaim({ roomId, playerId, playerName: name })
      await router.push(`/game/${roomId}`)
      return
    }

    const offlineId = `local-${Date.now()}`
    const save = galaxySaveFromMap(map)
    save.game = gameSnapshotFromMap(map)
    const mapMax = resolveMapPlayerCount(map)
    ensurePlayerSlots(save.game, mapMax)
    save.game.participatingPlayerIds = save.game.players
      .slice(0, mapMax)
      .map((p) => p.id)
    const localPlayer = save.game.players.find((player) => player.id === preferredPlayerId)
    if (localPlayer) {
      localPlayer.name = name
      localPlayer.isAi = false
    }
    save.game.activePlayerId = preferredPlayerId
    localStorage.setItem(gameSaveStorageKey(offlineId), serializeGalaxySave(save))
    saveGameSession({
      roomId: offlineId,
      playerId: preferredPlayerId,
      playerName: name,
    })
    await router.push(`/game/${offlineId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось создать игру'
  } finally {
    busy.value = false
  }
}

async function joinExistingGame() {
  error.value = null
  busy.value = true
  try {
    const id = joinRoomId.value.trim()
    if (!id) {
      error.value = 'Укажите ID комнаты'
      return
    }
    if (!serverOnline.value) {
      error.value = 'Сервер недоступен — нужен online для мультиплеера'
      return
    }
    if (!selectedJoinSlot.value) {
      error.value = joinPreviewFull.value ? 'Комната заполнена' : 'Выберите слот'
      return
    }
    const name = nickname.value.trim() || 'Игрок'
    const { playerId, code } = await joinRoom(id, name, selectedJoinSlot.value)
    saveGameSession({ roomId: id, playerId, playerName: name, code })
    savePlayerClaim({ roomId: id, playerId, playerName: name })
    await router.push(`/game/${id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось войти в комнату'
    if (e instanceof GameApiError && e.availablePlayerIds?.length) {
      await refreshJoinPreview()
    }
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadBundledDefaultMap()
  refreshMapList()
  syncCreatorDefaultSlot()
  serverOnline.value = await checkServerHealth()
  if (hasNickname.value) {
    nicknameDraft.value = nickname.value
    lobbyReady.value = true
  }
})

onUnmounted(() => {
  if (joinPreviewTimer) clearTimeout(joinPreviewTimer)
})
</script>

<template>
  <div class="lobby-page">
    <section v-if="!lobbyReady" class="nickname-gate card">
      <h1>Galaxy Andromeda</h1>
      <p class="gate-lead">Выберите никнейм — он будет виден другим игрокам в комнате.</p>

      <label class="field">
        Никнейм
        <input
          v-model="nicknameDraft"
          type="text"
          maxlength="32"
          placeholder="Например, Командор"
          autofocus
          @keydown.enter.prevent="enterLobby"
        />
      </label>

      <p v-if="nicknameError" class="err">{{ nicknameError }}</p>

      <button type="button" class="primary" @click="enterLobby">
        Войти в лобби
      </button>

      <p class="gate-foot">
        <NuxtLink to="/editor">Редактор карт</NuxtLink>
        <span class="dot">·</span>
        <span class="server" :class="{ online: serverOnline, offline: serverOnline === false }">
          {{ serverOnline === null ? '…' : serverOnline ? 'Сервер online' : 'Offline' }}
        </span>
      </p>
    </section>

    <div v-else class="lobby">
      <header class="lobby-header">
        <h1>Galaxy Andromeda</h1>
        <p class="you-line">
          <span class="you-badge">Вы: <strong>{{ nickname }}</strong></span>
          <button type="button" class="linkish" @click="changeNickname">Сменить никнейм</button>
        </p>
        <p>
          <NuxtLink to="/editor">Редактор карт</NuxtLink>
          <span class="dot">·</span>
          <NuxtLink to="/lobbies">Список лобби</NuxtLink>
          <span class="dot">·</span>
          <span class="server" :class="{ online: serverOnline, offline: serverOnline === false }">
            {{ serverOnline === null ? '…' : serverOnline ? 'Сервер online' : 'Offline — локальная игра' }}
          </span>
        </p>
      </header>

      <section class="card">
        <h2>Новая игра</h2>

        <label class="field">
          Карта
          <select v-model="selectedMapId">
            <option v-for="m in mapOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>

        <label v-if="isContinueSave && continuePlayerOptions.length && !serverOnline" class="field">
          Играть за
          <select v-model="continuePlayerId">
            <option v-for="p in continuePlayerOptions" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.id }})
            </option>
          </select>
        </label>

        <p v-if="isContinueSave && serverOnline" class="hint">
          Online: выберите слот, за который войдёте в созданную комнату (до {{ MAX_LOBBY_PLAYERS }} игроков).
          <span v-if="savePlayerCount > MAX_LOBBY_PLAYERS">
            В сохранении {{ savePlayerCount }} игроков — в online участвуют первые {{ MAX_LOBBY_PLAYERS }}.
          </span>
        </p>
        <p v-else-if="isContinueSave" class="hint">
          Offline: можно выбрать любого участника сохранения.
        </p>

        <label class="field import-field">
          Импорт .galaxy.json
          <input
            type="file"
            accept="application/json,.json,.galaxy.json"
            :disabled="importBusy"
            @change="importSaveFile"
          />
        </label>
        <p v-if="importError" class="err">{{ importError }}</p>

        <div v-if="previewBoardCells.length" class="preview-block">
          <h3 class="preview-title">
            {{ isContinueSave ? 'Текущее состояние карты' : 'Карта и стартовая позиция' }}
          </h3>
          <HexBoard
            class="map-preview"
            mode="game"
            :cells="previewBoardCells"
            :ghosts="[]"
            :selected-key="null"
            :action-marker-keys="previewMarkerKeys.action"
            :production-marker-keys="previewMarkerKeys.production"
            :territory-label-players="previewTerritoryPlayers"
            :auto-fit-on-map-change="true"
            :zoomable="false"
            :show-orientation-toggle="false"
            :show-auto-fit-toggle="false"
            :fill-viewport="false"
          />
          <template v-if="(serverOnline || !isContinueSave) && creatorSlots.length">
            <p class="hint">
              {{
                isContinueSave
                  ? 'Состояние из сохранения (контроль, флот, маркеры). Выберите слот для входа.'
                  : 'Выберите свободную стартовую позицию на этой карте.'
              }}
            </p>
            <LobbySlotPicker v-model="selectedCreatorSlot" :slots="creatorSlots" :disabled="busy" />
          </template>
          <p v-else-if="isContinueSave" class="hint">
            Состояние из сохранения (контроль, флот, маркеры).
          </p>
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <button type="button" class="primary" :disabled="busy" @click="startGame">
          {{
            busy
              ? 'Запуск…'
              : isContinueSave
                ? serverOnline
                  ? `Создать комнату из сохранения (до ${MAX_LOBBY_PLAYERS} игроков)`
                  : 'Продолжить игру (offline)'
                : `Создать игру (до ${MAX_LOBBY_PLAYERS} игроков)`
          }}
        </button>
      </section>

      <section v-if="serverOnline" class="card card--join">
        <h2>Присоединиться</h2>
        <p class="hint">
          Вставьте ID комнаты из ссылки хоста (<code>/game/…</code>).
        </p>

        <label class="field">
          ID комнаты
          <input v-model="joinRoomId" type="text" placeholder="uuid комнаты" />
        </label>

        <div v-if="joinPreviewLoading" class="preview-hint">Загрузка состава…</div>
        <p v-else-if="joinPreviewError" class="err">{{ joinPreviewError }}</p>

        <div v-if="joinPreview && joinPreviewSlots.length" class="preview-block">
          <h3 class="preview-title">
            Выберите слот
            <span class="preview-count">{{ joinPreview.playerCount }}/{{ joinPreview.maxPlayers }}</span>
          </h3>
          <LobbySlotPicker
            v-model="selectedJoinSlot"
            :slots="joinPreviewSlots"
            :disabled="busy || joinPreviewFull"
          />
          <p v-if="joinPreviewFull" class="err">Все слоты заняты.</p>
        </div>

        <button
          type="button"
          class="secondary"
          :disabled="busy || !joinRoomId.trim() || joinPreviewLoading || !!joinPreviewError || !selectedJoinSlot || joinPreviewFull"
          @click="joinExistingGame"
        >
          {{ busy ? 'Вход…' : `Войти как ${nickname}` }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lobby-page,
.lobby {
  max-width: 420px;
  margin: 0 auto;
}
.nickname-gate h1 {
  margin: 0 0 0.35rem;
  font-size: 1.5rem;
}
.gate-lead {
  margin: 0 0 1rem;
  color: #94a3b8;
  font-size: 0.88rem;
  line-height: 1.45;
}
.gate-foot {
  margin: 1rem 0 0;
  color: #94a3b8;
  font-size: 0.85rem;
}
.lobby-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.you-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0 0 0.35rem;
}
.you-badge {
  font-size: 0.88rem;
  color: #cbd5e1;
}
.you-badge strong {
  color: #f8fafc;
}
.linkish {
  padding: 0;
  border: none;
  background: none;
  color: #93c5fd;
  font-size: 0.82rem;
  cursor: pointer;
  text-decoration: underline;
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
.secondary {
  width: 100%;
  padding: 0.55rem;
  border-radius: 8px;
  border: 1px solid #475569;
  background: #334155;
  color: #f8fafc;
  cursor: pointer;
  font-size: 0.95rem;
}
.secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.hint {
  margin: 0 0 0.75rem;
  color: #94a3b8;
  font-size: 0.82rem;
  line-height: 1.4;
}
.import-field input[type='file'] {
  font-size: 0.82rem;
  color: #cbd5e1;
}
.card--join {
  margin-top: 1rem;
}
.hint {
  margin: 0 0 0.75rem;
  color: #94a3b8;
  font-size: 0.82rem;
  line-height: 1.4;
}
.hint code {
  color: #cbd5e1;
  font-size: 0.78rem;
}
.preview-block {
  margin-bottom: 0.75rem;
}
.map-preview {
  margin-bottom: 0.65rem;
}
.map-preview :deep(.hex-board) {
  height: 220px;
}
.preview-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #cbd5e1;
}
.preview-count {
  font-weight: 500;
  color: #94a3b8;
}
.preview-hint {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: #64748b;
}
.err {
  margin: 0 0 0.5rem;
  color: #f87171;
  font-size: 0.85rem;
}
</style>
