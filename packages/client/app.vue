<template>
  <div class="app">
    <header class="header">
      <NuxtLink to="/">Lobby</NuxtLink>
      <NuxtLink to="/editor">Творческий режим</NuxtLink>
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>

<style>
.app {
  font-family: system-ui, sans-serif;
  min-height: 100vh;
  background: #1a1a2e;
  color: #eee;
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
</style>
