<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

const token = ref('')
const tab = ref<'maps' | 'submissions' | 'logs' | 'bugs'>('maps')
const maps = ref<Array<{ id: string; name: string; published: boolean }>>([])
const submissions = ref<Array<{ id: number; nickname: string; map: { name: string } }>>([])
const logs = ref<Array<{ id: number; room_id: string; map_id: string; outcome: string; ended_at: string }>>([])
interface BugReport {
  id: string
  createdAt: string
  expiresAt: string
  description: string
  playerId?: string
  playerName?: string
  roomId?: string
  userAgent?: string
  hasScreenshot: boolean
}
const bugReports = ref<BugReport[]>([])
/** Скриншоты грузятся с токеном и показываются по ссылке на скачанный файл. */
const screenshots = ref<Record<string, string>>({})
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(() => {
  if (import.meta.client) {
    token.value = sessionStorage.getItem('galaxy-admin-token') ?? ''
    if (token.value) void refresh()
  }
})

function saveToken() {
  sessionStorage.setItem('galaxy-admin-token', token.value.trim())
  void refresh()
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.value.trim()}`,
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  return body as T
}

async function refresh() {
  busy.value = true
  error.value = null
  try {
    if (tab.value === 'maps') {
      maps.value = (await adminFetch<{ maps: typeof maps.value }>('/maps')).maps
    } else if (tab.value === 'submissions') {
      submissions.value = (await adminFetch<{ submissions: typeof submissions.value }>('/submissions?status=pending')).submissions
    } else if (tab.value === 'bugs') {
      bugReports.value = (await adminFetch<{ reports: BugReport[] }>('/bug-reports')).reports
    } else {
      logs.value = (await adminFetch<{ logs: typeof logs.value }>('/game-logs')).logs
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function approve(id: number) {
  await adminFetch(`/submissions/${id}/approve`, { method: 'POST', body: '{}' })
  await refresh()
}

async function reject(id: number) {
  const note = prompt('Причина отклонения')?.trim()
  if (!note) return
  await adminFetch(`/submissions/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) })
  await refresh()
}

async function showScreenshot(id: string) {
  error.value = null
  try {
    const res = await fetch(`/api/admin/bug-reports/${id}/screenshot`, {
      headers: { Authorization: `Bearer ${token.value.trim()}` },
    })
    if (!res.ok) throw new Error(`Скриншот не загрузился: HTTP ${res.status}`)
    screenshots.value = { ...screenshots.value, [id]: URL.createObjectURL(await res.blob()) }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeBugReport(id: string) {
  if (!confirm('Удалить этот баг-репорт? Восстановить его будет нельзя.')) return
  await adminFetch(`/bug-reports/${id}`, { method: 'DELETE' })
  const url = screenshots.value[id]
  if (url) URL.revokeObjectURL(url)
  await refresh()
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ru-RU')
}

watch(tab, () => void refresh())
</script>

<template>
  <div class="admin-page">
    <h1>Админ-панель</h1>

    <div v-if="!token" class="card">
      <label>Токен администратора<input v-model="token" type="password" /></label>
      <button type="button" @click="saveToken">Войти</button>
    </div>

    <template v-else>
      <nav class="tabs">
        <button :class="{ active: tab === 'maps' }" @click="tab = 'maps'">Карты</button>
        <button :class="{ active: tab === 'submissions' }" @click="tab = 'submissions'">Модерация</button>
        <button :class="{ active: tab === 'logs' }" @click="tab = 'logs'">Логи</button>
        <button :class="{ active: tab === 'bugs' }" @click="tab = 'bugs'">Баг-репорты</button>
      </nav>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="busy">Загрузка…</p>

      <ul v-if="tab === 'maps'">
        <li v-for="m in maps" :key="m.id">
          {{ m.name }} ({{ m.id }}) — {{ m.published ? 'опубликована' : 'скрыта' }}
        </li>
      </ul>

      <ul v-if="tab === 'submissions'">
        <li v-for="s in submissions" :key="s.id">
          #{{ s.id }} от {{ s.nickname }} — {{ s.map.name }}
          <button type="button" @click="approve(s.id)">Одобрить</button>
          <button type="button" @click="reject(s.id)">Отклонить</button>
        </li>
      </ul>

      <template v-if="tab === 'bugs'">
        <p v-if="!busy && !bugReports.length">Баг-репортов нет.</p>
        <ul>
          <li v-for="r in bugReports" :key="r.id" class="bug">
            <div class="bug-head">
              <strong>{{ formatDate(r.createdAt) }}</strong>
              <span>{{ r.playerName ?? r.playerId ?? 'без имени' }}</span>
              <span v-if="r.roomId" :title="r.roomId">комната {{ r.roomId.slice(0, 8) }}…</span>
              <span class="bug-muted">хранится до {{ formatDate(r.expiresAt) }}</span>
            </div>
            <p class="bug-text">{{ r.description }}</p>
            <p v-if="r.userAgent" class="bug-muted">{{ r.userAgent }}</p>
            <div class="bug-actions">
              <button v-if="r.hasScreenshot && !screenshots[r.id]" type="button" @click="showScreenshot(r.id)">
                Показать скриншот
              </button>
              <a v-if="screenshots[r.id]" :href="screenshots[r.id]" target="_blank" rel="noopener">Открыть скриншот</a>
              <button type="button" @click="removeBugReport(r.id)">Удалить</button>
            </div>
            <img v-if="screenshots[r.id]" :src="screenshots[r.id]" alt="Скриншот баг-репорта" class="bug-shot" />
          </li>
        </ul>
      </template>

      <ul v-if="tab === 'logs'">
        <li v-for="l in logs" :key="l.id">
          #{{ l.id }} {{ l.room_id.slice(0, 8) }}… карта {{ l.map_id }} — {{ l.outcome }} ({{ l.ended_at }})
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.admin-page { padding: 1.5rem; color: #e2e8f0; max-width: 56rem; margin: 0 auto; }
.card { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tabs button.active { font-weight: bold; }
.err { color: #f87171; }
ul { list-style: none; padding: 0; }
li { padding: 0.5rem 0; border-bottom: 1px solid #334155; }
.bug-head { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: baseline; }
.bug-text { white-space: pre-wrap; margin: 0.4rem 0; }
.bug-muted { color: #94a3b8; font-size: 0.85em; }
.bug-actions { display: flex; gap: 0.5rem; align-items: center; }
.bug-actions a { color: #93c5fd; }
.bug-shot { display: block; max-width: 100%; margin-top: 0.5rem; border: 1px solid #334155; }
</style>
