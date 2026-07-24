<script setup lang="ts">
const route = useRoute()
const roomId = computed(() => route.params.roomId as string)
const { connected, connect } = useGameSocket(roomId.value)

onMounted(() => connect())
</script>

<template>
  <div>
    <h1>Игра — комната {{ roomId }}</h1>
    <PhasePanel phase="planning" />
    <ActionPanel />
    <p>WebSocket: {{ connected ? 'connected (stub)' : '...' }}</p>
  </div>
</template>
