import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MapDefinition } from '@galaxy/rules'
import { normalizeMapDefinition, resolveMapPlayerCount } from '@galaxy/rules'
import { MIGRATION_SQL, SCHEMA_VERSION } from './schema.js'
import { dbFilePath, ensureDataDir } from './paths.js'

let db: DatabaseSync | null = null

function repoRoot(): string {
  return resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
}

export function getDb(): DatabaseSync {
  if (db) return db
  ensureDataDir()
  db = new DatabaseSync(dbFilePath())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(MIGRATION_SQL)
  db.prepare(
    `INSERT INTO schema_meta(key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION))
  seedBundledMaps()
  seedBundledScenariosIfEmpty()
  return db
}

export function isDbHealthy(): boolean {
  try {
    const row = getDb().prepare(`SELECT 1 AS ok`).get() as { ok: number } | undefined
    return row?.ok === 1
  } catch {
    return false
  }
}

export function backupDbIfStale(): void {
  const path = dbFilePath()
  if (!existsSync(path)) return
  const backupPath = `${path}.bak`
  const stat = existsSync(backupPath)
  try {
    copyFileSync(path, backupPath)
    if (!stat) {
      console.log(`@galaxy/server db backup: ${backupPath}`)
    }
  } catch (err) {
    console.error('@galaxy/server db backup failed', err)
  }
}

export interface CatalogMapRow {
  id: string
  name: string
  player_count: number
  json: string
  source: string
  published: number
  sort_order: number
}

export function listPublishedMaps(): CatalogMapRow[] {
  return getDb()
    .prepare(
      `SELECT id, name, player_count, json, source, published, sort_order
       FROM maps WHERE published = 1 ORDER BY sort_order ASC, name ASC`,
    )
    .all() as unknown as CatalogMapRow[]
}

export function listAllMaps(): CatalogMapRow[] {
  return getDb()
    .prepare(
      `SELECT id, name, player_count, json, source, published, sort_order
       FROM maps ORDER BY sort_order ASC, name ASC`,
    )
    .all() as unknown as CatalogMapRow[]
}

export function getMapById(id: string): CatalogMapRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, name, player_count, json, source, published, sort_order FROM maps WHERE id = ?`,
    )
    .get(id) as CatalogMapRow | undefined
}

export function getPublishedMapDefinition(id: string): MapDefinition | null {
  const row = getMapById(id)
  if (!row || !row.published) return null
  return JSON.parse(row.json) as MapDefinition
}

export function upsertMap(
  map: MapDefinition,
  opts: { source: string; published?: boolean; sortOrder?: number },
): void {
  const normalized = normalizeMapDefinition(map)
  const playerCount = resolveMapPlayerCount(normalized)
  getDb()
    .prepare(
      `INSERT INTO maps(id, name, player_count, json, source, published, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         player_count = excluded.player_count,
         json = excluded.json,
         source = excluded.source,
         published = excluded.published,
         sort_order = excluded.sort_order,
         updated_at = datetime('now')`,
    )
    .run(
      normalized.id,
      normalized.name,
      playerCount,
      JSON.stringify(normalized),
      opts.source,
      opts.published === false ? 0 : 1,
      opts.sortOrder ?? 0,
    )
}

export function setMapPublished(id: string, published: boolean): boolean {
  const result = getDb()
    .prepare(`UPDATE maps SET published = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(published ? 1 : 0, id)
  return result.changes > 0
}

export function deleteMap(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM maps WHERE id = ?`).run(id)
  return result.changes > 0
}

function seedBundledMaps(): void {
  const manifestPath = join(repoRoot(), 'maps/bundled/manifest.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    maps: { id: string; sortOrder: number }[]
  }
  let added = 0
  for (const entry of manifest.maps) {
    if (getMapById(entry.id)) continue
    const mapPath = join(repoRoot(), 'maps/bundled', `${entry.id}.json`)
    if (!existsSync(mapPath)) continue
    const map = normalizeMapDefinition(JSON.parse(readFileSync(mapPath, 'utf8')) as MapDefinition)
    upsertMap(map, { source: 'bundled', published: true, sortOrder: entry.sortOrder })
    added += 1
  }
  if (added) {
    console.log(`@galaxy/server db: seeded ${added} bundled map(s)`)
  }
}

export interface ScenarioRow {
  id: string
  name: string
  description: string
  script_json: string
  map_id: string
  published: number
  sort_order: number
}

export function listPublishedScenarios(): ScenarioRow[] {
  return getDb()
    .prepare(
      `SELECT id, name, description, script_json, map_id, published, sort_order
       FROM scenarios WHERE published = 1 ORDER BY sort_order ASC`,
    )
    .all() as unknown as ScenarioRow[]
}

export function getScenarioById(id: string): ScenarioRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, name, description, script_json, map_id, published, sort_order FROM scenarios WHERE id = ?`,
    )
    .get(id) as ScenarioRow | undefined
}

export function upsertScenario(row: {
  id: string
  name: string
  description: string
  scriptJson: string
  mapId: string
  published?: boolean
  sortOrder?: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO scenarios(id, name, description, script_json, map_id, published, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         script_json = excluded.script_json,
         map_id = excluded.map_id,
         published = excluded.published,
         sort_order = excluded.sort_order,
         updated_at = datetime('now')`,
    )
    .run(
      row.id,
      row.name,
      row.description,
      row.scriptJson,
      row.mapId,
      row.published === false ? 0 : 1,
      row.sortOrder ?? 0,
    )
}

