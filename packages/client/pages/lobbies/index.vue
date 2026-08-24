<script setup lang="ts">
import type { LobbyPlayerSlot } from '~/components/LobbyPlayerList.vue'
import {
  checkServerHealth,
  fetchLobbies,
  type LobbyListEntry,
} from '~/composables/useGameApi'
import { loadAllPlayerClaims, loadPlayerClaim } from '~/composables/usePlayerClaim'

interface DebugLogEntry {
  timestamp: string
  event: string
  [field: string]: unknown
}

const router = useRouter()

const serverOnline = ref<boolean | null>(null)
const lobbies = ref<LobbyListEntry[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const enteringRoomId = ref<string | null>(null)
const debugPanelOpen = ref(false)
const browserLogsEnabled = ref(false)
const loadingServerLogs = ref(false)
const serverLogsError = ref<string | null>(null)
const serverLogs = ref<DebugLogEntry[]>([])
const serverLogRoomId = ref<string | null>(null)
const debugToolsAvailable = import.meta.dev

let pollTimer: ReturnType<typeof setInterval> | null = null

function toggleBrowserLogs() {
  browserLogsEnabled.value = !browserLogsEnabled.value
  localStorage.setItem('galaxy-debug-logs', browserLogsEnabled.value ? '1' : '0')
}

function formatServerLog(entry: DebugLogEntry): string {
  return JSON.stringify(entry)
}

async function showServerLogs(roomId: string) {
  debugPanelOpen.value = true
  serverLogRoomId.value = roomId
  loadingServerLogs.value = true
  serverLogsError.value = null
  try {
    const data = await $fetch<{ logs: DebugLogEntry[] }>('/api/debug/logs', {
      query: { roomId },
    })
    serverLogs.value = data.logs
  } catch {
    serverLogs.value = []
    serverLogsError.value = 'Журнал сервера недоступен. Он работает только в dev-режиме.'
  } finally {
    loadingServerLogs.value = false
  }
}

function serverLogsJsonUrl(roomId: string): string {
  return `/api/debug/logs?roomId=${encodeURIComponent(roomId)}`
}

function slotsForLobby(lobby: LobbyListEntry): LobbyPlayerSlot[] {
  const claim = loadPlayerClaim(lobby.roomId)
  return lobby.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    joined: p.joined,
    active: p.active,
    isYou: claim?.playerId === p.id,
  }))
}

function canEnterLobby(lobby: LobbyListEntry): boolean {
  const claim = loadPlayerClaim(lobby.roomId)
  if (claim && lobby.players.some((p) => p.id === claim.playerId && p.joined)) return true
  if (lobby.status === 'playing') return false
  return lobby.playerCount < lobby.maxPlayers
}

async function enterLobby(lobby: LobbyListEntry) {
  enteringRoomId.value = lobby.roomId
  error.value = null
  try {
    await router.push(`/game/${lobby.roomId}`)
  } finally {
    enteringRoomId.value = null
  }
}

