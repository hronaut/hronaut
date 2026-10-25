import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECHECK_REPEATS, type PlaywrightReport } from '../scripts/recheck-flaky-tests.ts'

interface Invocation {
  args: string[]
  isolatedDisplays?: string
  shard?: string
}

/** A Playwright JSON report of one file with one test per status given. */
function playwrightReport(tests: Record<string, Array<'expected' | 'unexpected' | 'flaky' | 'skipped'>>): string {
  const report: PlaywrightReport = {
    errors: [],
    suites: [{
      title: 'browser-shell.e2e.ts',
      specs: Object.entries(tests).map(([title, statuses]) => ({
        title,
        file: 'browser-shell.e2e.ts',
        tests: statuses.map(status => ({ status, expectedStatus: status === 'skipped' ? 'skipped' as const : 'passed' as const }))
      }))
    }]
  }
  return JSON.stringify(report)
}

async function runSuite(environment: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-suite-runner-'))
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'bin'))
    await copyFile('scripts/run-integration-suite-docker.sh', join(root, 'scripts/run-integration-suite-docker.sh'))
    await copyFile('scripts/recheck-flaky-tests.ts', join(root, 'scripts/recheck-flaky-tests.ts'))
    await copyFile('scripts/is-main-module.ts', join(root, 'scripts/is-main-module.ts'))
    await writeFile(join(root, 'scripts/verify-dependency-manifest.ts'), '')
    await writeFile(join(root, 'bin/npm'), `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const shard = process.env.HRONAUT_TEST_SHARD;
appendFileSync('calls.jsonl', JSON.stringify({ args, isolatedDisplays: process.env.HRONAUT_TEST_ISOLATED_DISPLAYS, shard }) + '\\n');
if (args.includes('test:integration:run')) {
  // Playwright's JSON reporter writes test-results/json/<shard>.json for a hosted shard (playwright.config.ts).
  const recheck = args.includes('--test-list');
  const report = recheck ? process.env.TEST_RECHECK_REPORT : process.env.TEST_SHARD_REPORT;
  if (shard && report) {
    mkdirSync('test-results/json', { recursive: true });
    writeFileSync('test-results/json/' + shard + '.json', report);
  }
  process.exit(Number((recheck ? process.env.TEST_RECHECK_STATUS : process.env.TEST_ELECTRON_STATUS) || 0));
}
`)
    await writeFile(join(root, 'bin/xvfb-run'), '#!/usr/bin/env bash\nshift 2\nexec "$@"\n')
    await chmod(join(root, 'bin/npm'), 0o755)
    await chmod(join(root, 'bin/xvfb-run'), 0o755)
    const result = spawnSync('bash', ['scripts/run-integration-suite-docker.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        HRONAUT_INTEGRATION_SHARDS: '4',
        HRONAUT_INTEGRATION_SHARD: '',
        HRONAUT_INTEGRATION_SHARD_WORKERS: '1',
        HRONAUT_INTEGRATION_RUN_DIALOGS: 'true',
        HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'false',
        ...environment
      }
    })
    if (result.error) throw result.error
    const source = await readFile(join(root, 'calls.jsonl'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    })
    const calls = source.trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as Invocation)
    return { status: result.status, calls, stdout: result.stdout }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('Docker Electron scheduling', () => {
  it('shares all tests between four isolated workers after one full build', async () => {
    const { status, calls } = await runSuite()
    expect(status).toBe(0)
    expect(calls.map(call => call.args)).toEqual([
      ['run', 'build'],
      ['run', 'test:integration:run', '--', '--workers=4'],
      ['run', 'test:integration:dialogs:headless']
    ])
    expect(calls[1]?.isolatedDisplays).toBe('1')
  })

  it('preserves hosted single-shard selection and optional dialogs', async () => {
    const { status, calls } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '2/5',
      HRONAUT_INTEGRATION_RUN_DIALOGS: 'false',
      HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'true'
    })
    expect(status).toBe(0)
    expect(calls.map(call => call.args)).toEqual([
      ['run', 'build:app'],
      ['run', 'test:integration:run', '--', '--shard=2/5', '--workers=1']
    ])
  })

  it('shares a hosted shard between two independently displayed workers', async () => {
    const { status, calls } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '5/5',
      HRONAUT_INTEGRATION_SHARD_WORKERS: '2'
    })
    expect(status).toBe(0)
    expect(calls[1]).toMatchObject({
      args: ['run', 'test:integration:run', '--', '--shard=5/5', '--workers=2'],
      isolatedDisplays: '1'
    })
    expect(calls[2]?.args).toEqual(['run', 'test:integration:dialogs:headless'])
  })

  it.each(['0', '2x', '1.5', '9'])('rejects invalid hosted worker count %s before building', async workers => {
    const { status, calls } = await runSuite({ HRONAUT_INTEGRATION_SHARD_WORKERS: workers })
    expect(status).toBe(2)
    expect(calls).toEqual([])
  })

  it('fails the gate and skips dialogs when the worker pool fails', async () => {
    const { status, calls } = await runSuite({ TEST_ELECTRON_STATUS: '1' })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes('test:integration:dialogs:headless'))).toBe(false)
    // Only a hosted shard rechecks its failures; the local queue reports every failure as it is.
    expect(calls.some(call => call.args.includes('--test-list'))).toBe(false)
  })

  // One flaky test failed a whole hosted shard, and the shard was re-run for 16-20 minutes.
  it('passes a hosted shard whose few failed tests pass every rerun, and warns about them', async () => {
    const { status, calls, stdout } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '2/5',
      TEST_ELECTRON_STATUS: '1',
      TEST_SHARD_REPORT: playwrightReport({ passes: ['expected'], 'keeps the theme': ['flaky'], 'opens a tab': ['unexpected'] }),
      TEST_RECHECK_REPORT: playwrightReport({ 'keeps the theme': ['expected', 'expected', 'expected'], 'opens a tab': ['expected', 'expected', 'expected'] })
    })
    expect(status).toBe(0)
    expect(calls.slice(1)).toEqual([
      { args: ['run', 'test:integration:run', '--', '--shard=2/5', '--workers=1'], isolatedDisplays: '1', shard: 'shard-2' },
      {
        args: ['run', 'test:integration:run', '--', '--test-list', 'test-results/json/shard-2-recheck.txt', `--repeat-each=${RECHECK_REPEATS}`, '--retries=0', '--workers=1'],
        isolatedDisplays: '1',
        shard: 'shard-2-recheck'
      },
      { args: ['run', 'test:integration:dialogs:headless'] }
    ])
    expect(stdout).toContain('::warning title=Flaky Electron tests::2 Electron test(s) failed and then passed 3 of 3 reruns without retries.')
    expect(stdout).toContain('browser-shell.e2e.ts › keeps the theme; browser-shell.e2e.ts › opens a tab')
  })

  it.each<[string, Record<string, string>]>([
    ['a rerun fails', { TEST_RECHECK_REPORT: playwrightReport({ 'keeps the theme': ['expected', 'unexpected', 'expected'] }) }],
    ['the recheck exits with a failure', { TEST_RECHECK_REPORT: playwrightReport({ 'keeps the theme': ['expected', 'expected', 'expected'] }), TEST_RECHECK_STATUS: '1' }],
    ['the recheck runs no test', { TEST_RECHECK_REPORT: playwrightReport({}) }],
    ['the recheck leaves no report', {}]
  ])('keeps a hosted shard red and skips dialogs when %s', async (_case, recheck) => {
    const { status, calls, stdout } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '1/5',
      TEST_ELECTRON_STATUS: '1',
      TEST_SHARD_REPORT: playwrightReport({ 'keeps the theme': ['flaky'] }),
      ...recheck
    })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes('--test-list'))).toBe(true)
    expect(calls.some(call => call.args.includes('test:integration:dialogs:headless'))).toBe(false)
    expect(stdout).not.toContain('::warning')
  })

  it.each<[string, Record<string, string>]>([
    ['more tests failed than a recheck takes', { TEST_SHARD_REPORT: playwrightReport({ a: ['unexpected'], b: ['unexpected'], c: ['flaky'], d: ['unexpected'] }) }],
    ['the shard left no report', {}]
  ])('does not recheck a hosted shard when %s', async (_case, shard) => {
    const { status, calls, stdout } = await runSuite({ HRONAUT_INTEGRATION_SHARD: '3/5', TEST_ELECTRON_STATUS: '1', ...shard })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes('--test-list'))).toBe(false)
    expect(stdout).toContain('Not rechecking:')
  })
})
