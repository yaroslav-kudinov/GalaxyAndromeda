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
import { checkServerHealth, createRoom, createRoomFromSave, createRoomFromCatalog, createTutorialRoom, fetchLobbies, fetchRoomBootstrap, GameApiError, joinRoom, type LobbyListEntry } from '~/composables/useGameApi'
import { useCatalogMaps } from '~/composables/useCatalogMaps'
import { gameSaveStorageKey, saveGameSession } from '~/composables/useGameSession'
import { loadPlayerClaim, savePlayerClaim } from '~/composables/usePlayerClaim'
import { bootstrapToLobbySlots, defaultSlotForRoom, joinAsLabel, roomHasFreeSlot } from '~/utils/lobby-slot'
import { loadLobbySaves, upsertLobbySave } from '~/composables/useLobbySaves'
import { usePlayerProfile } from '~/composables/usePlayerProfile'
import {
  boardMarkerKeys,
  mapCellsToBoardCells,
  snapshotToBoardCells,
} from '~/utils/board-adapter'

definePageMeta({
  landing: true,
})

const MAPS_STORAGE_KEY = 'galaxy-maps'
const DRAFT_STORAGE_KEY = 'galaxy-editor-draft'
const TERMS_KEY = 'galaxy-terms-accepted'

const { officialMaps, refreshOfficialMaps, loadOfficialMap } = useCatalogMaps()
const termsAccepted = ref(false)
const termsDraft = ref(false)
const tutorialBusy = ref(false)
const tutorialSetupOpen = ref(false)
const tutorialInDevelopment = false
const menuError = ref<string | null>(null)

interface MapOption {
  optionId: string
  id: string
  name: string
  map: MapDefinition
  fullSave?: GalaxySaveFile
  official?: boolean
}

const importError = ref<string | null>(null)
const importBusy = ref(false)

const router = useRouter()
const { nickname, hasNickname, confirmNickname, resetNickname } = usePlayerProfile()

const landingView = ref<'menu' | 'play'>('menu')

function openPlay() {
  landingView.value = 'play'
}

function backToMenu() {
  landingView.value = 'menu'
}

const nicknameDraft = ref('')
const nicknameError = ref<string | null>(null)
const lobbyReady = ref(false)

const joinRoomId = ref('')
const joinPreview = ref<Awaited<ReturnType<typeof fetchRoomBootstrap>> | null>(null)
const joinPreviewLoading = ref(false)
const joinPreviewError = ref<string | null>(null)
const selectedJoinSlot = ref<string | null>(null)

const selectedMapId = ref('official:duel')
const serverOnline = ref<boolean | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const selectedCreatorSlot = ref<string | null>(null)

const defaultMap = ref<MapDefinition>(normalizeMapDefinition(createEmptyMap('default', 'Default')))
const mapOptions = ref<MapOption[]>([])

let joinPreviewTimer: ReturnType<typeof setTimeout> | null = null

function loadEditorMapsFromStorage(): MapDefinition[] {
  if (!import.meta.client) return []
  try {
    const raw = JSON.parse(localStorage.getItem(MAPS_STORAGE_KEY) ?? '[]') as unknown[]
    if (!Array.isArray(raw)) return []
    return raw.map((entry) => {
      try {
        return normalizeMapDefinition(parseGalaxySave(entry).map)
      } catch {
        return normalizeMapDefinition(entry as MapDefinition)
      }
    })
  } catch {
    return []
  }
}

