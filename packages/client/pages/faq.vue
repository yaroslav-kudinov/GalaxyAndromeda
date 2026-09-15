<script setup lang="ts">
type FaqItem = { question: string; answer: string }

const items: FaqItem[] = [
  {
    question: 'Нужен ли второй игрок для обучения?',
    answer:
      'Нет. Нажмите «Обучение» на главной: вы попадёте на отдельную коридорную карту, а учебные флоты будут действовать автоматически.',
  },
  {
    question: 'Потеряю ли партию при перезапуске сервера?',
    answer:
      'Да, активные комнаты хранятся в памяти сервера. После перезапуска или деплоя незавершённые партии сбрасываются. Локальные сохранения в браузере помогают продолжить офлайн-игру.',
  },
  {
    question: 'Как добавить свою карту в общий список?',
    answer:
      'Создайте карту в редакторе и нажмите «Отправить на модерацию». После одобрения администратором карта появится в каталоге.',
  },
  {
    question: 'Можно ли играть без сервера?',
    answer: 'Да, в локальном режиме на одном устройстве, но без мультиплеера по сети.',
  },
]
</script>

<template>
  <div class="g-page">
    <header class="g-page-head">
      <h1 class="g-page-title">Вопросы и ответы</h1>
      <p class="g-page-sub">
        Короткие ответы на то, что чаще всего спрашивают новые игроки.
      </p>
    </header>

    <ul class="faq-list">
      <li v-for="item in items" :key="item.question" class="g-card faq-item">
        <h2 class="faq-question">{{ item.question }}</h2>
        <p class="faq-answer">{{ item.answer }}</p>
      </li>
    </ul>

    <p class="faq-more">
      <NuxtLink to="/patch-notes">Патчноуты и изменения правил</NuxtLink>
    </p>
  </div>
</template>

<style scoped>
.faq-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--g-s-3);
}
.faq-item {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.faq-question {
  margin: 0;
  font-size: var(--g-text-md);
  font-weight: 650;
  color: var(--g-text-strong);
}
.faq-answer {
  margin: 0;
  font-size: var(--g-text-sm);
  line-height: 1.6;
  color: var(--g-text-dim);
}
.faq-more {
  margin: var(--g-s-5) 0 0;
  font-size: var(--g-text-sm);
}
.faq-more a {
  color: #93c5fd;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
