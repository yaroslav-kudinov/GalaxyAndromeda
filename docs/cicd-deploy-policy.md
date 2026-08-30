# Политика CI/CD и деплоя

## Принцип

**Новая версия приложения выкатывается на хостинг только по явной централизованной команде** — не автоматически при каждом push в GitHub и не агентом «молча» после локальных правок.

## Что считается деплоем

- Push в git Amvera (`git push amvera …`), запускающий сборку на Amvera
- Railway / Render / иной PaaS, если подключён autodeploy
- Ручной `railway up`, `fly deploy`, обновление Docker на VPS
- Любой скрипт, публикующий production-сборку (`pnpm run build:deploy` + выкладка)

## Что не является деплоем

- `git push origin` только в GitHub (архив кода)
- Локальный `pnpm dev` / `pnpm test`
- PR и merge в `main` без отдельного шага деплоя

## Кто инициирует

- **Человек** в чате или в CI: «задеплой», «выложи на Amvera», workflow `deploy` с ручным `workflow_dispatch`
- **Агент** — только после явной просьбы пользователя; в ответе указать команду и целевой хост

## Рекомендуемый поток

1. Разработка → commit → `git push origin main`
2. `pnpm test && pnpm typecheck`
3. По запросу: `git push amvera main:master` (или выбранный deploy-скрипт из `docs/deploy-amvera.md`)

## GitHub Actions

В репозитории **нет** autodeploy на push. При добавлении workflow деплой — только `workflow_dispatch` или отдельная protected-ветка `release`, не `main` на каждый commit.