async function refreshMapList() {
  await refreshOfficialMaps()
  const options: MapOption[] = []
  const localSeen = new Set<string>()

  for (const entry of officialMaps.value) {
    const map = await loadOfficialMap(entry.id)
    if (!map) continue
    options.push({
      optionId: `official:${entry.id}`,
      id: entry.id,
      name: entry.name,
      map,
      official: true,
    })
  }

  if (import.meta.client) {
    try {
      for (const save of loadLobbySaves()) {
        const mapId = save.map.id
        localSeen.add(mapId)
        const label = save.game
          ? `${save.map.name || mapId} (продолжить)`
          : (save.map.name || mapId)
        options.push({
          optionId: `local:${mapId}`,
          id: mapId,
          name: label,
          map: normalizeMapDefinition(save.map),
          fullSave: save,
        })
      }
    } catch {
      /* ignore */
    }

    for (const map of loadEditorMapsFromStorage()) {
      if (localSeen.has(map.id)) continue
      localSeen.add(map.id)
      options.push({
        optionId: `local:${map.id}`,
        id: map.id,
        name: map.name || map.id,
        map,
      })
    }
  }

  mapOptions.value = options
  if (!options.some((o) => o.optionId === selectedMapId.value)) {
    selectedMapId.value =
      options.find((o) => o.optionId === 'official:duel')?.optionId
      ?? options.find((o) => o.official)?.optionId
      ?? options[0]?.optionId
      ?? 'official:duel'
  }
}

const officialMapOptions = computed(() => mapOptions.value.filter((o) => o.official))
const localMapOptions = computed(() => mapOptions.value.filter((o) => !o.official))

const selectedMap = computed(
  () => mapOptions.value.find((o) => o.optionId === selectedMapId.value) ?? null,
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
  if (!termsAccepted.value && !termsDraft.value) {
    nicknameError.value = 'Примите условия использования'
    return
  }
  if (!confirmNickname(nicknameDraft.value)) {
    nicknameError.value = 'Введите никнейм (1–32 символа)'
    return
  }
  if (import.meta.client && termsDraft.value) {
    localStorage.setItem(TERMS_KEY, '1')
    termsAccepted.value = true
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
      selectedMapId.value = `local:${save.map.id}`
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
      const create = option?.official
        ? await createRoomFromCatalog(map.id, Math.min(MAX_LOBBY_PLAYERS, mapMax))
        : await createRoom(map, Math.min(MAX_LOBBY_PLAYERS, mapMax))
      const { roomId, code } = create
      const { playerId } = await joinRoom(roomId, name, preferredPlayerId)
      const save = galaxySaveFromMap(map)
      save.game = gameSnapshotFromMap(map)
      ensurePlayerSlots(save.game, resolveMapPlayerCount(map))
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

const roomList = ref<LobbyListEntry[]>([])
const roomListLoading = ref(false)
const roomListError = ref<string | null>(null)
const enteringListedRoomId = ref<string | null>(null)
let roomListTimer: ReturnType<typeof setInterval> | null = null
let healthTimer: ReturnType<typeof setInterval> | null = null

async function refreshServerHealth() {
  serverOnline.value = await checkServerHealth()
}

function stopHealthPoll() {
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}

function startHealthPoll() {
  stopHealthPoll()
  void refreshServerHealth()
  healthTimer = setInterval(() => {
    void refreshServerHealth()
  }, 5000)
}

function slotsForListedRoom(lobby: LobbyListEntry): LobbyPlayerSlot[] {
  const claim = loadPlayerClaim(lobby.roomId)
  return lobby.players.map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
    joined: player.joined,
    active: player.active,
    bot: player.bot,
    botDifficulty: player.botDifficulty,
    isYou: claim?.playerId === player.id,
  }))
}

function canEnterListedRoom(lobby: LobbyListEntry): boolean {
  const claim = loadPlayerClaim(lobby.roomId)
  if (claim && lobby.players.some((player) => player.id === claim.playerId && player.joined)) return true
  if (lobby.status === 'playing') return false
  return lobby.playerCount < lobby.maxPlayers
}

async function refreshRoomList() {
  if (!serverOnline.value) {
    roomList.value = []
    roomListLoading.value = false
    return
  }
  try {
    const data = await fetchLobbies()
    roomList.value = data.lobbies
    roomListError.value = null
  } catch (e) {
    roomListError.value = e instanceof Error ? e.message : 'Не удалось загрузить список комнат'
  } finally {
    roomListLoading.value = false
  }
}

function stopRoomListPoll() {
  if (roomListTimer) {
    clearInterval(roomListTimer)
    roomListTimer = null
  }
}

function startRoomListPoll() {
  stopRoomListPoll()
  roomListLoading.value = true
  void refreshRoomList()
  roomListTimer = setInterval(() => {
    void refreshRoomList()
  }, 3000)
}

