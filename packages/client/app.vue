<template>
  <div class="app" :class="{ 'app-immersive': isImmersive, 'app-landing': isLanding }">
    <header v-if="!isImmersive && !isLanding" class="header">
      <NuxtLink to="/">Lobby</NuxtLink>
      <NuxtLink to="/editor">Творческий режим</NuxtLink>
      <NuxtLink to="/patch-notes">Патчноуты</NuxtLink>
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
  font-family: system-ui, sans-serif;
  min-height: 100vh;
  background: #1a1a2e;
  color: #eee;
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

.header {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid #333;
}

.header a {
  color: #93c5fd;
  text-decoration: none;
}

main {
  padding: 1rem;
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
