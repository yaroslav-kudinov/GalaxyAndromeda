<script setup lang="ts">
const html = ref('')

onMounted(async () => {
  const res = await fetch('/legal/privacy-policy.html')
  html.value = res.ok ? await res.text() : '<p>Документ не найден.</p>'
})
</script>

<template>
  <div class="g-page">
    <header class="g-page-head">
      <h1 class="g-page-title">Конфиденциальность</h1>
      <p class="g-page-sub">
        Какие данные игра хранит, зачем и как долго.
      </p>
    </header>
    <!-- Документ лежит в public/legal и не содержит пользовательского ввода -->
    <article class="g-card g-prose legal-body" v-html="html" />
  </div>
</template>

<style scoped>
.legal-body :deep(h1) {
  /* Заголовок страницы уже есть в шапке — из документа его не дублируем */
  display: none;
}
</style>
