<template>
  <div class="app" :class="{ 'app-immersive': isImmersive, 'app-landing': isLanding }">
    <header v-if="!isImmersive && !isLanding" class="site-header">
      <NuxtLink class="site-brand" to="/">
        <span class="site-brand-mark" aria-hidden="true">✦</span>
        Галактика Андромеда
      </NuxtLink>
      <nav class="site-nav" aria-label="Разделы сайта">
        <NuxtLink to="/">Главная</NuxtLink>
        <NuxtLink to="/editor">Редактор карт</NuxtLink>
        <NuxtLink to="/patch-notes">Патчноуты</NuxtLink>
        <NuxtLink to="/faq">Вопросы и ответы</NuxtLink>
      </nav>
    </header>
    <main :class="{ 'main-immersive': isImmersive, 'main-landing': isLanding }">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </main>
    <PatchUpdateToast />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const isImmersive = computed(() => route.meta.layout === 'immersive')
const isLanding = computed(() => route.meta.landing === true || route.path === '/')

watch(
  [isImmersive, isLanding],
  ([immersive, landing]) => {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('galaxy-immersive', immersive)
    document.documentElement.classList.toggle('galaxy-landing', landing)
  },
  { immediate: true },
)

onUnmounted(() => {
  if (import.meta.client) {
    document.documentElement.classList.remove('galaxy-immersive')
    document.documentElement.classList.remove('galaxy-landing')
  }
})
</script>

<style>
:root {
  --galaxy-scrollbar-size: 8px;
  --galaxy-scrollbar-track: #1e293b;
  --galaxy-scrollbar-thumb: #7c8ca3;
  --galaxy-scrollbar-thumb-hover: #d4dce8;
}

html {
  color-scheme: dark;
  scrollbar-width: thin;
  scrollbar-color: var(--galaxy-scrollbar-thumb) var(--galaxy-scrollbar-track);
}

html,
body {
  margin: 0;
  padding: 0;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--galaxy-scrollbar-thumb) var(--galaxy-scrollbar-track);
}

*::-webkit-scrollbar {
  width: var(--galaxy-scrollbar-size);
  height: var(--galaxy-scrollbar-size);
}

*::-webkit-scrollbar-track {
  background: var(--galaxy-scrollbar-track);
  border-radius: 999px;
}

*::-webkit-scrollbar-thumb {
  background: var(--galaxy-scrollbar-thumb);
  border-radius: 999px;
  border: 1px solid #0f172a;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--galaxy-scrollbar-thumb-hover);
}

*::-webkit-scrollbar-corner {
  background: var(--galaxy-scrollbar-track);
}

html.galaxy-immersive,
html.galaxy-immersive body,
html.galaxy-immersive #__nuxt {
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

.app {
  font-family: var(--g-font-ui);
  min-height: 100vh;
  background: var(--g-bg);
  color: var(--g-text);
}

.app-immersive {
  height: 100dvh;
  max-height: 100dvh;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.app-landing {
  position: relative;
  z-index: 0;
  min-height: 100dvh;
  height: auto;
  overflow: visible;
  background: #050814;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3) var(--g-s-5);
  padding: var(--g-s-3) var(--g-s-4);
  border-bottom: 1px solid var(--g-border);
  background: var(--g-surface-glass);
  backdrop-filter: blur(8px);
}

.site-brand {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  font-family: var(--g-font-display);
  font-size: var(--g-text-sm);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--g-text-strong);
  text-decoration: none;
}

.site-brand-mark {
  color: var(--g-accent);
}

.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
  margin-left: auto;
}

.site-nav a {
  padding: var(--g-s-1) var(--g-s-3);
  border-radius: var(--g-r-pill);
  font-size: var(--g-text-sm);
  color: var(--g-text-dim);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.site-nav a:hover {
  background: var(--g-surface-1);
  color: var(--g-text-strong);
}

/* Текущий раздел: у «Главной» точное совпадение, иначе она подсвечена всегда */
.site-nav a.router-link-active:not([href='/']),
.site-nav a.router-link-exact-active {
  background: var(--g-accent-soft);
  color: var(--g-text-strong);
}

main {
  padding: 0;
}

main.main-landing {
  padding: 0;
  min-height: 100dvh;
  height: auto;
  overflow: visible;
  position: relative;
}

html.galaxy-landing,
html.galaxy-landing body,
html.galaxy-landing #__nuxt {
  height: auto !important;
  max-height: none !important;
  overflow-x: hidden;
  overflow-y: auto !important;
}

main.main-immersive {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
}

main.main-immersive > * {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
