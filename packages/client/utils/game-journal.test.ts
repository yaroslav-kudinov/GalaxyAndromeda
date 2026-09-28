import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameEvent } from '@galaxy/rules'
import { buildGameJournal, humanizeAction } from './game-journal'

let seq = 0
function event(turn: number, phase: GameEvent['phase'], type: string, message: string): GameEvent {
  return { id: `e${++seq}`, turn, phase, type, message, timestamp: seq }
}

const players = [
  { id: 'p1', name: 'Серафал' },
  { id: 'p2', name: 'Бот Альфа' },
]

test('действия приписываются тому, чья очередь, и пишутся человеческим языком', () => {
  const journal = buildGameJournal([
    event(3, 'planning', 'phase', 'Ход 3, фаза «Планирование», ход Серафал'),
    event(3, 'planning', 'claim', 'Захват клеток: Бот Альфа: (2,0) — центр власти'),
    event(3, 'actions', 'phase', 'Фаза «Действия», ход Бот Альфа'),
    event(3, 'actions', 'movement', 'Движение с (2,0): Крейсер → (3,0); Эсминец → (3,1); бой: атакующий победил'),
    event(3, 'actions', 'combat', 'Защитник отступил в (4,0)'),
    event(3, 'actions', 'phase', 'Фаза «Действия», ход Серафал (пропуск без действий)'),
  ], players)

  assert.equal(journal.length, 1)
  const [claim, move, retreat, skip] = journal[0]!.entries
  assert.equal(claim!.actorId, null)
  assert.equal(move!.actorId, 'p2')
  assert.equal(move!.text, 'ведёт корабли из (2,0): крейсер → (3,0); эсминец → (3,1). Бой: атакующий победил')
  assert.deepEqual(move!.coords, [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 3, r: 1 }])
  // Отступил защитник, а не тот, чья очередь: без подписи.
  assert.equal(retreat!.actorId, null)
  assert.equal(skip!.actorId, 'p1')
  assert.equal(skip!.minor, true)
})

test('ходы — новые сверху', () => {
  const journal = buildGameJournal([
    event(1, 'planning', 'claim', 'Захват клеток: Серафал: (0,0)'),
    event(2, 'planning', 'claim', 'Захват клеток: Серафал: (1,0)'),
  ], players)
  assert.deepEqual(journal.map((turn) => turn.turn), [2, 1])
})

test('постройка сворачивает одинаковые корабли', () => {
  assert.equal(
    humanizeAction('Построено: Крейсер@(1,5), Крейсер@(1,5), Эсминец@(2,5)'),
    'строит: крейсер ×2 на (1,5), эсминец на (2,5)',
  )
  assert.equal(humanizeAction('Подготовка к бою на (0,-2)'), 'нападает на клетку (0,-2)')
})
