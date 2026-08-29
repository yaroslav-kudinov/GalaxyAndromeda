<script setup lang="ts">
import { listPatchNotes } from '~/utils/patch-notes'

const notes = listPatchNotes()

useHead({ title: 'Патчноуты — Galaxy Andromeda' })
</script>

<template>
  <div class="page">
    <p class="crumb"><NuxtLink to="/">← Lobby</NuxtLink></p>
    <h1>Патчноуты</h1>
    <p class="lead">История изменений для игроков и агентов. Источник — файлы в docs/patch-notes.</p>

    <ul v-if="notes.length" class="list">
      <li v-for="note in notes" :key="note.slug">
        <NuxtLink :to="`/patch-notes/${note.slug}`">
          <span class="date">{{ note.date }}</span>
          <span class="title">{{ note.title }}</span>
          <span class="summary">{{ note.summary }}</span>
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="empty">Пока нет опубликованных патчноутов.</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 40rem;
  margin: 0 auto;
  font-family: Manrope, system-ui, sans-serif;
}

.crumb {
  margin: 0 0 0.75rem;
}

.crumb a,
.list a {
  color: #93c5fd;
  text-decoration: none;
}

h1 {
  margin: 0 0 0.4rem;
  font-size: 1.5rem;
}

.lead {
  margin: 0 0 1.25rem;
  color: #94a3b8;
  font-size: 0.9rem;
  line-height: 1.45;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.list li + li {
  margin-top: 0.65rem;
}

.list a {
  display: block;
  padding: 0.85rem 0.95rem;
  border: 1px solid #334155;
  border-radius: 10px;
  background: #1e293b;
  color: inherit;
}

.list a:hover {
  border-color: #64748b;
}

.date {
  display: block;
  margin-bottom: 0.2rem;
  color: #94a3b8;
  font-size: 0.75rem;
}

.title {
  display: block;
  margin-bottom: 0.3rem;
  color: #f8fafc;
  font-weight: 650;
}

.summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: #cbd5e1;
  font-size: 0.85rem;
  line-height: 1.4;
}

.empty {
  color: #94a3b8;
}
</style>
