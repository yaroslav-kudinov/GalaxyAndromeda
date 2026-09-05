<script setup lang="ts">
const route = useRoute()
const docName = computed(() => (route.path.includes('privacy') ? 'privacy-policy' : 'terms-of-use'))
const title = computed(() =>
  docName.value === 'privacy-policy' ? 'Конфиденциальность' : 'Условия использования',
)

const html = ref('')

onMounted(async () => {
  const res = await fetch(`/legal/${docName.value}.html`)
  if (res.ok) html.value = await res.text()
  else html.value = '<p>Документ не найден.</p>'
})
</script>

<template>
  <div class="legal-page">
    <header>
      <NuxtLink to="/">← На главную</NuxtLink>
      <h1>{{ title }}</h1>
    </header>
    <article class="legal-body" v-html="html" />
  </div>
</template>

<style scoped>
.legal-page {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem;
  color: #e2e8f0;
}
.legal-body :deep(h1),
.legal-body :deep(h2) {
  margin-top: 1.5rem;
}
.legal-body :deep(p) {
  line-height: 1.6;
}
</style>
