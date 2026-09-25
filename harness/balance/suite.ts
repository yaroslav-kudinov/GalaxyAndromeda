#!/usr/bin/env tsx
/**
 * Набор замеров уровней ботов: каждая пара «карта × раскладка» — отдельный процесс `run.ts`,
 * процессы идут параллельно. В конце печатается сводная таблица (`results.ts`).
 *
 *   pnpm balance:suite --label before --map @4+ --games 150 --seed 41
 *   pnpm balance:suite --label hard-tune --configs "solo:hard" --botTune hard.denyShare=0.5
 *   pnpm balance:compare harness/balance/out/before harness/balance/out/hard-tune
 *
 * Флаги:
 *
 * - `--label` — имя прогона: каталог `<out>/<label>` (обязателен);
 * - `--map` — карты и выборки каталога (`@4+` — все опубликованные на 4–6 игроков, по умолчанию);
 * - `--configs` — раскладки через пробел или «;»: `solo:hard` (одно место сложного среди
 *   средних), `among:hard` (одно место среднего среди сложных — «человек» за столом сложных
 *   ботов), `all:medium` (все места одного уровня),
 *   `h2h:hard,medium` (лоб в лоб), `mix:player-1=hard` (места поимённо). По умолчанию —
 *   `solo:easy solo:hard all:medium h2h:hard,medium`;
 * - `--games`, `--seed` — партий на пару и сид (сид партии домешивается из карты, поэтому
 *   прогон воспроизводим);
 * - `--botTune` — подбор профиля уровня без правки кода, как у `run.ts`;
 * - `--jobs` — сколько процессов сразу (по умолчанию ядер минус один);
 * - `--out` — корень каталогов прогонов (по умолчанию `harness/balance/out`, он в `.gitignore`);
 * - `--sections` — разделы итоговой таблицы (`wins,behavior,near,economy`).
 *
 * Прочие флаги (`--maxTurns`, `--turnLimit`, `--noDoctrines`, …) передаются в `run.ts` как есть.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'

import { HARNESS_DIR, REPO_ROOT, resolveMapNames } from './maps.js'
import { loadResults, parseFlags, parseSections, renderTables } from './results.js'

const DEFAULT_CONFIGS = 'solo:easy solo:hard all:medium h2h:hard,medium'
const OWN_FLAGS = new Set(['label', 'map', 'configs', 'games', 'seed', 'botTune', 'jobs', 'out', 'sections'])

interface Job {
  name: string
  args: string[]
}

/** `solo:hard` → флаги `run.ts` и короткое имя раскладки. */
function configFlags(config: string): { flags: string[]; name: string } {
  const [kind, value] = config.split(':')
  if (!kind || !value) throw new Error(`Не понял раскладку «${config}»: нужно вид:значение`)
  switch (kind) {
    case 'solo':
      return { flags: ['--solo', value], name: `solo-${value}` }
    case 'among':
      return { flags: ['--solo', 'medium', '--difficulty', value], name: `among-${value}` }
    case 'all':
      return { flags: ['--difficulty', value], name: `all-${value}` }
    case 'h2h':
      return { flags: ['--h2h', value], name: `h2h-${value.split(',').join('-')}` }
    case 'mix':
      return { flags: ['--mix', value, '--rotate', '--difficulty', 'medium'], name: `mix-${value.replace(/[=,]/g, '-')}` }
    default:
      throw new Error(`Неизвестный вид раскладки «${kind}»: есть solo, among, all, h2h, mix`)
  }
}

function runJob(job: Job, logDir: string): Promise<number> {
  return new Promise((done) => {
    // Тот же node с теми же флагами загрузчика tsx, что у этого процесса: работает на любой ОС.
    const child = spawn(process.execPath, [...process.execArgv, resolve(HARNESS_DIR, 'run.ts'), ...job.args], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (code) => {
      if (code !== 0) writeFileSync(resolve(logDir, `${job.name}.error.log`), stderr, 'utf8')
      done(code ?? 1)
    })
  })
}

async function main(): Promise<void> {
  const { flags } = parseFlags(process.argv.slice(2))
  const label = flags.get('label')
  if (!label) throw new Error('Нужна метка прогона: --label <имя>')
  const maps = resolveMapNames(flags.get('map') || '@4+')
  const configs = (flags.get('configs') || DEFAULT_CONFIGS).split(/[\s;]+/).filter(Boolean)
  const games = flags.get('games') || '100'
  const seed = flags.get('seed') || '41'
  const jobsLimit = Math.max(1, Number(flags.get('jobs')) || availableParallelism() - 1)
  const outRoot = flags.get('out') || 'harness/balance/out'
  const outDir = resolve(REPO_ROOT, outRoot, label)
  mkdirSync(outDir, { recursive: true })

  const passThrough: string[] = []
  for (const [key, value] of flags) {
    if (OWN_FLAGS.has(key)) continue
    passThrough.push(`--${key}`)
    if (value !== '') passThrough.push(value)
  }
  const tune = flags.get('botTune')

  const jobs: Job[] = []
  for (const map of maps) {
    for (const config of configs) {
      const { flags: seating, name: configName } = configFlags(config)
      const name = `${map}-${configName}`
      jobs.push({
        name,
        args: [
          '--map', map, '--games', games, '--seed', seed, ...seating,
          ...(tune ? ['--botTune', tune] : []),
          ...passThrough,
          '--out', resolve(outDir), '--label', name,
        ],
      })
    }
  }

  const started = Date.now()
  process.stderr.write(`Прогон «${label}»: ${jobs.length} замеров по ${games} партий, до ${jobsLimit} сразу → ${outDir}\n`)
  const queue = [...jobs]
  const failed: string[] = []
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const code = await runJob(job, outDir)
      if (code !== 0) failed.push(job.name)
      process.stderr.write(`  ${code === 0 ? 'готово' : 'СБОЙ'}: ${job.name} (${Math.round((Date.now() - started) / 1000)} с)\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobsLimit, jobs.length) }, worker))

  writeFileSync(
    resolve(outDir, 'suite.json'),
    `${JSON.stringify({ label, maps, configs, games: Number(games), seed: Number(seed), botTune: tune ?? null, passThrough }, null, 2)}\n`,
    'utf8',
  )
  const entries = [...loadResults(outDir).values()].filter((entry) => jobs.some((job) => entry.name === job.name))
  process.stdout.write(`${renderTables(entries, parseSections(flags.get('sections')))}\n`)
  if (failed.length) {
    process.stderr.write(`Сбои (журналы в ${outDir}): ${failed.join(', ')}\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
