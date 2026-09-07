# ADR 013: Обучающие сценарии и прогресс в GameSnapshot

Дата: 2026-08-31  
Обновлено: 2026-09-07

## Контекст

Нужен одиночный режим обучения с пошаговыми подсказками и управляемыми учебными флотами. Первая версия держала только одного бота и не ограничивала действия игрока по параметрам.

## Решение

- Формат сценария в JSON (`ScenarioScript`, `ScenarioStep`).
- Поле `GameSnapshot.scenarioProgress?: { scenarioId, stepIndex, completed? }`.
- Скрытая карта `tutorial-corridor` (не публикуется в каталог лобби) и сценарий `tutorial-basics`.
- Несколько учебных флотов: `ScenarioScript.bots[]`; `room.botPlayerIds` сохраняется вместе с комнатой.
- Ограничения шага: `allowedActions` как строки или `{ actionId, params? }` с частичным сравнением параметров; сервер фильтрует `legalActions` и отклоняет чужие действия.
- Условия продвижения: `action` (с `playerId`/`params`), `phase`, `cell`, `combat`, `and`/`or`, `manual`.
- Сценарные команды ботам: `botPolicy`, `botSupportSide`; bot-tick обрабатывает боевую готовность вне хода фазы.
- Предсказуемая колода: опциональный `eventDeck` в сценарии.
- Клиентская панель coach: номер шага, задание, зачем, подсказка, подсветка клетки/панели; «Далее» только на `manual`.

## Последствия

- Поле `scenarioProgress` опционально — старые сейвы совместимы.
- Контракт observation расширен полями шага (`objective`, `why`, `hint`, `manual`, `stepNumber`, `stepCount`, `allowedActions`).
- LLM-бот не используется в обучении.
