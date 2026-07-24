<template>
  <div class="app" :class="{ 'app-immersive': isImmersive }">
    <header v-if="!isImmersive" class="header">
      <NuxtLink to="/">Lobby</NuxtLink>
      <NuxtLink to="/editor">Творческий режим</NuxtLink>
    </header>
    <main :class="{ 'main-immersive': isImmersive }">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const isImmersive = computed(() => route.meta.layout === 'immersive')

watch(
  isImmersive,
  (immersive) => {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('galaxy-immersive', immersive)
  },
  { immediate: true },
)

onUnmounted(() => {
  if (import.meta.client) {
    document.documentElement.classList.remove('galaxy-immersive')
  }
})
</script>

<style>
html,
body {
  margin: 0;
  padding: 0;
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
