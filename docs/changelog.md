# Changelog

## [Unreleased]

### Added

- **Пакетная постройка (production batch):** несколько кораблей за маркер, размещение по региону, авто-оплата фишками (`autoAllocateTokens`), действие `execute-production-recharge` для перезарядки производства
- **UI:** `ProductionModal` — выбор количества и перезарядка; `useProductionShipPick` — размещение кораблей по клеткам региона (вместо `useProductionTokenPick`)
- **Движение с маркера действия (MVP):** валидация в `@galaxy/rules` (`movement.ts`, `ships.ts`), действие `execute-marker-movement`, один маркер за ход в фазе «Действия»
- **UI:** движение с маркера — модалка выбора кораблей (`MarkerActionModal`), затем назначение клеток кликами по карте с баннером-подсказкой (`useMarkerMapPick`); вход в режиме «Осмотр» по клику на свою клетку с маркером
- Monorepo scaffold: `@galaxy/rules`, `@galaxy/server`, `@galaxy/client`, `@galaxy/llm-player`, `@galaxy/mcp-server`
- Map editor (creative mode) at `/editor`
- MCP game tools + geometry observation (ASCII map)
- Harness scripts for git worktrees
- Project skills and ADRs
- Multi-level map display: detail view until strategic zoom; operational/overview mode temporarily disabled
- Strategic view uses custom compact icons (ships, resources, power, markers) instead of full glyphs

### Changed

- **`execute-production`:** параметры `{ markerId, ships: ShipPlacement[] }` вместо одиночного корабля и ручного выбора фишек; `ProductionBuildPlan` сохранён как thin wrapper
- Нейтральные клетки на карте (`HexBoard`): единая заливка `#6a7483` для пустых и с точками интереса (раньше `#4b5563` с opacity 0.58 vs `#8993a3`)
- Unified map display: ships always use full `ShipGlyph` layout; resources, power centers and markers use compact `HexCellOverview` at all zoom levels (overlay scales up when zoom ≤ 45%)
- Phase advancement: button «К планированию / действиям / производству / Завершить ход» cycles events → planning → actions → production and rotates active player (local + server)
- Turn order: within each phase all players act in sequence (P1→P2→P3); phase changes only after the last player; client auto-switches controlled player on pass (debug)
- Фаза «Действия»: за свой ход в фазе каждый игрок может исполнить **только один** маркер действия; флаг `actionMarkerResolvedThisTurn` в `GameSnapshot`, сброс при смене активного игрока в фазе и при входе в фазу «Действия»; валидация в `executeMarkerMovement` / `validateMarkerMovement`
- **Движение снабжения:** захват нейтральной клетки снимает корабль с карты; в UI — выбор «занять» или «только переместить»
- Маркер действия только на клетке с **своим кораблём**; фаза «Действия» не заканчивается, пока на карте есть маркеры; снятие маркера без исполнения — с подтверждением, **только до** исполнения маркера в этом ходу
- Фаза «Производство»: `productionMarkerResolvedThisTurn`, снятие других маркеров после постройки заблокировано; новый круг фазы при оставшихся маркерах

### Fixed

- Движение с маркера: модалка больше не блокирует карту на шаге назначения клеток — после выбора кораблей открывается режим клика по карте с баннером сверху
- Server memory: UI API uses `geometry=0` (no ASCII map rebuild per request); event log capped at 200 entries; Fastify request logging off by default
- Vitest OOM on Windows: rules tests run in a single fork
