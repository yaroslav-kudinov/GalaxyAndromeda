<script setup lang="ts">
const serverUrl = computed(() => 'http://127.0.0.1:3001')

async function pingServer() {
  try {
    const res = await fetch(`${serverUrl.value}/health`)
    const data = await res.json()
    alert(JSON.stringify(data))
  } catch {
    alert('Server offline — run pnpm dev')
  }
}
</script>

<template>
  <div class="actions">
    <button type="button" @click="pingServer">Ping server</button>
  </div>
</template>
