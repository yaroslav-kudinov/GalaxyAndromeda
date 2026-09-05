# Деплой на Amvera

Один контейнер отдаёт **интерфейс** (Nuxt) и **API** (`/api/...`) на одном порту. Amvera подставляет переменную `PORT` (обычно `80`).

## Обычный поток (агенты и разработка)

**Amvera привязана к репозиторию на GitHub и синхронизируется с веткой `main`.**

```powershell
git push origin main
```

Этого достаточно для выкладки. **Не** делайте `git push amvera` — отдельный remote Amvera для повседневной работы не нужен.

Политика для агентов: [docs/cicd-deploy-policy.md](./cicd-deploy-policy.md), [harness/README.md](../harness/README.md).

## Требования

- Аккаунт [Amvera](https://amvera.ru)
- Репозиторий на GitHub, подключённый к проекту Amvera
- В корне: `Dockerfile`, `amvera.yaml`

## Шаги в панели Amvera

1. **Создать проект** → имя, например `galaxy-andromeda` (латиница, транслит).
2. **Тариф:** для первой сборки monorepo (pnpm + Nuxt) лучше **не меньше 2 ГБ RAM** (тариф «Стандарт» или выше).
3. Подключить **GitHub**-репозиторий и ветку `main` (предпочтительный способ).
4. После первого деплоя: **Домены** → создать технический домен `*.amvera.io` (или привязать свой).

Конфигурацию можно править в разделе «Конфигурация» — файл `amvera.yaml` в корне репозитория.

## Запасной путь: push в git Amvera

Только если синхронизация с GitHub недоступна или человек явно просит обойти её:

```powershell
cd E:\PetsAndTests\GalaxyAndromedaTabletop

git remote add amvera https://git.amvera.ru/<логин>/<имя-проекта>

# Amvera слушает ветку master; локальная main → remote master
git push amvera main:master
```

Логин и пароль — из личного кабинета Amvera (раздел git / учётные данные). Агентам по умолчанию этот путь **запрещён**.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `PORT` | Amvera задаёт (80) | Порт HTTP |
| `HOST` | `0.0.0.0` в образе | Слушать все интерфейсы |
| `NODE_ENV` | `production` | Режим production |
| `CLIENT_STATIC_DIR` | `/app/packages/client/.output/public` | Статика Nuxt |
| `LOG_LEVEL` | выкл. | Логи Fastify |

Дополнительно настраивать обычно не нужно.

## Проверка

- `GET /api/health` — основная проба
- `GET /health` — короткая проба
- Главная, лобби, создание комнаты — как локально
- WebSocket: `/api/ws`

## Ограничения

- **Комнаты в памяти:** перезапуск обнуляет активные партии.
- **Диск эфемерный:** баг-репорты не сохраняются между деплоями (папка `/data` при необходимости — в `amvera.yaml` → `persistenceMount`).
- **Сборка:** первая сборка Docker может занять 10–15 минут.

## Локальная проверка образа

```bash
pnpm run build:deploy
docker build -t galaxy-andromeda .
docker run --rm -p 8080:80 -e PORT=80 galaxy-andromeda
```

## См. также

- [cicd-deploy-policy.md](./cicd-deploy-policy.md) — что считать выкладкой для агентов
- [deploy-railway.md](./deploy-railway.md) — альтернатива на Railway