function seedBundledScenariosIfEmpty(): void {
  const count = (getDb().prepare(`SELECT COUNT(*) AS c FROM scenarios`).get() as { c: number }).c
  if (count > 0) return
  const scenarioPath = join(repoRoot(), 'scenarios/tutorial-basics.json')
  if (!existsSync(scenarioPath)) return
  const script = readFileSync(scenarioPath, 'utf8')
  const parsed = JSON.parse(script) as { id: string; name: string; mapId: string }
  upsertScenario({
    id: parsed.id,
    name: parsed.name,
    description: 'Обучающий сценарий для новых игроков',
    scriptJson: script,
    mapId: parsed.mapId,
    published: true,
    sortOrder: 1,
  })
  console.log('@galaxy/server db: seeded tutorial-basics scenario')
}

export interface MapSubmissionRow {
  id: number
  submitter_nickname: string
  submitter_ip: string | null
  map_json: string
  status: string
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
}

export function insertMapSubmission(
  nickname: string,
  ip: string | null,
  mapJson: string,
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO map_submissions(submitter_nickname, submitter_ip, map_json, status)
       VALUES (?, ?, ?, 'pending')`,
    )
    .run(nickname, ip, mapJson)
  return Number(result.lastInsertRowid)
}

export function listMapSubmissions(status?: string): MapSubmissionRow[] {
  if (status) {
    return getDb()
      .prepare(
        `SELECT * FROM map_submissions WHERE status = ? ORDER BY created_at DESC`,
      )
      .all(status) as unknown as MapSubmissionRow[]
  }
  return getDb()
    .prepare(`SELECT * FROM map_submissions ORDER BY created_at DESC`)
    .all() as unknown as MapSubmissionRow[]
}

export function getMapSubmission(id: number): MapSubmissionRow | undefined {
  return getDb().prepare(`SELECT * FROM map_submissions WHERE id = ?`).get(id) as
    | MapSubmissionRow
    | undefined
}

export function approveMapSubmission(id: number, adminNote?: string): boolean {
  const row = getMapSubmission(id)
  if (!row || row.status !== 'pending') return false
  const map = normalizeMapDefinition(JSON.parse(row.map_json) as MapDefinition)
  upsertMap(map, { source: 'community', published: true, sortOrder: 100 })
  getDb()
    .prepare(
      `UPDATE map_submissions SET status = 'approved', admin_note = ?, reviewed_at = datetime('now') WHERE id = ?`,
    )
    .run(adminNote ?? null, id)
  return true
}

export function rejectMapSubmission(id: number, adminNote: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE map_submissions SET status = 'rejected', admin_note = ?, reviewed_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .run(adminNote, id)
  return result.changes > 0
}

export function countSubmissionsToday(ip: string): number {
  const day = new Date().toISOString().slice(0, 10)
  const row = getDb()
    .prepare(`SELECT count FROM submit_rate_limits WHERE ip = ? AND day = ?`)
    .get(ip, day) as { count: number } | undefined
  return row?.count ?? 0
}

export function incrementSubmissionCount(ip: string): void {
  const day = new Date().toISOString().slice(0, 10)
  getDb()
    .prepare(
      `INSERT INTO submit_rate_limits(ip, day, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, day) DO UPDATE SET count = count + 1`,
    )
    .run(ip, day)
}

export function insertGameLog(entry: {
  roomId: string
  mapId?: string
  scenarioId?: string
  startedAt?: string
  playersJson: string
  eventLogJson: string
  outcome: string
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO game_logs(room_id, map_id, scenario_id, started_at, players_json, event_log_json, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.roomId,
      entry.mapId ?? null,
      entry.scenarioId ?? null,
      entry.startedAt ?? null,
      entry.playersJson,
      entry.eventLogJson,
      entry.outcome,
    )
  return Number(result.lastInsertRowid)
}

export function listGameLogs(limit = 50, offset = 0): Array<{
  id: number
  room_id: string
  map_id: string | null
  scenario_id: string | null
  started_at: string | null
  ended_at: string
  outcome: string
}> {
  return getDb()
    .prepare(
      `SELECT id, room_id, map_id, scenario_id, started_at, ended_at, outcome
       FROM game_logs ORDER BY ended_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<{
    id: number
    room_id: string
    map_id: string | null
    scenario_id: string | null
    started_at: string | null
    ended_at: string
    outcome: string
  }>
}

export function getGameLog(id: number): {
  id: number
  room_id: string
  map_id: string | null
  scenario_id: string | null
  started_at: string | null
  ended_at: string
  players_json: string
  event_log_json: string
  outcome: string
} | undefined {
  return getDb().prepare(`SELECT * FROM game_logs WHERE id = ?`).get(id) as
    | {
        id: number
        room_id: string
        map_id: string | null
        scenario_id: string | null
        started_at: string | null
        ended_at: string
        players_json: string
        event_log_json: string
        outcome: string
      }
    | undefined
}
