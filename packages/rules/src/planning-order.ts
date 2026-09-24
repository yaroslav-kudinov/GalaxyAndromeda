/**
 * Строгий порядок решений в начале хода. Каждое следующее зависит от предыдущего:
 *
 * 1. потери в осаде — тик осады идёт первым, до всего остального;
 * 2. доктрина — меняет и лимит захвата, и бюджет перезарядки. Доктрины вскрываются разом,
 *    поэтому выбравший ждёт остальных;
 * 3. клетки захвата — захват меняет число центров власти, а значит бюджет;
 * 4. фишки перезарядки;
 * 5. и только потом расстановка маркеров действия и передача хода.
 */
import { claimPicksRemaining } from './claim.js'
import { doctrineChoiceOwed } from './doctrines.js'
import { rechargePicksRemaining } from './resource-recharge.js'
import type { GameSnapshot } from './save-file.js'
import { SIEGE_LOSS_ERRORS, siegeLossesOwedBy } from './siege.js'

export type PlanningStep =
  | 'siege-losses'
  | 'doctrine'
  | 'doctrine-wait'
  | 'claims'
  | 'recharge'
  | 'markers'

const STEP_ORDER: readonly PlanningStep[] = [
  'siege-losses',
  'doctrine',
  'doctrine-wait',
  'claims',
  'recharge',
  'markers',
]

/** Какой шаг планирования сейчас за игроком. Вне планирования — «маркеры»: ограничений нет. */
export function planningStepFor(game: GameSnapshot, playerId: string): PlanningStep {
  if (game.phase !== 'planning' || game.gameOver) return 'markers'
  if (siegeLossesOwedBy(game, playerId).length > 0) return 'siege-losses'
  if (doctrineChoiceOwed(game, playerId)) return 'doctrine'
  if (game.doctrineChoice) return 'doctrine-wait'
  if (claimPicksRemaining(game, playerId) > 0) return 'claims'
  if (rechargePicksRemaining(game, playerId) > 0) return 'recharge'
  return 'markers'
}

export const PLANNING_ORDER_ERRORS: Record<Exclude<PlanningStep, 'markers'>, string> = {
  'siege-losses': SIEGE_LOSS_ERRORS.chooseFirst,
  doctrine: 'Сначала выберите доктрину',
  'doctrine-wait': 'Ждём, пока доктрину выберут все игроки',
  claims: 'Сначала выберите клетки для захвата',
  recharge: 'Сначала выберите фишки для перезарядки',
}

/** Каким шагом планирования делается действие; прочие действия порядок не проверяет. */
const STEP_OF_ACTION: Readonly<Record<string, PlanningStep>> = {
  'execute-siege-losses': 'siege-losses',
  'choose-doctrine': 'doctrine',
  'execute-claim-picks': 'claims',
  'execute-recharge-picks': 'recharge',
  'toggle-marker': 'markers',
  'remove-marker': 'markers',
  'advance-phase': 'markers',
}

/**
 * Ошибка, если действие забегает вперёд порядка планирования. Действие более раннего шага
 * порядок не нарушает — его проверит сам обработчик («сейчас это не нужно»).
 */
export function planningOrderError(game: GameSnapshot, playerId: string, actionId: string): string | null {
  const required = STEP_OF_ACTION[actionId]
  if (!required) return null
  const step = planningStepFor(game, playerId)
  if (step === 'markers') return null
  return STEP_ORDER.indexOf(required) > STEP_ORDER.indexOf(step) ? PLANNING_ORDER_ERRORS[step] : null
}
