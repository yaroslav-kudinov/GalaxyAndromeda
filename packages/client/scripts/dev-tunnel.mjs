#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.NUXT_HMR_TUNNEL = '1'

const cwd = join(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn('nuxi', ['dev', '--port', '3000'], {
  cwd,
  env: process.env,
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
