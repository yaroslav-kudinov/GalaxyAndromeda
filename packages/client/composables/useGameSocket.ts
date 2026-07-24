export function useGameSocket(_roomId: string) {
  const connected = ref(false)
  const observation = ref<unknown>(null)

  async function connect() {
    connected.value = true
  }

  return { connected, observation, connect }
}
