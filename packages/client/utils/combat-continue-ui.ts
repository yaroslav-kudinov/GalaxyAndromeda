import type { CombatResolutionResult, PendingCombat } from '@galaxy/rules'
import { combatPrepOf, combatRoundStateOf } from '@galaxy/rules'

export type CombatContinueRole = 'attacker' | 'defender'

export type CombatContinueExpectation = 'prep' | 'destruction' | 'continue-decision' | null

/**
 * Броски текущего раунда без уничтожения.
 * После выбора потерь отпечаток итога меняется, броски те же — закрытое окно не открываем снова.
 */
export function combatResultRollsKey(
  res: CombatResolutionResult | null | undefined,
): string | null {
  if (!res) return null
  const round = res.rounds?.[res.rounds.length - 1] ?? res.roundOne
  const rolls = round?.shipRolls ?? []
  const rollsKey = rolls
    .map(
      (s) =>
        `${s.shipId}:${s.total}:${s.combatRolls.join('.')}:${s.supportRolls?.map((x) => x.rolls.join('.')).join(',') ?? ''}`,
    )
    .join('|')
  return `${res.coord.q},${res.coord.r}:${res.rounds?.length ?? 1}:${rollsKey}`
}

export function isCombatDefender(pending: PendingCombat, playerId: string): boolean {
  if (pending.defenderIds.includes(playerId)) return true
  if (pending.phase === 'awaiting-destruction' || pending.phase === 'awaiting-continue') {
    return pending.roundState?.defenderId === playerId
  }
  if (pending.phase === 'prep') return pending.prep.defenderId === playerId
  return false
}

/**
 * Чья очередь нажать «продолжить бой» / «отступить».
 * Не зависит от того, чей сейчас ход на карте: сначала атакующий, затем защитник.
 */
export function combatContinueDecisionRole(
  pending: PendingCombat | null | undefined,
  playerId: string,
): CombatContinueRole | null {
  if (pending?.phase !== 'awaiting-continue') return null
  if (pending.attackerId === playerId && pending.continueDecisions?.attacker == null) {
    return 'attacker'
  }
  if (
    isCombatDefender(pending, playerId)
    && pending.continueDecisions?.attacker === true
    && pending.continueDecisions?.defender == null
  ) {
    return 'defender'
  }
  return null
}

/** Баннер, если очередь этого игрока и окно итога уже закрыто. */
export function shouldShowCombatContinueBanner(args: {
  decisionRole: CombatContinueRole | null
  battleModalOpen: boolean
}): boolean {
  return args.decisionRole != null && !args.battleModalOpen
}

/**
 * Чужой бой / чужая очередь: не прятать статус, если окно итога не на экране.
 * Иначе «итог не просмотрен» + закрытая модалка оставляют пустой экран до обновления страницы.
 */
export function shouldShowForeignCombatBanner(args: {
  hasPendingCombat: boolean
  battleModalOpen: boolean
  showContinueBanner: boolean
}): boolean {
  return args.hasPendingCombat && !args.battleModalOpen && !args.showContinueBanner
}

/**
 * Смена отпечатка итога при тех же бросках (после выбора потерь) не сбрасывает закрытие.
 * Новые броски следующего раунда — сбрасывает, чтобы снова показать итог.
 */
export function shouldKeepCombatResultDismiss(args: {
  nextFingerprint: string | null | undefined
  previousFingerprint: string | null | undefined
  dismissedRollsKey: string | null | undefined
  currentRollsKey: string | null | undefined
}): boolean {
  if (!args.nextFingerprint) return true
  if (args.nextFingerprint === args.previousFingerprint) return true
  return Boolean(
    args.dismissedRollsKey
    && args.currentRollsKey
    && args.dismissedRollsKey === args.currentRollsKey,
  )
}

export function combatContinueUiExpectation(args: {
  hasPendingCombat: boolean
  decisionRole: CombatContinueRole | null
  isDestructionChooser: boolean
  phase: PendingCombat['phase'] | null
  isParticipant: boolean
  battleModalOpen: boolean
  viewingResults: boolean
}): CombatContinueExpectation {
  if (!args.hasPendingCombat) return null
  // Пока читают итог в открытом окне — не срывать просмотр ради баннера.
  if (args.battleModalOpen && args.viewingResults) return null
  if (args.decisionRole != null) return 'continue-decision'
  if (args.isDestructionChooser) return 'destruction'
  if (args.phase === 'prep' && args.isParticipant) return 'prep'
  return null
}

export type CombatOutcomeKind = 'win' | 'loss' | 'draw' | 'attacker-won' | 'defender-won'

export function isCombatRoundDraw(args: {
  roundWinner?: 'attacker' | 'defender' | 'draw' | null
  winnerId?: string | null
}): boolean {
  if (args.roundWinner === 'draw') return true
  return !args.winnerId && args.roundWinner !== 'attacker' && args.roundWinner !== 'defender'
}

/**
 * Крупный итог раунда: со стороны зрителя или глобально (атакующий / защитник / ничья).
 * Не смотрит на activePlayerId карты.
 */
export function combatRoundOutcome(args: {
  localPlayerId: string
  attackerId: string
  defenderId: string
  winnerId: string | null | undefined
  roundWinner?: 'attacker' | 'defender' | 'draw' | null
}): { kind: CombatOutcomeKind; label: string } {
  if (isCombatRoundDraw({ roundWinner: args.roundWinner, winnerId: args.winnerId })) {
    return { kind: 'draw', label: 'Ничья' }
  }
  const isParticipant =
    args.localPlayerId === args.attackerId || args.localPlayerId === args.defenderId
  if (isParticipant) {
    if (args.winnerId === args.localPlayerId) return { kind: 'win', label: 'Победа' }
    return { kind: 'loss', label: 'Поражение' }
  }
  if (args.winnerId === args.attackerId || args.roundWinner === 'attacker') {
    return { kind: 'attacker-won', label: 'Победа атакующего' }
  }
  return { kind: 'defender-won', label: 'Победа защитника' }
}

/**
 * Что сейчас происходит в бою — по pendingCombat.phase и роли в бою, не по ходу на карте.
 */
export function combatDecisionStatusLine(args: {
  pending: PendingCombat | null | undefined
  isBombardment?: boolean
  isRoundDraw?: boolean
}): string {
  const pending = args.pending
  if (!pending) {
    if (args.isBombardment) return 'Обстрел завершён: клетка не захватывается.'
    return args.isRoundDraw ? 'Раунд завершён без уничтожений.' : 'Раунд завершён.'
  }

  if (pending.phase === 'prep') {
    const prep = combatPrepOf(pending)
    if (prep?.phase === 'countdown') return 'Ждём подтверждения'
    return 'Стороны готовятся к бою'
  }

  if (pending.phase === 'awaiting-destruction') {
    const winnerId = combatRoundStateOf(pending)?.winnerId
    if (winnerId && winnerId === pending.attackerId) return 'Атакующий выбирает потери'
    return 'Защитник выбирает потери'
  }

  if (pending.phase === 'awaiting-continue') {
    const mustContinue = pending.shipsDestroyedInCombat !== true
    const attackerDecided = pending.continueDecisions?.attacker === true
    if (!attackerDecided) {
      return mustContinue
        ? 'Атакующий подтверждает продолжение'
        : 'Атакующий: продолжить или отступить'
    }
    if (pending.continueDecisions?.defender !== true) {
      return mustContinue
        ? 'Защитник подтверждает продолжение'
        : 'Защитник: продолжить или отступить'
    }
    return 'Ждём подтверждения'
  }

  return 'Ждём подтверждения'
}
