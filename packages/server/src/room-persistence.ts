/**
 * Dev-персист комнат: по файлу на комнату в `.dev-rooms/` в корне репозитория.
 * Нужен только для ручной отладки — рестарт `tsx watch` больше не убивает живые партии.
 * В production выключен: комнаты остаются in-memory.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GALAXY_SAVE_FORMAT,
  GALAXY_SAVE_VERSION,
  normalizeGalaxySave,
  parseGalaxySave,
  validateGalaxySave,
  type GalaxySaveFile,
} from '@galaxy/rules'

import { debugLog } from './debug-log.js'
import type { Room } from './room.js'

const PERSIST_FILE_KIND = 'galaxy-dev-room'
const PERSIST_FILE_VERSION = 1
const DEFAULT_DEBOUNCE_MS = 400

/**
 * Сериализуемый срез комнаты. WebSocket-соединения и presence сюда не попадают:
 * их восстанавливать нечего — клиенты переподключаются сами.
 */
interface PersistedRoomFile {
  kind: typeof PERSIST_FILE_KIND
  version: typeof PERSIST_FILE_VERSION
  savedAt: string
  roomId: string
  code: string
  maxPlayers: number
  playerIds: string[]
  observationRevision: number
  lastCombatResult?: Room['lastCombatResult']
  /** Карта + снимок партии в формате обычного сохранения — переиспользуем миграции `@galaxy/rules`. */
  save: GalaxySaveFile
}

function resolveEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const flag = process.env.GALAXY_DEV_ROOMS
  return flag !== '0' && flag !== 'off' && flag !== 'false'
}

/** Персист только в dev; `GALAXY_DEV_ROOMS=0` выключает его и локально. */
export const roomPersistenceEnabled = resolveEnabled()

/** Корень репозитория ищем по `pnpm-workspace.yaml`: cwd сервера зависит от способа запуска. */
function resolveRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export const devRoomsDir = process.env.GALAXY_DEV_ROOMS_DIR
  ? resolve(process.env.GALAXY_DEV_ROOMS_DIR)
  : join(resolveRepoRoot(), '.dev-rooms')

const debounceMs = Number.isFinite(Number(process.env.GALAXY_DEV_ROOMS_DEBOUNCE_MS))
  ? Math.max(0, Number(process.env.GALAXY_DEV_ROOMS_DEBOUNCE_MS))
  : DEFAULT_DEBOUNCE_MS

/** Комнаты, ждущие записи. Значение — сама комната, поэтому на диск уходит последнее состояние. */
const dirtyRooms = new Map<string, Room>()
let flushTimer: NodeJS.Timeout | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function roomFilePath(roomId: string): string {
  return join(devRoomsDir, `${roomId}.json`)
}

function serializeRoom(room: Room): string {
  const file: PersistedRoomFile = {
    kind: PERSIST_FILE_KIND,
    version: PERSIST_FILE_VERSION,
    savedAt: new Date().toISOString(),
    roomId: room.id,
    code: room.code,
    maxPlayers: room.maxPlayers,
    playerIds: [...room.playerIds],
    observationRevision: room.observationRevision,
    lastCombatResult: room.lastCombatResult,
    save: {
      format: GALAXY_SAVE_FORMAT,
      version: GALAXY_SAVE_VERSION,
      savedAt: new Date().toISOString(),
      map: room.map,
      game: room.state,
    },
  }
  return JSON.stringify(file, null, 2)
}

/** Запись через временный файл: прерванный рестартом write не оставит половину JSON. */
async function writeRoomFile(room: Room): Promise<void> {
  const target = roomFilePath(room.id)
  const tmp = `${target}.tmp`
  await writeFile(tmp, serializeRoom(room), 'utf8')
  await rename(tmp, target)
}

async function flushDirtyRooms(): Promise<void> {
  const batch = [...dirtyRooms.values()]
  dirtyRooms.clear()
  if (!batch.length) return

  try {
    await mkdir(devRoomsDir, { recursive: true })
  } catch (error) {
    debugLog('rooms.persist.error', { dir: devRoomsDir, error: errorMessage(error) })
    return
  }

  let written = 0
  for (const room of batch) {
    try {
      await writeRoomFile(room)
      written += 1
    } catch (error) {
      debugLog('rooms.persist.error', { roomId: room.id, error: errorMessage(error) })
    }
  }
  debugLog('rooms.persist', { rooms: written })
}

