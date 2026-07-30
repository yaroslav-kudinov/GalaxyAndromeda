# Galaxy Andromeda Tabletop

Веб-приложение для настольной игры **«Галактика Андромеда»**: движок правил, Nuxt-клиент, мультиплеерный сервер и MCP-инструменты для AI-агентов.

## Требования

| Инструмент | Версия |
|------------|--------|
| Node.js | ≥ 20 |
| pnpm | 9+ (рекомендуется) |

```bash
node -v
pnpm -v
```

## Быстрый старт

```bash
git clone <repo-url> GalaxyAndromedaTabletop
cd GalaxyAndromedaTabletop
pnpm install
pnpm dev
```

После запуска:

| Сервис | URL | Назначение |
|--------|-----|------------|
| Клиент (Nuxt) | http://localhost:3000 | UI: лобби, редактор карт, игра |
| Сервер (Fastify) | http://localhost:3001 | REST API, комнаты, синхронизация |

Проверка сервера:

```bash
curl http://127.0.0.1:3001/health
# {"ok":true,"service":"@galaxy/server"}
```

Клиент проксирует `/api/*` → `http://127.0.0.1:3001/*` (см. `packages/client/nuxt.config.ts`).

## Структура монорепо

```
packages/
  rules/     @galaxy/rules   — правила, карта, бой, observation (источник истины)
  server/    @galaxy/server  — Fastify + WebSocket, комнаты, actions
  client/    @galaxy/client  — Nuxt 3 SPA
  llm-player/                — промпты/парсер для LLM-игрока
harness/
  mcp-server/ @galaxy/mcp-server — MCP-инструменты для Cursor
  scenarios/                   — JSON-фикстуры для тестов
  scripts/                     — worktree, simulate-lobby и т.д.
docs/                          — правила, протокол API, ADR, changelog
```

Подробнее: [docs/architecture.md](./docs/architecture.md).

## Основные команды

```bash
pnpm dev          # клиент :3000 + сервер :3001 (параллельно)
pnpm test         # Vitest в @galaxy/rules (+ заглушки в других пакетах)
pnpm typecheck    # TypeScript по всем пакетам
pnpm build        # production-сборка
pnpm smoke        # end-to-end MCP → server (harness/agent-smoke)
```

Команды для отдельного пакета:

```bash
pnpm --filter @galaxy/rules test
pnpm --filter @galaxy/server dev
pnpm --filter @galaxy/client dev
pnpm --filter @galaxy/mcp-server dev
```

## Режимы игры

### Offline (локально)

- Создаётся комната с id вида `local-<timestamp>`.
- Состояние хранится в `localStorage` (`galaxy-save-<roomId>`).
- Сервер **не нужен** — правила выполняются в браузере через `@galaxy/rules`.
- Подходит для одиночной отладки UI и механик без сети.

### Online (мультиплеер)

- Сервер обязателен (`pnpm dev`).
- Комната создаётся через `POST /rooms`, игроки входят через join/rejoin.
- Клиент опрашивает `GET /rooms/:id/state` и шлёт действия через `POST /rooms/:id/action`.
- Подготовка к бою, события хода, supply chains — синхронизируются через observation.

Список активных лобби: http://localhost:3000/lobbies

## Маршруты клиента

| Путь | Описание |
|------|----------|
| `/` | Главная: новая игра, импорт `.galaxy.json`, offline/online |
| `/lobbies` | Список онлайн-комнат |
| `/game/:roomId` | Игровое поле, фазы, маркеры, бой |
| `/editor` | Редактор карт (creative mode) |

## Границы пакетов

| Пакет | Менять свободно | Требует согласования |
|-------|-----------------|----------------------|
| `@galaxy/rules` | логика, тесты | `types.ts` — нужен ADR в `docs/decisions/` |
| `@galaxy/server` | room.ts, роуты | HTTP/WS контракт — `docs/agent-protocol.md` |
| `@galaxy/client` | Vue-компоненты, composables | — |
| `@galaxy/mcp-server` | реализация | **имена tools** стабильны для агентов |

**Принцип:** сервер — единственный источник истины в online; клиент и MCP не мутируют состояние напрямую, только через actions.

## API (кратко)

Полный контракт: [docs/agent-protocol.md](./docs/agent-protocol.md).

| Method | Path | Назначение |
|--------|------|------------|
| GET | `/health` | Проверка живости |
| POST | `/rooms` | Создать комнату (map или save) |
| POST | `/rooms/:id/join` | Войти в комнату |
| POST | `/rooms/:id/rejoin` | Повторный вход по playerId |
| GET | `/rooms/:id/state?playerId=` | Observation (UI: `geometry=0`) |
| POST | `/rooms/:id/action` | Выполнить action |
| GET | `/lobbies` | Список комнат |

**Важно:** все мутации — только `POST /action` с телом `{ playerId, action: { actionId, params } }`. Клиент добавляет `?geometry=0`, чтобы сервер не строил ASCII-карту для UI.

Боевые actionId: `execute-marker-movement`, `execute-marker-bombardment`, `update-combat-prep`, `cancel-combat-prep`, `continue-combat`, `confirm-combat-destruction`, `stop-combat`.

## Где что искать в коде

