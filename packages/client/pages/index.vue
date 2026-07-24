<script setup lang="ts">
const maps = ref<{ id: string; name: string }[]>([{ id: 'default', name: 'Default (stub)' }])
</script>

<template>
  <div>
    <h1>Galaxy Andromeda — Lobby</h1>
    <p>Создайте комнату или откройте <NuxtLink to="/editor">редактор карт</NuxtLink>.</p>
    <section class="card">
      <h2>Карты</h2>
      <ul>
        <li v-for="m in maps" :key="m.id">{{ m.name }}</li>
      </ul>
      <button type="button">Создать игру (stub)</button>
    </section>
  </div>
</template>

<style scoped>
.card {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid #444;
  border-radius: 8px;
  max-width: 400px;
}
button {
  margin-top: 0.5rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}
</style>
