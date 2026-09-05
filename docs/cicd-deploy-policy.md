# Политика CI/CD и деплоя

## Принцип

**Хостинг Amvera синхронизирован с веткой `main` на GitHub.** Достаточно `git push origin main` — отдельный `git push amvera` **не нужен** и агентам его делать не следует.

Выкладка на другие платформы (Railway и т.п.) или ручной обход синхронизации — **только по явной команде** человека, не «молча» после локальных правок.

## Amvera (основной хостинг)

| Делать | Не делать |
|--------|-----------|
| Commit → merge → `git push origin main` | `git push amvera …` |
| Просить «залей в main» / «на хостинг» = push в GitHub `main` | Дублировать выкладку в git Amvera |

После появления коммита в `origin/main` Amvera подхватывает сборку сама (привязка к репозиторию GitHub).

## Что ещё считается отдельным деплоем (только по просьбе)

- Railway / Render / иной PaaS вне связки GitHub↔Amvera
- Ручной `railway up`, `fly deploy`, обновление Docker на VPS
- Любой скрипт, публикующий production-сборку мимо GitHub `main` (`pnpm run build:deploy` + выкладка)

## Что не является отдельным шагом хостинга

- `git push origin main` (это и есть выкладка на Amvera через синхронизацию)
- Локальный `pnpm dev` / `pnpm test`
- PR без merge в `main`

## Кто инициирует

- **Человек** в чате: «залей в main», «на хостинг», «задеплой»
- **Агент** — после явной просьбы: push в `origin/main`, **без** remote `amvera`

## Рекомендуемый поток

1. Разработка → commit → merge в `main`
2. `pnpm test && pnpm typecheck`
3. `git push origin main` — хостинг Amvera обновляется через синхронизацию с GitHub

Подробности конфигурации контейнера: [docs/deploy-amvera.md](./deploy-amvera.md). Исторический push в git Amvera описан там только как запасной путь, не как обычный процесс агента.

## GitHub Actions

В репозитории **нет** отдельного workflow «deploy на Amvera». Сборка на хостинге идёт из синхронизации с `main`. При добавлении CI-деплоя на другие цели — только `workflow_dispatch` или protected-ветка `release`.
