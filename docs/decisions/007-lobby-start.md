# ADR 007: Комната подготовки (лобби) до старта партии

## Status

Accepted

## Context

Создание комнаты сразу запускало планирование. Очередь хода шла по `activePlayerId`, поэтому игрок, вошедший вторым, не мог ставить маркеры: это был чужой ход, либо фаза уже ушла дальше. Нужно ждать состав и стартовать явно.

## Decision

- Комната имеет `status: 'lobby' | 'playing'` и `hostPlayerId` (первый вошедший). Это поля серверной комнаты, не `GameSnapshot` / `types.ts`.
- Новая комната (с карты или из сейва) создаётся в `lobby`. Игровые действия и `legalActions` недоступны, пока статус не `playing`.
- В лобби игроки выбирают слот (`player-N`): это стартовая позиция на карте и цвет. Слот можно сменить через `rejoin` с `preferredPlayerId`.
- Хост вызывает `POST /rooms/:id/start`. Для «чистой» партии (`isPristineMatchSnapshot`) вызывается `beginMatchForParticipants`: очередь среди вошедших, корабли/контроль пустых слотов снимаются.
- После старта новые слоты закрыты; повторный вход в свой слот разрешён.
- Observation: `roomStatus`, `hostPlayerId`. MCP: `game_start_room`.

## Consequences

- Клиент держит оверлей подготовки, пока `roomStatus === 'lobby'`.
- Старые `.dev-rooms` без `status` считаются `playing`.
- Агенты после `game_join_room` должны вызвать `game_start_room` (хост), иначе `game_submit_action` вернёт ошибку.