/**
 * Помечает комнату «грязной» и планирует запись. Дебаунс обязателен: иначе каждое
 * действие игрока превращалось бы в синхронный дисковый цикл.
 */
export function scheduleRoomPersist(room: Room): void {
  if (!roomPersistenceEnabled) return

  dirtyRooms.set(room.id, room)
  if (flushTimer) return

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDirtyRooms()
  }, debounceMs)
  // Незаписанные комнаты дожимает exit-хук, поэтому таймер не держит процесс живым.
  flushTimer.unref?.()
}

/** Синхронный дозапись остатка очереди перед выходом процесса (SIGINT/SIGTERM от tsx watch). */
export function flushRoomPersistSync(): void {
  if (!roomPersistenceEnabled || !dirtyRooms.size) return

  const batch = [...dirtyRooms.values()]
  dirtyRooms.clear()
  try {
    mkdirSync(devRoomsDir, { recursive: true })
  } catch {
    return
  }
  for (const room of batch) {
    try {
      const target = roomFilePath(room.id)
      const tmp = `${target}.tmp`
      writeFileSync(tmp, serializeRoom(room), 'utf8')
      renameSync(tmp, target)
    } catch {
      // Dev-удобство не должно ронять завершение процесса.
    }
  }
}

function readPersistedRoom(path: string): Room | null {
  const file = basename(path)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    debugLog('rooms.restore.skip', { file, reason: 'нечитаемый JSON', error: errorMessage(error) })
    return null
  }

  const record = raw as Partial<PersistedRoomFile> | null
  if (!record || record.kind !== PERSIST_FILE_KIND || typeof record.roomId !== 'string' || !record.save) {
    debugLog('rooms.restore.skip', { file, reason: 'неизвестный формат файла комнаты' })
    return null
  }

  let save: GalaxySaveFile
  try {
    // Нормализация из @galaxy/rules: миграция старого `pendingCombat` и ссылок маркеров.
    save = normalizeGalaxySave(parseGalaxySave(record.save))
  } catch (error) {
    debugLog('rooms.restore.skip', { file, reason: 'некорректное сохранение', error: errorMessage(error) })
    return null
  }
  if (!save.game) {
    debugLog('rooms.restore.skip', { file, reason: 'в файле нет состояния партии' })
    return null
  }

  const violations = validateGalaxySave(save)
  if (violations.length) {
    // Незавершённый бой законно ломает часть проверок сохранения (вражеские корабли
    // на контролируемой клетке), поэтому это предупреждение, а не отказ.
    debugLog('rooms.restore.warn', {
      file,
      roomId: record.roomId,
      violations: violations.length,
      first: violations[0],
    })
  }

  const room: Room = {
    id: record.roomId,
    code: typeof record.code === 'string' && record.code ? record.code : record.roomId.slice(0, 6).toUpperCase(),
    map: save.map,
    state: save.game,
    playerIds: Array.isArray(record.playerIds)
      ? record.playerIds.filter((id): id is string => typeof id === 'string')
      : [],
    maxPlayers: typeof record.maxPlayers === 'number' && record.maxPlayers > 0
      ? record.maxPlayers
      : save.game.players.length,
    lastCombatResult: record.lastCombatResult,
    observationRevision: typeof record.observationRevision === 'number' ? record.observationRevision : 0,
  }

  debugLog('rooms.restore.room', {
    roomId: room.id,
    code: room.code,
    phase: room.state.phase,
    turnNumber: room.state.turnNumber,
    players: room.playerIds.length,
    pendingCombat: room.state.pendingCombat?.phase ?? null,
  })
  return room
}

/** Читает все комнаты из `.dev-rooms/`. Битый файл пропускается, сервер стартует. */
export function loadPersistedRooms(): Room[] {
  if (!roomPersistenceEnabled) return []

  let files: string[]
  try {
    files = readdirSync(devRoomsDir).filter((name) => name.endsWith('.json'))
  } catch {
    // Каталога ещё нет — первый запуск.
    return []
  }
  if (!files.length) return []

  const restored: Room[] = []
  for (const name of files) {
    const room = readPersistedRoom(join(devRoomsDir, name))
    if (room) restored.push(room)
  }

  debugLog('rooms.restore', { dir: devRoomsDir, files: files.length, restored: restored.length })
  return restored
}

if (roomPersistenceEnabled) {
  process.on('exit', flushRoomPersistSync)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      flushRoomPersistSync()
      process.exit(0)
    })
  }
}
