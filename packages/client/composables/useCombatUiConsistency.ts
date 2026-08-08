/**
 * Сверяет ожидания сервера по бою (pendingCombat) с тем, что реально видно в UI.
 * При расхождении — сигнал рассинхрона и попытка восстановить интерфейс решения.
 */
export type CombatUiExpectation =
  | 'prep'
  | 'destruction'
  | 'continue-decision'
  | null

export type CombatUiPresentation =
  | 'prep-modal'
  | 'destruction-modal'
  | 'continue-banner'
  | 'continue-modal'
  | 'results-modal'
  | 'none'

export function combatUiMatchesExpectation(
  expectation: CombatUiExpectation,
  presentation: CombatUiPresentation,
): boolean {
  if (expectation == null) return true
  switch (expectation) {
    case 'prep':
      return presentation === 'prep-modal'
    case 'destruction':
      return presentation === 'destruction-modal'
    case 'continue-decision':
      return presentation === 'continue-banner' || presentation === 'continue-modal'
    default:
      return true
  }
}

export function combatUiMismatchMessage(expectation: CombatUiExpectation): string {
  switch (expectation) {
    case 'prep':
      return 'Сервер ждёт подготовку к бою, но окно подготовки не показано.'
    case 'destruction':
      return 'Сервер ждёт выбор уничтожаемых кораблей, но интерфейс выбора не показан.'
    case 'continue-decision':
      return 'Сервер ждёт решение «продолжить бой или отступить», но соответствующий интерфейс не показан.'
    default:
      return 'Состояние боя на сервере не совпадает с интерфейсом клиента.'
  }
}
