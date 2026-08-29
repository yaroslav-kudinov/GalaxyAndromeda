<script setup lang="ts">
import { getPatchNote } from '~/utils/patch-notes'

const route = useRoute()
const { markPatchNoteSeen } = usePatchNoteNotice()

const slug = computed(() => String(route.params.slug ?? ''))
const note = computed(() => getPatchNote(slug.value))

watch(
  slug,
  (value) => {
    if (value) markPatchNoteSeen(value)
  },
  { immediate: true },
)

useHead({
  title: computed(() =>
    note.value ? `${note.value.title} — Патчноуты` : 'Патчноут не найден',
  ),
})
</script>

<template>
  <div class="page">
    <p class="crumb">
      <NuxtLink to="/patch-notes">← Все патчноуты</NuxtLink>
    </p>
    <PatchNoteArticle v-if="note" :note="note" />
    <section v-else class="missing">
      <h1>Патчноут не найден</h1>
      <p>Такого файла нет в истории. Вернитесь к списку патчноутов.</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 42rem;
  margin: 0 auto;
  font-family: Manrope, system-ui, sans-serif;
}

.crumb {
  margin: 0 0 1rem;
}

.crumb a {
  color: #93c5fd;
  text-decoration: none;
}

.missing h1 {
  margin: 0 0 0.5rem;
  font-size: 1.35rem;
}

.missing p {
  color: #94a3b8;
}
</style>
