<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

const token = ref('')
const tab = ref<'maps' | 'submissions' | 'logs'>('maps')
const maps = ref<Array<{ id: string; name: string; published: boolean }>>([])
const submissions = ref<Array<{ id: number; nickname: string; map: { name: string } }>>([])
const logs = ref<Array<{ id: number; room_id: string; map_id: string; outcome: string; ended_at: string }>>([])
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
</style>
