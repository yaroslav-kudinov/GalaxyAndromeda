import type { GameSnapshot, Phase } from '@galaxy/rules'

export interface GameToast {
  id: number
  kind: 'identity' | 'phase' | 'turn' | 'gameover' | 'error'
  title: string
  detail?: string
  accent?: boolean
  visible: boolean
}

const PHASE_LABELS: Record<Phase, string> = {
  events: 'События',
  planning: 'Планирование',
  actions: 'Действия',
  production: 'Действия',
}

const SHOW_MS = 4200
const FADE_MS = 650

const GAME_OVER_REASON_LABELS: Record<string, string> = {
  power_centers: 'Большинство центров власти',
  last_standing: 'Последний игрок на карте',
}

export function useGameStatusToasts(
  snapshot: Ref<GameSnapshot | null | undefined>,
  playerId: Ref<string>,
  playerName: Ref<string>,
) {
  const { play: playSfx } = useGameSfx()
  const toasts = ref<GameToast[]>([])
  let seq = 0
  let bootstrapped = false

  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function pushToast(
    kind: GameToast['kind'],
    title: string,
    detail?: string,
    accent = false,
  ) {
    const id = ++seq
    toasts.value.push({ id, kind, title, detail, accent, visible: true })

    setTimeout(() => {
      const toast = toasts.value.find((t) => t.id === id)
      if (toast) toast.visible = false
    }, SHOW_MS)

    setTimeout(() => removeToast(id), SHOW_MS + FADE_MS)
  }

  function playerLabel(id: string | null | undefined): string {
    if (!id || !snapshot.value) return '—'
    return snapshot.value.players.find((p) => p.id === id)?.name ?? id
  }

  function announceIdentity() {
    pushToast('identity', `Вы: ${playerName.value}`, 'Ваша сторона', true)
  }

  function announcePhase(phase: Phase, turnNumber: number) {
    pushToast('phase', PHASE_LABELS[phase], `Ход ${turnNumber}`)
  }

  function announceActivePlayer(activeId: string | null | undefined, playTurnSfx: boolean) {
    if (!activeId) return
    const isMe = activeId === playerId.value
    if (isMe) {
      pushToast('turn', 'Ваш ход', PHASE_LABELS[snapshot.value?.phase ?? 'planning'], true)
      if (playTurnSfx) playSfx('turn')
    } else {
      pushToast('turn', `Ход: ${playerLabel(activeId)}`, 'Ожидайте')
    }
  }

  watch(
    () =>
      snapshot.value
        ? ([snapshot.value.phase, snapshot.value.turnNumber, snapshot.value.activePlayerId] as const)
        : null,
    (current, previous) => {
      if (!current || !snapshot.value) return
      const [phase, turn, activeId] = current

      if (!bootstrapped) {
        bootstrapped = true
        announceIdentity()
        announcePhase(phase, turn)
        announceActivePlayer(activeId, false)
        return
      }

      if (!previous) return
      const [prevPhase, , prevActive] = previous

      if (phase !== prevPhase) {
        announcePhase(phase, turn)
      }
      if (activeId !== prevActive) {
        announceActivePlayer(activeId, true)
      }
    },
  )

  watch(
    () => snapshot.value?.gameOver ?? null,
    (current, previous) => {
      if (!current || !snapshot.value) return
      if (previous?.winnerId === current.winnerId && previous?.reason === current.reason) return
      const winner = playerLabel(current.winnerId)
      const reason = GAME_OVER_REASON_LABELS[current.reason] ?? current.reason
      pushToast('gameover', 'Игра окончена', `Победитель: ${winner} · ${reason}`, true)
    },
  )

  return { toasts, pushToast, PHASE_LABELS }
}