async function enterListedRoom(lobby: LobbyListEntry) {
  enteringListedRoomId.value = lobby.roomId
  error.value = null
  try {
    await router.push(`/game/${lobby.roomId}`)
  } finally {
    enteringListedRoomId.value = null
  }
}

watch(
  () => [landingView.value, serverOnline.value, lobbyReady.value] as const,
  ([view, online, ready]) => {
    if (view === 'play' && online && ready) {
      startRoomListPoll()
      return
    }
    stopRoomListPoll()
  },
)

async function onTutorialClick() {
  if (tutorialInDevelopment) return
  menuError.value = null
  await refreshServerHealth()
  if (!serverOnline.value) {
    menuError.value = 'Сервер недоступен. Запустите pnpm dev и подождите несколько секунд.'
    return
  }
  if (!termsAccepted.value && !termsDraft.value) {
    tutorialSetupOpen.value = true
    if (hasNickname.value) nicknameDraft.value = nickname.value
    return
  }
  const name = nickname.value.trim() || nicknameDraft.value.trim()
  if (!name) {
    tutorialSetupOpen.value = true
    return
  }
  await startTutorial()
}

async function confirmTutorialSetup() {
  menuError.value = null
  if (!termsDraft.value) {
    menuError.value = 'Примите условия использования'
    return
  }
  if (!confirmNickname(nicknameDraft.value)) {
    menuError.value = 'Введите никнейм (1–32 символа)'
    return
  }
  if (import.meta.client) {
    localStorage.setItem(TERMS_KEY, '1')
    termsAccepted.value = true
  }
  tutorialSetupOpen.value = false
  await startTutorial()
}