async function refreshLobbies() {
  if (!serverOnline.value) return
  try {
    const data = await fetchLobbies()
    lobbies.value = data.lobbies
    error.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить список лобби'
  } finally {
    loading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(refreshLobbies, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const myClaims = computed(() => {
  if (!import.meta.client) return []
  const all = loadAllPlayerClaims()
  return Object.values(all)
})

onMounted(async () => {
  browserLogsEnabled.value = localStorage.getItem('galaxy-debug-logs') === '1'
  serverOnline.value = await checkServerHealth()
  if (serverOnline.value) {
    await refreshLobbies()
    startPolling()
  } else {
    loading.value = false
  }
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="lobbies-page">
    <header class="page-header">
      <h1>Активные лобби</h1>
      <p class="lead">
        Игрок <strong>активен</strong>, если у него открыта страница игры.
        В любую комнату со свободным слотом можно войти — на странице игры выберите место.
      </p>
      <p class="nav-links">
        <NuxtLink to="/">← Главное лобби</NuxtLink>
        <span class="dot">·</span>
        <span class="server" :class="{ online: serverOnline, offline: serverOnline === false }">
          {{ serverOnline === null ? '…' : serverOnline ? 'Сервер online' : 'Offline' }}
        </span>
      </p>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="loading" class="hint">Загрузка…</div>

    <div v-else-if="!serverOnline" class="card empty">
      <p>Сервер недоступен — список комнат пуст.</p>
    </div>

    <div v-else-if="!lobbies.length" class="card empty">
      <p>Нет открытых комнат. Создайте игру на <NuxtLink to="/">главной</NuxtLink>.</p>
      <p v-if="myClaims.length" class="claims-hint">
        В этом браузере сохранены слоты для {{ myClaims.length }} комнат — они появятся после перезапуска сервера, если комнаты ещё живы.
      </p>
    </div>

    <ul v-else class="lobby-list">
      <li v-for="lobby in lobbies" :key="lobby.roomId" class="card lobby-card">
        <div class="lobby-head">
          <div>
            <h2>{{ lobby.mapName }}</h2>
            <p class="lobby-meta">
              {{
                lobby.status === 'lobby'
                  ? 'Подготовка'
                  : `Ход ${lobby.turnNumber} · ${lobby.phase}`
              }}
              <span v-if="lobby.code"> · код {{ lobby.code }}</span>
            </p>
            <p class="lobby-id">{{ lobby.roomId }}</p>
          </div>
          <div class="lobby-actions">
            <span class="count">{{ lobby.playerCount }}/{{ lobby.maxPlayers }}</span>
            <template v-if="canEnterLobby(lobby)">
              <button
                type="button"
                class="enter-btn"
                :disabled="enteringRoomId === lobby.roomId"
                @click="enterLobby(lobby)"
              >
                {{ enteringRoomId === lobby.roomId ? 'Переход…' : 'Войти' }}
              </button>
            </template>
            <span v-else class="full-label">Комната заполнена</span>
            <button
              v-if="debugToolsAvailable"
              type="button"
              class="debug-room-btn"
              @click="showServerLogs(lobby.roomId)"
            >
              Логи сервера
            </button>
          </div>
        </div>

        <LobbyPlayerList :slots="slotsForLobby(lobby)" compact />
      </li>
    </ul>

    <section v-if="debugToolsAvailable" class="debug-tools" :class="{ open: debugPanelOpen }">
      <button
        type="button"
        class="debug-toggle"
        :aria-expanded="debugPanelOpen"
        @click="debugPanelOpen = !debugPanelOpen"
      >
        {{ debugPanelOpen ? 'Скрыть отладку' : 'Отладка' }}
      </button>
      <div v-if="debugPanelOpen" class="debug-panel">
        <div class="debug-panel-head">
          <div>
            <strong>Отладка лобби</strong>
            <span v-if="serverLogRoomId" class="debug-room-id">{{ serverLogRoomId }}</span>
          </div>
          <button type="button" class="debug-browser-btn" @click="toggleBrowserLogs">
            {{ browserLogsEnabled ? 'Выключить логи в браузере' : 'Включить логи в браузере' }}
          </button>
        </div>
        <p class="debug-hint">Логи браузера выводятся в консоль DevTools.</p>
        <div v-if="serverLogRoomId" class="server-log-view">
          <div class="server-log-head">
            <strong>Логи сервера</strong>
            <a :href="serverLogsJsonUrl(serverLogRoomId)" target="_blank" rel="noopener">Открыть JSON</a>
          </div>
          <p v-if="loadingServerLogs" class="debug-hint">Загрузка журнала…</p>
          <p v-else-if="serverLogsError" class="debug-error">{{ serverLogsError }}</p>
          <p v-else-if="!serverLogs.length" class="debug-hint">Для этой комнаты записей пока нет.</p>
          <pre v-else class="server-logs">{{ serverLogs.map(formatServerLog).join('\n') }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lobbies-page {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.25rem 1rem 5rem;
  color: #e2e8f0;
}
.page-header h1 {
  margin: 0 0 0.5rem;
  font-size: 1.35rem;
}
.lead {
  margin: 0 0 0.75rem;
  font-size: 0.88rem;
  color: #94a3b8;
  line-height: 1.45;
}
.nav-links {
  margin: 0;
  font-size: 0.85rem;
}
.nav-links a {
  color: #93c5fd;
}
.dot {
  margin: 0 0.35rem;
  color: #64748b;
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
.empty {
  text-align: center;
  color: #94a3b8;
}
.claims-hint {
  margin-top: 0.75rem;
  font-size: 0.82rem;
}
.lobby-list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.lobby-card h2 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}
.lobby-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.lobby-meta {
  margin: 0;
  font-size: 0.82rem;
  color: #94a3b8;
}
.lobby-id {
  margin: 0.25rem 0 0;
  font-size: 0.72rem;
  color: #64748b;
  word-break: break-all;
}
.lobby-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
  flex-shrink: 0;
}
.count {
  font-size: 0.85rem;
  color: #cbd5e1;
}
.enter-btn {
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
}
.debug-room-btn,
.debug-browser-btn {
  padding: 0.35rem 0.6rem;
  border: 1px solid #475569;
  border-radius: 7px;
  background: #0f172a;
  color: #cbd5e1;
  cursor: pointer;
  font-size: 0.78rem;
}
.debug-room-btn:hover,
.debug-browser-btn:hover {
  border-color: #60a5fa;
  color: #dbeafe;
}
.enter-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.full-label {
  font-size: 0.78rem;
  color: #94a3b8;
}
.hint {
  color: #94a3b8;
  font-size: 0.9rem;
}
.err {
  color: #fca5a5;
  font-size: 0.88rem;
}
.debug-tools {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 10;
}
.debug-toggle {
  float: right;
  padding: 0.5rem 0.75rem;
  border: 1px solid #475569;
  border-radius: 8px;
  background: #172554;
  color: #dbeafe;
  cursor: pointer;
  font-size: 0.82rem;
}
.debug-panel {
  clear: both;
  width: min(34rem, calc(100vw - 2rem));
  max-height: min(28rem, calc(100vh - 5rem));
  margin-bottom: 0.5rem;
  overflow: auto;
  padding: 0.8rem;
  border: 1px solid #334155;
  border-radius: 10px;
  background: #0f172a;
  box-shadow: 0 10px 30px rgb(0 0 0 / 35%);
}
.debug-panel-head,
.server-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.debug-room-id {
  display: block;
  margin-top: 0.2rem;
  color: #64748b;
  font-size: 0.7rem;
  word-break: break-all;
}
.debug-hint,
.debug-error {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
}
.debug-hint {
  color: #94a3b8;
}
.debug-error {
  color: #fca5a5;
}
.server-log-view {
  margin-top: 0.8rem;
  padding-top: 0.7rem;
  border-top: 1px solid #334155;
}
.server-log-head a {
  color: #93c5fd;
  font-size: 0.78rem;
}
.server-logs {
  max-height: 16rem;
  margin: 0.55rem 0 0;
  overflow: auto;
  padding: 0.6rem;
  border-radius: 6px;
  background: #020617;
  color: #cbd5e1;
  font: 0.7rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
@media (max-width: 34rem) {
  .lobby-head {
    gap: 0.5rem;
  }
  .debug-tools {
    right: 0.5rem;
    bottom: 0.5rem;
  }
}
</style>
