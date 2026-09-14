import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROWSER_EVALUATION_SCENARIOS } from './browser-evaluation-report.ts'

export function browserEvaluationOutputPath(arguments_: string[], repositoryRoot = process.cwd()): {
  hostPath: string
  containerPath: string
} {
  let requested = 'test-results/browser-evaluation/report.json'
  if (arguments_.length) {
    if (arguments_.length !== 2 || arguments_[0] !== '--output' || !arguments_[1]) {
      throw new TypeError('Usage: npm run evaluate:browser:docker -- [--output test-results/browser-evaluation/report.json]')
    }
    requested = arguments_[1]
  }
  const root = resolve(repositoryRoot)
  const hostPath = resolve(root, requested)
  const relativePath = relative(root, hostPath)
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes('\0')) {
    throw new TypeError('Browser evaluation output must be a file inside the repository')
  }
  return { hostPath, containerPath: `/workspace/${relativePath.replaceAll('\\', '/')}` }
}

async function main(): Promise<void> {
  const output = browserEvaluationOutputPath(process.argv.slice(2))
  await mkdir(dirname(output.hostPath), { recursive: true })
  await rm(output.hostPath, { force: true })
  const result = spawnSync(process.execPath, [
    'scripts/run-focused-docker.ts',
    'integration',
    'tests/integration/browser-evaluation-fixtures.e2e.ts'
  ], {
    env: { ...process.env, HRONAUT_BROWSER_EVALUATION_OUTPUT: output.containerPath },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  const report = JSON.parse(await readFile(output.hostPath, 'utf8')) as {
    kind?: string
    scenarios?: Array<{ scenarioId?: string }>
  }
  if (report.kind !== 'hronaut-local-browser-evaluation'
    || report.scenarios?.map(scenario => scenario.scenarioId).join('\0') !== BROWSER_EVALUATION_SCENARIOS.join('\0')) {
    throw new Error('Browser evaluation report is missing or invalid')
  }
  process.stdout.write(`Privacy-safe browser evaluation report: ${output.hostPath}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
