#!/usr/bin/env node
/**
 * Параллельный server + client с NUXT_HMR_TUNNEL=1 (wss/443 для tuna HTTPS).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function run(filter, script, env = {}) {
  return spawn(
    'pnpm',
    ['--filter', filter, 'run', script],
    {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: true,
    },
  )
}

const server = run('@galaxy/server', 'dev')
const client = run('@galaxy/client', 'dev:tunnel')

function shutdown(code) {
  server.kill()
  client.kill()
  process.exit(code ?? 0)
}

server.on('exit', (code) => shutdown(code ?? 1))
client.on('exit', (code) => shutdown(code ?? 1))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
