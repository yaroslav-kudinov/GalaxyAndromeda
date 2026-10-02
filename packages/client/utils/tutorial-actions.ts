import { SCENARIO_FORBIDDEN_ACTIONS, type ScenarioActionConstraint } from '@galaxy/rules'

/**
 * Что игроку разрешено делать в учебной партии.
 *
 * Обучение ведёт игрока по шагам: у каждого шага свой список разрешённых действий, остальные
 * кнопки спрятаны. Шага может не быть — либо он ещё не пришёл с сервера, либо сценарий уже
 * пройден и полигон стал свободным. Тогда ориентир один: отфильтрованные сервером `legalActions`.
 *
 * Запрет на «сдаться» живёт в правилах (`SCENARIO_FORBIDDEN_ACTIONS`) и действует на обоих
 * концах: сервер такое действие не примет, а здесь прячется кнопка.
 */

export interface TutorialActionPermission {
  /** Партия учебная: вне обучения ограничений нет. */
  tutorialMode: boolean
  /** Список разрешённых действий текущего шага; `undefined` — шага нет. */
  allowedActions?: readonly (string | ScenarioActionConstraint)[]
  /** Действия, которые сервер считает законными для игрока прямо сейчас. */
  legalActions: readonly { id: string }[]
}

export function tutorialAllowsAction(
  actionId: string,
  { tutorialMode, allowedActions, legalActions }: TutorialActionPermission,
): boolean {
  if (!tutorialMode) return true
  if (SCENARIO_FORBIDDEN_ACTIONS.has(actionId)) return false
  if (allowedActions === undefined) {
    return legalActions.some((action) => action.id === actionId)
  }
  // Пустой список = информационный шаг без действий игрока.
  if (allowedActions.length === 0) return false
  return allowedActions.some((entry) =>
    (typeof entry === 'string' ? entry : entry.actionId) === actionId,
  )
}
