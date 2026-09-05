# ADR 013: Обучающие сценарии и прогресс в GameSnapshot

Дата: 2026-08-31

## Контекст

Нужен одиночный режим обучения с пошаговыми подсказками и пассивным ботом.

## Решение

- Формат сценария в JSON (`ScenarioScript`, `ScenarioStep`).
- Поле `GameSnapshot.scenarioProgress?: { scenarioId, stepIndex, completed? }`.
- Серверный bot-tick для `player-2` в режиме `room.mode === 'tutorial'`.
- Клиентская панель coach читает `observation.tutorial`.

## Последствия

- Изменение `GameSnapshot` требует миграции сейвов (поле опционально, старые сейвы совместимы).
- LLM-бот не используется в обучении.
