# Деплой на Railway: один контейнер с интерфейсом и API

Дата: 2026-08-29
Ветка: agent/debug-combat-markers-ui

## Суть

Игру можно выложить на Railway одним сервисом: сервер отдаёт сайт и обрабатывает запросы к API по префиксу `/api`. Локальная разработка по-прежнему через два процесса (`pnpm dev`), но прокси клиента теперь не снимает префикс `/api` — как в production.

## Правила

Правила игры не менялись.

## Код

- `Dockerfile`, `railway.toml`, `.dockerignore` — сборка и деплой.
- `packages/server/src/static.ts` — раздача статики Nuxt (`nuxt generate`).
- `packages/server/src/index.ts` — маршруты API под `/api`.
- `packages/client/nuxt.config.ts` — прокси `/api` без переписывания пути.
- `packages/rules/package.json` — экспорт `node` → скомпилированный `dist` для Node в production.
- Скрипты: `build:deploy`, `start`, `client generate`.

## API / контракт

Внешние HTTP-запросы к игровому серверу идут с префиксом `/api` (например `/api/health`, `/api/rooms`). Прямые вызовы без префикса в документации агентов относятся к внутренним маршрутам Fastify при прямом подключении к порту сервера в dev.

## UI

Интерфейс для игрока не менялся; после деплоя открывается тот же клиент по домену Railway.

## Тесты

- Локально: `pnpm run build:deploy && PORT=8080 pnpm start`, затем `/api/health` и главная страница.
- `pnpm test && pnpm typecheck`.
- Инструкция: `docs/deploy-railway.md`.

## Миграции

Миграция сохранений не нужна.
