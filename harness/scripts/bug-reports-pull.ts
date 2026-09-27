/**
 * Скачать баг-репорты с сервера в папку `bug-reports-inbox/` — читать самому и отдавать агенту.
 *
 *   pnpm bug-reports:pull            скачать новые
 *   pnpm bug-reports:pull --delete   скачать и удалить скачанные с сервера
 *
 * Токен администратора берётся из `GALAXY_ADMIN_TOKEN` (окружение или `.env.local` в корне основной
 * папки репозитория) и нигде не печатается. Адрес сервера — `GALAXY_SERVER_URL`, по умолчанию хостинг.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_SERVER = 'https://galandromeda-yaroslavkudinov.amvera.io'

interface BugReport {
  id: string
  createdAt: string
  expiresAt: string
  description: string
  playerId?: string
  playerName?: string
  roomId?: string
  userAgent?: string
  hasScreenshot: boolean
}

/** Корень основной папки репозитория: из рабочей копии `.claude/worktrees/*` — тоже он. */
function mainRepoRoot(): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim()
    return dirname(common)
  } catch {
    return process.cwd()
  }
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || line.trim().startsWith('#')) continue
    out[match[1]!] = match[2]!.trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const root = mainRepoRoot()
const fileEnv = readEnvFile(join(root, '.env.local'))
const token = (process.env.GALAXY_ADMIN_TOKEN ?? fileEnv.GALAXY_ADMIN_TOKEN ?? '').trim()
const server = (process.env.GALAXY_SERVER_URL ?? fileEnv.GALAXY_SERVER_URL ?? DEFAULT_SERVER).replace(/\/+$/, '')
const deleteAfter = process.argv.includes('--delete')
const inbox = resolve(root, 'bug-reports-inbox')

if (!token) fail(`Нет GALAXY_ADMIN_TOKEN: добавьте его в ${join(root, '.env.local')}`)

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${server}/api/admin${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  if (res.status === 503) fail('На сервере не задан GALAXY_ADMIN_TOKEN (или приложение не перезапущено после его добавления).')
  if (res.status === 401) fail('Сервер не принял токен: значение в .env.local не совпадает с GALAXY_ADMIN_TOKEN на сервере.')
  return res
}

function folderName(report: BugReport): string {
  const stamp = report.createdAt.slice(0, 16).replace('T', '_').replace(':', '-')
  return `${stamp}-${report.id.slice(0, 8)}`
}

function reportMarkdown(report: BugReport, screenshot: string | null): string {
  const lines = [
    `# Баг-репорт ${report.id}`,
    '',
    `- Когда: ${report.createdAt}`,
    `- Игрок: ${report.playerName ?? '—'}${report.playerId ? ` (${report.playerId})` : ''}`,
    `- Комната: ${report.roomId ?? '—'}`,
    `- Браузер: ${report.userAgent ?? '—'}`,
    `- Хранится на сервере до: ${report.expiresAt}`,
    `- Скриншот: ${screenshot ? `[${screenshot}](./${screenshot})` : 'нет'}`,
    '',
    '## Описание',
    '',
    report.description,
    '',
  ]
  if (screenshot) lines.push(`![Скриншот](./${screenshot})`, '')
  return lines.join('\n')
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

async function pull(): Promise<void> {
  const res = await admin('/bug-reports')
  if (res.status === 404) fail('На сервере ещё нет просмотра баг-репортов: нужна выкладка ветки с админкой репортов.')
  if (!res.ok) fail(`Сервер ответил ${res.status}`)
  const { reports } = (await res.json()) as { reports: BugReport[] }

  mkdirSync(inbox, { recursive: true })
  const fresh: string[] = []
  let deleted = 0
  const removeFromServer = async (id: string) => {
    if (!deleteAfter) return
    if ((await admin(`/bug-reports/${id}`, { method: 'DELETE' })).ok) deleted += 1
  }
  for (const report of reports) {
    const dir = join(inbox, folderName(report))
    // Уже скачан раньше: заново не качаем, но с --delete убираем с сервера и его.
    if (existsSync(join(dir, 'report.md'))) {
      await removeFromServer(report.id)
      continue
    }
    mkdirSync(dir, { recursive: true })
    let screenshot: string | null = null
    if (report.hasScreenshot) {
      const shot = await admin(`/bug-reports/${report.id}/screenshot`)
      if (shot.ok) {
        const ext = EXT_BY_MIME[shot.headers.get('content-type')?.split(';')[0] ?? ''] ?? 'png'
        screenshot = `screenshot.${ext}`
        writeFileSync(join(dir, screenshot), Buffer.from(await shot.arrayBuffer()))
      }
    }
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(dir, 'report.md'), reportMarkdown(report, screenshot))
    fresh.push(report.id)
    await removeFromServer(report.id)
  }

  writeIndex(new Set(fresh))
  console.log(`Скачано новых: ${fresh.length}, было на сервере: ${reports.length}${deleteAfter ? `, удалено с сервера: ${deleted}` : ''}`)
  console.log(`Папка: ${inbox}`)
}

/** Общий список по всем скачанным репортам, новые сверху. */
function writeIndex(fresh: ReadonlySet<string>): void {
  const reports = readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(inbox, entry.name, 'meta.json')))
    .map((entry) => ({
      folder: entry.name,
      report: JSON.parse(readFileSync(join(inbox, entry.name, 'meta.json'), 'utf8')) as BugReport,
    }))
    .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt))
  const lines = [
    '# Баг-репорты',
    '',
    `Скачано: ${new Date().toISOString()} с ${server}. Всего в папке: ${reports.length}.`,
    '',
    '| Когда | Игрок | Комната | Скриншот | Описание |',
    '|---|---|---|---|---|',
  ]
  for (const { folder, report } of reports) {
    const text = report.description.replace(/\s+/g, ' ').replace(/\|/g, '\\|')
    const short = text.length > 90 ? `${text.slice(0, 90)}…` : text
    lines.push(
      `| ${fresh.has(report.id) ? '**новый** ' : ''}[${report.createdAt.slice(0, 16).replace('T', ' ')}](./${folder}/report.md)`
        + ` | ${report.playerName ?? '—'} | ${report.roomId?.slice(0, 8) ?? '—'} | ${report.hasScreenshot ? 'да' : '—'} | ${short} |`,
    )
  }
  writeFileSync(join(inbox, 'index.md'), `${lines.join('\n')}\n`)
}

await pull()
