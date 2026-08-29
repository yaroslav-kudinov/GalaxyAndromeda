<script setup lang="ts">
const { note, dismiss } = usePatchNoteNotice()
</script>

<template>
  <aside v-if="note" class="update-toast" role="status">
    <p class="kicker">Обновление</p>
    <p class="title">{{ note.title }}</p>
    <p class="summary">{{ note.summary }}</p>
    <div class="actions">
      <NuxtLink class="read" :to="`/patch-notes/${note.slug}`">Читать</NuxtLink>
      <button type="button" class="dismiss" @click="dismiss">Понятно</button>
    </div>
  </aside>
</template>

<style scoped>
.update-toast {
  position: fixed;
  z-index: 240;
  right: 0.75rem;
  bottom: 0.75rem;
  width: min(22rem, calc(100vw - 1.5rem));
  padding: 0.7rem 0.8rem;
  border: 1px solid #334155;
  border-radius: 10px;
  background: #0f172af2;
  box-shadow: 0 8px 24px #00000066;
  color: #e2e8f0;
  font-family: Manrope, system-ui, sans-serif;
  pointer-events: auto;
}

.kicker {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #93c5fd;
}

.title {
  margin: 0 0 0.3rem;
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.3;
  color: #f8fafc;
}

.summary {
  display: -webkit-box;
  margin: 0 0 0.55rem;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  font-size: 0.78rem;
  line-height: 1.4;
  color: #94a3b8;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
}

.read {
  color: #93c5fd;
  font-size: 0.78rem;
  text-decoration: none;
}

.read:hover {
  text-decoration: underline;
}

.dismiss {
  padding: 0.28rem 0.7rem;
  border: 1px solid #475569;
  border-radius: 6px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 0.78rem;
  cursor: pointer;
}

.dismiss:hover {
  border-color: #64748b;
}
</style>
