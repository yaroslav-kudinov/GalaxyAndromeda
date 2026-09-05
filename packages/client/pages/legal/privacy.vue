<script setup lang="ts">
const html = ref('')

onMounted(async () => {
  const res = await fetch('/legal/privacy-policy.html')
  if (res.ok) html.value = await res.text()
})
</script>

<template>
  <div class="legal-page">
    <header>
      <NuxtLink to="/">← На главную</NuxtLink>
      <h1>Конфиденциальность</h1>
    </header>
    <article class="legal-body" v-html="html" />
  </div>
</template>

<style scoped>
.legal-page { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; color: #e2e8f0; }
.legal-body :deep(p) { line-height: 1.6; margin: 0.75rem 0; }
.legal-body :deep(h2) { margin-top: 1.25rem; }
</style>
