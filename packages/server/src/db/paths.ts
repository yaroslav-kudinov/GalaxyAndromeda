import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot(): string {
  return resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
}

export function galaxyDataDir(): string {
  const env = process.env.GALAXY_DATA_DIR?.trim()
  if (env) return resolve(env)
  if (process.env.NODE_ENV === 'production') return '/data'
  return join(repoRoot(), '.galaxy-data')
}

export function ensureDataDir(): string {
  const dir = galaxyDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dbFilePath(): string {
  return join(galaxyDataDir(), 'galaxy.db')
}

export function bugReportsDataDir(): string {
  const env = process.env.BUG_REPORTS_DIR?.trim()
  if (env) return resolve(env)
  return join(galaxyDataDir(), 'bug-reports')
}