async function startTutorial() {
  if (!serverOnline.value) {
    await refreshServerHealth()
  }
  if (!serverOnline.value) {
    menuError.value = 'Обучение доступно только при подключении к серверу'
    error.value = menuError.value
    return
  }
  if (!termsAccepted.value && !termsDraft.value) {
    menuError.value = 'Примите условия использования'
    error.value = menuError.value
    return
  }
  const name = nickname.value.trim() || nicknameDraft.value.trim()
  if (!name) {
    menuError.value = 'Введите никнейм'
    error.value = menuError.value
    return
  }
  if (!hasNickname.value) confirmNickname(name)

  tutorialBusy.value = true
  menuError.value = null
  error.value = null
  try {
    const { roomId, code, playerId } = await createTutorialRoom(name)
    if (!playerId) throw new Error('Не удалось создать обучение')
    saveGameSession({ roomId, playerId, playerName: name, code })
    savePlayerClaim({ roomId, playerId, playerName: name })
    if (import.meta.client) localStorage.setItem(TERMS_KEY, '1')
    await router.push(`/game/${roomId}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось начать обучение'
    menuError.value = message
    error.value = message
  } finally {
    tutorialBusy.value = false
  }
}

onMounted(async () => {
  if (import.meta.client) {
    termsAccepted.value = localStorage.getItem(TERMS_KEY) === '1'
    termsDraft.value = termsAccepted.value
  }
  await refreshMapList()
  syncCreatorDefaultSlot()
  startHealthPoll()
  if (hasNickname.value) {
    nicknameDraft.value = nickname.value
    lobbyReady.value = true
  }
})

onUnmounted(() => {
  if (joinPreviewTimer) clearTimeout(joinPreviewTimer)
  stopRoomListPoll()
  stopHealthPoll()
})
</script>

<template>
  <div class="landing">
    <GalaxyBackdrop />
    <LandingMusicControl />

    <div class="landing-center" :class="{ 'landing-center--play': landingView === 'play' }">
      <header class="landing-brand">
        <h1 class="landing-title">Галактика Андромеда</h1>
      </header>

      <div class="landing-body">
      <nav v-if="landingView === 'menu'" class="landing-menu" aria-label="Главное меню">
        <p class="landing-tagline">
          <span>Вооружайся.</span>
          <span>Договаривайся.</span>
          <span>Побеждай.</span>
        </p>

        <div class="landing-nav">
          <button type="button" class="landing-link landing-link--play" @click="openPlay">
            Играть
          </button>
          <button
            type="button"
            class="landing-link"
            :class="{ 'landing-link--wip': tutorialInDevelopment }"
            :disabled="tutorialInDevelopment || tutorialBusy"
            :title="tutorialInDevelopment ? 'В разработке' : undefined"
            @click="onTutorialClick"
          >
            <span>{{ tutorialBusy && !tutorialInDevelopment ? 'Запуск…' : 'Обучение' }}</span>
            <span v-if="tutorialInDevelopment" class="landing-link-sub">В разработке</span>
          </button>
          <section v-if="!tutorialInDevelopment && tutorialSetupOpen" class="card tutorial-gate">
            <p class="gate-lead">Для обучения нужны никнейм и согласие с условиями.</p>
            <label class="field">
              Никнейм
              <input
                v-model="nicknameDraft"
                type="text"
                maxlength="32"
                placeholder="Например, Командор"
                @keydown.enter.prevent="confirmTutorialSetup"
              />
            </label>
            <label class="field terms-field">
              <input v-model="termsDraft" type="checkbox" />
              Я принимаю
              <NuxtLink to="/legal/terms" target="_blank">условия использования</NuxtLink>
              и
              <NuxtLink to="/legal/privacy" target="_blank">политику конфиденциальности</NuxtLink>
            </label>
            <div class="tutorial-gate-actions">
              <button type="button" class="primary" :disabled="tutorialBusy" @click="confirmTutorialSetup">
                Начать обучение
              </button>
              <button type="button" class="secondary" @click="tutorialSetupOpen = false">
                Отмена
              </button>
            </div>
          </section>
          <p v-if="menuError" class="err landing-menu-err">{{ menuError }}</p>
          <NuxtLink class="landing-link" to="/editor">Редактор карт</NuxtLink>
          <NuxtLink class="landing-link" to="/faq">Вопросы и ответы</NuxtLink>
          <NuxtLink class="landing-link" to="/patch-notes">Патчноуты</NuxtLink>
        </div>

        <footer class="landing-footer">
          <p>© 2026 Galaxy Andromeda. Все права защищены.</p>
          <p>
            <NuxtLink to="/legal/terms">Условия использования</NuxtLink>
            ·
            <NuxtLink to="/legal/privacy">Конфиденциальность</NuxtLink>
          </p>
        </footer>

        <p class="landing-meta">
          <span v-if="hasNickname" class="landing-you">Вы: <strong>{{ nickname }}</strong></span>
          <span class="server" :class="{ online: serverOnline, offline: serverOnline === false }">
            {{
              serverOnline === null
                ? 'Сервер…'
                : serverOnline
                  ? 'Сервер доступен'
                  : 'Сервер недоступен — локальная игра'
            }}
          </span>
        </p>
      </nav>

      <div v-else class="landing-play">
        <div class="lobby-topbar">
          <button type="button" class="landing-back" @click="backToMenu">← К меню</button>
          <template v-if="lobbyReady">
            <span class="you-badge">Вы: <strong>{{ nickname }}</strong></span>
            <button type="button" class="linkish" @click="changeNickname">Сменить никнейм</button>
          </template>
          <span
            class="server"
            :class="{ online: serverOnline, offline: serverOnline === false }"
          >
            {{ serverOnline === null ? 'Проверяем сервер…' : serverOnline ? 'Сервер доступен' : 'Сервер недоступен — игра на одном устройстве' }}
          </span>
        </div>

        <div class="lobby-page">
    <section v-if="!lobbyReady" class="nickname-gate card">
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

      <label class="field terms-field">
        <input v-model="termsDraft" type="checkbox" />
        Я принимаю
        <NuxtLink to="/legal/terms" target="_blank">условия использования</NuxtLink>
        и
        <NuxtLink to="/legal/privacy" target="_blank">политику конфиденциальности</NuxtLink>
      </label>

      <p v-if="nicknameError" class="err">{{ nicknameError }}</p>

      <button type="button" class="primary" @click="enterLobby">
        Войти в лобби
      </button>

    </section>

    <div v-else class="lobby">
      <section class="card">
        <h2>Новая игра</h2>

        <label class="field">
          Карта
          <select v-model="selectedMapId">
            <optgroup v-if="officialMapOptions.length" label="Предустановленные на сервере">
              <option v-for="m in officialMapOptions" :key="m.optionId" :value="m.optionId">{{ m.name }}</option>
            </optgroup>
            <optgroup v-if="localMapOptions.length" label="Сохранённые локально">
              <option v-for="m in localMapOptions" :key="m.optionId" :value="m.optionId">{{ m.name }}</option>
            </optgroup>
          </select>
        </label>

        <label v-if="isContinueSave && continuePlayerOptions.length && !serverOnline" class="field">
          Играть за
          <select v-model="continuePlayerId">
            <option v-for="p in continuePlayerOptions" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
        </label>

        <p v-if="isContinueSave && serverOnline" class="hint">
          Игра по сети: выберите слот, за который войдёте в созданную комнату (до {{ MAX_LOBBY_PLAYERS }} игроков).
          <span v-if="savePlayerCount > MAX_LOBBY_PLAYERS">
            В сохранении {{ savePlayerCount }} игроков — по сети участвуют первые {{ MAX_LOBBY_PLAYERS }}.
          </span>
        </p>
        <p v-else-if="isContinueSave" class="hint">
          Игра на одном устройстве: можно выбрать любого участника сохранения.
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
          <div class="map-preview-frame">
            <HexBoard
              class="map-preview"
              style="position: relative; inset: auto; height: 220px; max-height: 220px; overflow: hidden"
              mode="game"
              :cells="previewBoardCells"
              :ghosts="[]"
              :selected-key="null"
              :action-marker-keys="previewMarkerKeys"
              :territory-label-players="previewTerritoryPlayers"
              :auto-fit-on-map-change="true"
              :zoomable="false"
              :show-orientation-toggle="false"
              :show-auto-fit-toggle="false"
              :fill-viewport="false"
              toolbar-placement="inline"
            />
          </div>
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
                : `Создать комнату (до ${MAX_LOBBY_PLAYERS} игроков)`
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
          {{ busy ? 'Вход…' : joinAsLabel(nickname, selectedJoinSlot) }}
        </button>
      </section>

      <section v-if="serverOnline" class="card card--rooms">
        <h2>Открытые комнаты</h2>
        <p class="hint">Войдите в комнату со свободным местом или вернитесь в свою.</p>
        <p v-if="roomListError" class="err">{{ roomListError }}</p>
        <p v-else-if="roomListLoading && !roomList.length" class="preview-hint">Загрузка списка…</p>
        <p v-else-if="!roomList.length" class="hint">Пока нет открытых комнат — создайте новую выше.</p>
        <ul v-else class="room-list">
          <li v-for="lobby in roomList" :key="lobby.roomId" class="room-card">
            <div class="room-head">
              <div>
                <h3 class="preview-title">{{ lobby.mapName }}</h3>
                <p class="room-meta">
                  {{
                    lobby.status === 'lobby'
                      ? 'Подготовка'
                      : `Ход ${lobby.turnNumber}`
                  }}
                  <span v-if="lobby.code"> · код {{ lobby.code }}</span>
                </p>
              </div>
              <div class="room-actions">
                <span class="preview-count">{{ lobby.playerCount }}/{{ lobby.maxPlayers }}</span>
                <button
                  v-if="canEnterListedRoom(lobby)"
                  type="button"
                  class="secondary room-enter"
                  :disabled="enteringListedRoomId === lobby.roomId"
                  @click="enterListedRoom(lobby)"
                >
                  {{ enteringListedRoomId === lobby.roomId ? 'Переход…' : 'Войти' }}
                </button>
                <span v-else class="room-full">Комната заполнена</span>
              </div>
            </div>
            <LobbyPlayerList :slots="slotsForListedRoom(lobby)" compact />
          </li>
        </ul>
      </section>
        </div><!-- .lobby -->
        </div><!-- .lobby-page -->
      </div><!-- .landing-play -->
      </div><!-- .landing-body -->
    </div><!-- .landing-center -->
  </div><!-- .landing -->
</template>

<style scoped>
.landing {
  position: relative;
  z-index: 1;
  isolation: isolate;
  min-height: 100dvh;
  overflow: visible;
}

.landing-center {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  height: auto;
  overflow: visible;
  padding: 5.5rem 1.25rem 9rem;
}

.landing-center--play {
  justify-content: flex-start;
  min-height: 100dvh;
  height: auto;
  max-height: none;
  overflow: visible;
  padding: 9.85rem 1.25rem 3rem;
}

.landing-body {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.landing-brand {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: max-content;
  max-width: calc(100vw - 1.5rem);
  margin: 0 auto 1.2rem;
  padding: 0.45rem 0.95rem 0.5rem;
  border-radius: 16px;
  background: #02061773;
  box-shadow: 0 0 40px #02061788;
  text-align: center;
  backdrop-filter: blur(8px);
  transform: none;
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.landing-center--play .landing-brand {
  position: absolute;
  top: 4.35rem;
  left: 50%;
  margin: 0;
  padding: 0.32rem 0.9rem 0.36rem;
  transform: translate(-50%, 0);
}

.landing-title {
  margin: 0;
  font-family: Orbitron, Manrope, system-ui, sans-serif;
  font-size: clamp(0.95rem, 4.4vw, 2.35rem);
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  color: #e8f1ff;
  text-shadow:
    0 0 22px #3b82f68a,
    0 0 48px #1d4ed866,
    0 2px 14px #000000cc;
  animation: landing-title-twinkle 4.8s ease-in-out infinite;
}

@keyframes landing-title-twinkle {
  0%,
  100% {
    opacity: 1;
    text-shadow:
      0 0 18px #3b82f66e,
      0 0 40px #1d4ed855,
      0 2px 14px #000000cc;
  }
  42% {
    opacity: 0.8;
    text-shadow:
      0 0 8px #3b82f633,
      0 0 18px #1d4ed822,
      0 2px 12px #000000cc;
  }
  58% {
    opacity: 1;
    text-shadow:
      0 0 28px #93c5fdb3,
      0 0 56px #3b82f67a,
      0 2px 14px #000000cc;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-brand {
    transition: none;
  }
  .landing-title {
    animation: none;
  }
}

.landing-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(22rem, 92vw);
  margin-top: 0;
  text-align: center;
}

.landing-tagline {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.15rem 0.85rem;
  margin: 0.35rem 0 0.15rem;
  max-width: 26rem;
  color: #e8eef8;
  font-size: clamp(1.02rem, 2.6vw, 1.18rem);
  font-weight: 600;
  letter-spacing: 0.07em;
  line-height: 1.4;
  text-shadow:
    0 0 14px #67e8f655,
    0 0 28px #fde68a33,
    0 1px 10px #000000cc;
}

.landing-tagline span {
  position: relative;
  padding: 0 0.05rem 0.32rem;
}

.landing-tagline span::after {
  content: '';
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, #fde68aaa 35%, #7dd3fcbb 65%, transparent);
}

.landing-nav {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 0.7rem;
  margin: 1.6rem 0 1.2rem;
}

.landing-link {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 0.88rem 1.1rem;
  border: 1px solid #64748b99;
  border-radius: 12px;
  background: #0f172ae6;
  color: #f8fafc;
  font-family: Manrope, system-ui, sans-serif;
  font-size: 1.02rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.landing-link:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #1e293bf2;
}

.landing-link:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.landing-link--wip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  line-height: 1.25;
}

.landing-link-sub {
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #94a3b8;
}

.landing-menu-err {
  margin: 0;
  text-align: center;
}

.tutorial-gate {
  margin-top: 0.25rem;
  padding: 1rem 1.1rem;
  text-align: left;
}

.tutorial-gate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin-top: 0.75rem;
}

.landing-link--play {
  border-color: #3b82f6cc;
  background: #1d4ed8e6;
}

.landing-link--play:hover {
  border-color: #93c5fd;
  background: #2563ebe6;
}

.landing-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  color: #94a3b8;
  font-size: 0.82rem;
  line-height: 1.4;
}

.landing-you strong {
  color: #f8fafc;
}

.landing-play {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  width: min(32rem, calc(100vw - 1.5rem));
  margin: 0 auto;
  flex: 0 0 auto;
  overflow: visible;
  max-height: none;
}

.landing-back {
  position: relative;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--g-border-strong);
  border-radius: var(--g-r-pill);
  background: var(--g-surface-1);
  color: var(--g-text);
  font-size: var(--g-text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.landing-back:hover {
  border-color: var(--g-accent);
  background: var(--g-surface-2);
}

.landing .card {
  background: #1e293bf5;
  box-shadow: 0 12px 40px #00000073;
  overflow: visible;
  height: auto;
  max-height: none;
  flex-shrink: 0;
  color: #e2e8f0;
}

.lobby-page,
.lobby {
  max-width: 32rem;
  margin: 0 auto;
  overflow: visible;
  height: auto;
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
  font-size: var(--g-text-sm);
  color: var(--g-text-dim);
}
.you-badge strong {
  color: #f8fafc;
}
.linkish {
  padding: 0;
  border: none;
  background: none;
  color: #93c5fd;
  font-size: var(--g-text-xs);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
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
.lobby-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
  width: min(100%, 44rem);
  margin: 0 auto var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-border);
  border-radius: var(--g-r-pill);
  background: var(--g-surface-glass);
  box-shadow: var(--g-shadow-1);
}
.lobby-topbar .server {
  margin-left: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin-bottom: var(--g-s-3);
  font-size: var(--g-text-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--g-text-dim);
}
/* Системный вид выпадающего списка выбивался из тёмного оформления */
.field select {
  appearance: none;
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 0.6rem;
  border: 1px solid var(--g-border-strong);
  border-radius: var(--g-r-md);
  background-color: var(--g-surface-0);
  background-image: linear-gradient(45deg, transparent 50%, var(--g-text-dim) 50%),
    linear-gradient(135deg, var(--g-text-dim) 50%, transparent 50%);
  background-position: calc(100% - 1rem) 55%, calc(100% - 0.7rem) 55%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  color: var(--g-text-strong);
  font: inherit;
  font-size: var(--g-text-sm);
  font-weight: 500;
  cursor: pointer;
}
.field select:hover {
  border-color: var(--g-accent);
}
.field select:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 1px;
}
.field select optgroup {
  color: var(--g-text-dim);
  font-weight: 600;
  background: var(--g-surface-0);
}
.field select option {
  color: var(--g-text-strong);
  background: var(--g-surface-0);
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
  font-size: var(--g-text-sm);
  color: var(--g-text-dim);
}
.import-field input[type='file']::file-selector-button {
  margin-right: var(--g-s-3);
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--g-border-strong);
  border-radius: var(--g-r-md);
  background: var(--g-surface-1);
  color: var(--g-text);
  font: inherit;
  font-size: var(--g-text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.import-field input[type='file']::file-selector-button:hover {
  border-color: var(--g-accent);
  background: var(--g-surface-2);
}
.card--join {
  margin-top: 1rem;
}
.card--rooms {
  margin-top: 1rem;
}
.room-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.room-card {
  padding: 0.65rem 0.7rem;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0f172acc;
}
.room-head {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 0.45rem;
}
.room-meta {
  margin: 0.15rem 0 0;
  color: #94a3b8;
  font-size: 0.75rem;
}
.room-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  flex-shrink: 0;
}
.room-enter {
  width: auto;
  padding: 0.32rem 0.65rem;
  font-size: 0.8rem;
}
.room-full {
  font-size: 0.75rem;
  color: #94a3b8;
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
.map-preview-frame {
  position: relative;
  z-index: 0;
  isolation: isolate;
  contain: layout;
  box-sizing: border-box;
  width: 100%;
  height: 220px;
  max-height: 220px;
  margin-bottom: 0.65rem;
  overflow: hidden;
  border-radius: 8px;
}
.map-preview-frame :deep(.hex-board-wrap) {
  position: relative !important;
  inset: auto !important;
  width: 100%;
  height: 220px;
  max-height: 220px;
  overflow: hidden;
}
.map-preview-frame :deep(.hex-board) {
  display: block;
  width: 100%;
  height: 220px !important;
  min-height: 0;
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