| Задача | Файлы |
|--------|-------|
| Правила боя | `packages/rules/src/combat.ts`, `bombardment.ts` |
| Фазы хода, события | `packages/rules/src/turn.ts`, `events.ts` |
| Маркеры, движение | `packages/rules/src/markers.ts`, `movement.ts` |
| HTTP-роуты | `packages/server/src/room.ts` |
| Игровая страница | `packages/client/pages/game/[roomId].vue` |
| Модалка боя | `packages/client/components/BattleModal.vue` |
| API-клиент | `packages/client/composables/useGameApi.ts` |
| Тесты правил | `packages/rules/src/*.test.ts`, `rulebook-compliance.test.ts` |

## Отладка

### Сервер не отвечает

1. Убедитесь, что `pnpm dev` запущен и в логах есть `@galaxy/server listening on http://0.0.0.0:3001`.
2. На главной и в `/lobbies` индикатор сервера должен быть зелёным («online»).

### Ошибки API / боя

- **404 `Route GET:/rooms/.../action`** — клиент отправил GET вместо POST. После фикса `useGameApi` запросы с телом принудительно POST + `redirect: 'error'`. Обновите страницу (Ctrl+F5).
- **Подготовка к бою** (`update-combat-prep`) — action идёт через `POST /action`; оба игрока должны нажать «Готов», затем countdown 3 с.
- Для локальной игры запускайте `pnpm dev` и открывайте `http://localhost:3000`: HMR использует `ws://localhost:3000` автоматически.
- При работе через **tuna/HTTPS-туннель** направляйте туннель на порт **3000** (клиент), не на 3001 напрямую — иначе прокси `/api` не сработает. Запускайте клиент с `NUXT_HMR_TUNNEL=1`, чтобы HMR использовал `wss` на порту `443`.

### Отладка логов

При `pnpm dev` сервер печатает в stdout структурированные строки `[galaxy]` для входа в комнату, смены presence, действий, подготовки/авторазрешения боя, изменения `observationRevision` и HTTP-ошибок. Для трёх браузеров удобнее отфильтровать по `roomId`, `playerId` или `actionId`.

Клиентский журнал API и observation включается в каждом браузере отдельно: откройте игру с `?debug=1` или выполните в DevTools `localStorage.setItem('galaxy-debug-logs', '1')`, затем обновите страницу. Логи появятся в Console. Отключение: `localStorage.removeItem('galaxy-debug-logs')`.

Последние 300 серверных записей доступны только вне production: `http://localhost:3001/debug/logs?roomId=<roomId>` (через клиентский прокси также `/api/debug/logs?roomId=<roomId>`). Endpoint не регистрируется при `NODE_ENV=production`.

### Тесты правил

```bash
pnpm --filter @galaxy/rules test
```

На Windows Vitest может потреблять много памяти; при OOM используется `--pool=forks --poolOptions.forks.singleFork=true` (уже в `package.json`).

### Локальная симуляция лобби

```bash
node harness/scripts/simulate-lobby.mjs
```

## Параллельная разработка (worktrees)

Для нескольких агентов/веток без конфликтов:

```powershell
./harness/scripts/new-worktree.ps1 -Branch agent/my-task -Path ../GalaxyAndromeda-my-task
cd ../GalaxyAndromeda-my-task
pnpm install
```

Одна ветка = `agent/<scope>`. Merge: rebase на `main`, `pnpm test`, merge, удалить worktree.

Подробнее: [docs/agent-workflows.md](./docs/agent-workflows.md).

## MCP для AI-агентов

1. Запустите сервер: `pnpm dev` (или только `@galaxy/server`).
2. В Cursor включите MCP-сервер из `.cursor/mcp.json` (`galaxy-game`).
3. Агент получает tools: `game_create_room`, `game_get_state`, `game_submit_action` и др.

Observation для агентов включает **полную геометрию** (ASCII-карта + spatial summary). UI запрашивает `geometry=0` для экономии памяти.

Руководство для агентов: [AGENTS.md](./AGENTS.md).

## Документация

| Документ | Содержание |
|----------|------------|
| [docs/rulebook.md](./docs/rulebook.md) | Правила игры (референс для кода) |
| [docs/agent-protocol.md](./docs/agent-protocol.md) | REST API, combat actions, observation |
| [docs/save-format.md](./docs/save-format.md) | Формат `.galaxy.json` |
| [docs/map-format.md](./docs/map-format.md) | Формат карт |
| [docs/changelog.md](./docs/changelog.md) | История изменений |
| [docs/decisions/](./docs/decisions/) | ADR (архитектурные решения) |
| [harness/README.md](./harness/README.md) | MCP, scenarios, smoke |

## Перед коммитом / PR

1. `pnpm test && pnpm typecheck` в затронутых пакетах
2. Обновить [docs/changelog.md](./docs/changelog.md)
3. При изменении контрактов (`types.ts`, API) — ADR в `docs/decisions/`

## Cursor Skills

В `.cursor/skills/` — готовые инструкции для агентов:

- `galaxy-dev` — разработка фич
- `galaxy-debug` — отладка, регрессии
- `galaxy-play` — игра через MCP
- `galaxy-map-editor` — редактор карт
- `galaxy-rulebook` — правила и баланс
