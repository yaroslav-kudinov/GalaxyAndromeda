const NICKNAME_KEY = 'galaxy-player-nickname'

export function loadNickname(): string | null {
  if (!import.meta.client) return null
  const value = localStorage.getItem(NICKNAME_KEY)?.trim()
  return value || null
}

export function saveNickname(name: string): void {
  if (!import.meta.client) return
  const trimmed = name.trim()
  if (!trimmed) return
  localStorage.setItem(NICKNAME_KEY, trimmed.slice(0, 32))
}

export function clearNickname(): void {
  if (!import.meta.client) return
  localStorage.removeItem(NICKNAME_KEY)
}

export function usePlayerProfile() {
  const nickname = useState<string>('player-nickname', () => loadNickname() ?? '')

  function confirmNickname(name: string): boolean {
    const trimmed = name.trim()
    if (!trimmed) return false
    saveNickname(trimmed)
    nickname.value = trimmed
    return true
  }

  function resetNickname(): void {
    clearNickname()
    nickname.value = ''
  }

  const hasNickname = computed(() => nickname.value.trim().length > 0)

  if (import.meta.client && !nickname.value) {
    const stored = loadNickname()
    if (stored) nickname.value = stored
  }

  return { nickname, hasNickname, confirmNickname, resetNickname }
}
