import type { CombatResolutionResult, PendingCombat } from '@galaxy/rules'
import { combatPrepOf } from '@galaxy/rules'

/** Кто решает перед раундом: атакующий, защитник или третий игрок, чьи корабли поддерживают бой. */
export type CombatContinueRole = 'attacker' | 'defender' | 'support'

export type CombatContinueExpectation = 'prep' | 'continue-decision' | null

/**
 * Броски текущего раунда. Если отпечаток итога меняется при тех же бросках,
 * закрытое окно не открываем снова.
 */
export function combatResultRollsKey(
  res: CombatResolutionResult | null | undefined,
): string | null {
  if (!res) return null
  const round = res.rounds?.[res.rounds.length - 1] ?? res.roundOne
  const rolls = round?.shipRolls ?? []
  const rollsKey = rolls
    .map((s) => `${s.shipId}:${s.dice.map((d) => `${d.value}>${d.targetShipId ?? '-'}`).join('.')}`)
    .join('|')
  return `${res.coord.q},${res.coord.r}:${res.rounds?.length ?? 1}:${rollsKey}`
}

export function isCombatDefender(pending: PendingCombat, playerId: string): boolean {
  if (pending.defenderIds.includes(playerId)) return true
  if (pending.phase === 'prep') return pending.prep.defenderId === playerId
  return false
}

/**
 * Кто сейчас выбирает цели и решает, продолжать ли бой. Не зависит от того, чей ход на карте.
 * Пока в бою никто не уничтожен, отступать нельзя и все решают одновременно; после первого
 * уничтожения защитник ждёт решения атакующего.
 */
export function combatContinueDecisionRole(
  pending: PendingCombat | null | undefined,
  playerId: string,
  options?: { eliminated?: boolean; supporterAwaited?: boolean },
): CombatContinueRole | null {
  if (options?.eliminated) return null
  if (pending?.phase !== 'awaiting-continue') return null
  if (pending.attackerId === playerId) {
    return pending.continueDecisions?.attacker == null ? 'attacker' : null
  }
  if (isCombatDefender(pending, playerId)) {
    const attackerFirst = pending.shipsDestroyedInCombat === true
    if (attackerFirst && pending.continueDecisions?.attacker !== true) return null
    return pending.continueDecisions?.defender == null ? 'defender' : null
  }
  if (options?.supporterAwaited && pending.supportReady?.[playerId] !== true) return 'support'
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
 * Смена отпечатка итога при тех же бросках не сбрасывает закрытие.
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
  phase: PendingCombat['phase'] | null
  isParticipant: boolean
  battleModalOpen: boolean
  viewingResults: boolean
}): CombatContinueExpectation {
  if (!args.hasPendingCombat) return null
  // Пока читают итог в открытом окне — не срывать просмотр ради баннера.
  if (args.battleModalOpen && args.viewingResults) return null
  if (args.decisionRole != null) return 'continue-decision'
  if (args.phase === 'prep' && args.isParticipant) return 'prep'
  return null
}

export type CombatOutcomeKind = 'win' | 'loss' | 'draw' | 'attacker-won' | 'defender-won'

/**
 * Крупный итог раунда: со стороны зрителя или глобально (атакующий / защитник).
 * Пока бой идёт и никто не выбит — «раунд без исхода». Не смотрит на activePlayerId карты.
 */
export function combatRoundOutcome(args: {
  localPlayerId: string
  attackerId: string
  defenderId: string
  winnerId: string | null | undefined
  /** Бой закончился (стороны выбиты, отступили или бой не состоялся). */
  battleOver?: boolean
  /** Ни одна сторона не могла стрелять. */
  stalemate?: boolean
}): { kind: CombatOutcomeKind; label: string } {
  if (args.stalemate) return { kind: 'draw', label: 'Бой не состоялся' }
  if (!args.winnerId) {
    return { kind: 'draw', label: args.battleOver ? 'Взаимное уничтожение' : 'Раунд без исхода' }
  }
  const isParticipant =
    args.localPlayerId === args.attackerId || args.localPlayerId === args.defenderId
  if (isParticipant) {
    if (args.winnerId === args.localPlayerId) return { kind: 'win', label: 'Победа' }
    return { kind: 'loss', label: 'Поражение' }
  }
  if (args.winnerId === args.attackerId) {
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
}): string {
  const pending = args.pending
  if (!pending) {
    if (args.isBombardment) return 'Обстрел завершён: клетка не захватывается.'
    return 'Бой завершён.'
  }

  if (pending.phase === 'prep') {
    const prep = combatPrepOf(pending)
    if (prep?.phase === 'countdown') return 'Ждём подтверждения'
    return 'Стороны готовятся к бою'
  }

  if (pending.phase === 'awaiting-continue') {
    const mustContinue = pending.shipsDestroyedInCombat !== true
    const attackerDecided = pending.continueDecisions?.attacker === true
    const defenderDecided = pending.continueDecisions?.defender === true
    if (mustContinue) {
      if (!attackerDecided && !defenderDecided) return 'Стороны выбирают цели на следующий раунд'
      if (!attackerDecided) return 'Атакующий выбирает цели'
      if (!defenderDecided) return 'Защитник выбирает цели'
      return 'Поддержка выбирает цели'
    }
    if (!attackerDecided) return 'Атакующий: цели и продолжить или отступить'
    if (!defenderDecided) return 'Защитник: цели и продолжить или отступить'
    return 'Поддержка выбирает цели'
  }

  return 'Ждём подтверждения'
}
