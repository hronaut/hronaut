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

/** A `playwright test --list --reporter=json` report of one file's tests. */
function listReport(titles: string[]): string {
  return JSON.stringify({ errors: [], suites: [{ title: 'browser-shell.e2e.ts', specs: titles.map(title => ({ title, file: 'browser-shell.e2e.ts' })) }] })
}

const listing = ['run', 'test:integration:run', '--', '--list', '--reporter=json']

async function runSuite(environment: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-suite-runner-'))
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'bin'))
    await copyFile('scripts/run-integration-suite-docker.sh', join(root, 'scripts/run-integration-suite-docker.sh'))
    await copyFile('scripts/recheck-flaky-tests.ts', join(root, 'scripts/recheck-flaky-tests.ts'))
    await copyFile('scripts/is-main-module.ts', join(root, 'scripts/is-main-module.ts'))
    await copyFile('scripts/plan-integration-shard.ts', join(root, 'scripts/plan-integration-shard.ts'))
    await copyFile('scripts/update-integration-durations.ts', join(root, 'scripts/update-integration-durations.ts'))
    if (environment.TEST_DURATIONS) {
      await mkdir(join(root, 'tests/integration'), { recursive: true })
      await writeFile(join(root, 'tests/integration/durations.json'), environment.TEST_DURATIONS)
    }
    await writeFile(join(root, 'scripts/verify-dependency-manifest.ts'), '')
    await writeFile(join(root, 'bin/npm'), `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const shard = process.env.HRONAUT_TEST_SHARD;
appendFileSync('calls.jsonl', JSON.stringify({ args, isolatedDisplays: process.env.HRONAUT_TEST_ISOLATED_DISPLAYS, shard }) + '\\n');
if (args.includes('--list')) {
  // A hosted shard lists the suite to split it by recorded durations. Unless a case lists its own tests, their titles
  // cannot be named in a test list, so the shard keeps Playwright's split.
  const unnamed = JSON.stringify({ errors: [], suites: [{ title: 'browser-shell.e2e.ts', specs: [{ title: 'opens › closes', file: 'browser-shell.e2e.ts' }] }] });
  if (process.env.TEST_LIST_REPORT !== 'none') writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, process.env.TEST_LIST_REPORT || unnamed);
  process.exit(Number(process.env.TEST_LIST_STATUS || 0));
}
if (args.includes('test:integration:run')) {
  // Playwright's JSON reporter writes test-results/json/<shard>.json for a hosted shard (playwright.config.ts).
  const recheck = args.includes('--repeat-each=${RECHECK_REPEATS}');
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
    const shard = environment.HRONAUT_INTEGRATION_SHARD?.split('/')[0]
    const optional = (path: string) => readFile(join(root, path), 'utf8').catch(() => undefined)
    return {
      status: result.status,
      calls,
      stdout: result.stdout,
      plan: await optional(`test-results/json/shard-${shard}-plan.txt`),
      durations: await optional(`test-results/durations/shard-${shard}.json`)
    }
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
    // Without a listed suite the shard keeps Playwright's split by test count.
    expect(calls.map(call => call.args)).toEqual([
      ['run', 'build:app'],
      listing,
      ['run', 'test:integration:run', '--', '--shard=2/5', '--workers=1']
    ])
  })

  it('shares a hosted shard between two independently displayed workers', async () => {
    const { status, calls } = await runSuite({
      HRONAUT_INTEGRATION_SHARD: '5/5',
      HRONAUT_INTEGRATION_SHARD_WORKERS: '2'
    })
    expect(status).toBe(0)
    expect(calls[2]).toMatchObject({
      args: ['run', 'test:integration:run', '--', '--shard=5/5', '--workers=2'],
      isolatedDisplays: '1'
    })
    expect(calls[3]?.args).toEqual(['run', 'test:integration:dialogs:headless'])
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
    expect(calls.slice(2)).toEqual([
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
    expect(calls.some(call => call.args.includes(`--repeat-each=${RECHECK_REPEATS}`))).toBe(true)
    expect(calls.some(call => call.args.includes('test:integration:dialogs:headless'))).toBe(false)
    expect(stdout).not.toContain('::warning title=Flaky Electron tests')
  })

  it.each<[string, Record<string, string>]>([
    ['more tests failed than a recheck takes', { TEST_SHARD_REPORT: playwrightReport({ a: ['unexpected'], b: ['unexpected'], c: ['flaky'], d: ['unexpected'] }) }],
    ['the shard left no report', {}]
  ])('does not recheck a hosted shard when %s', async (_case, shard) => {
    const { status, calls, stdout } = await runSuite({ HRONAUT_INTEGRATION_SHARD: '3/5', TEST_ELECTRON_STATUS: '1', ...shard })
    expect(status).toBe(1)
    expect(calls.some(call => call.args.includes(`--repeat-each=${RECHECK_REPEATS}`))).toBe(false)
    expect(stdout).toContain('Not rechecking:')
  })

  // Playwright's --shard gives each shard the same number of tests, and their run times differed by up to six minutes.
  it('splits hosted shards by recorded test durations', async () => {
    const environment = {
      TEST_LIST_REPORT: listReport(['opens a tab', 'keeps the theme', 'restores a window', 'closes a tab']),
      TEST_DURATIONS: JSON.stringify({ 'browser-shell.e2e.ts › opens a tab': 30, 'browser-shell.e2e.ts › keeps the theme': 10, 'browser-shell.e2e.ts › restores a window': 12 })
    }
    const first = await runSuite({ ...environment, HRONAUT_INTEGRATION_SHARD: '1/2' })
    const second = await runSuite({ ...environment, HRONAUT_INTEGRATION_SHARD: '2/2' })
    expect(first.status).toBe(0)
    expect(first.calls[1]?.args).toEqual(listing)
    expect(first.calls[2]).toMatchObject({ args: ['run', 'test:integration:run', '--', '--test-list', 'test-results/json/shard-1-plan.txt', '--workers=1'], shard: 'shard-1' })
    expect(second.calls[2]).toMatchObject({ args: ['run', 'test:integration:run', '--', '--test-list', 'test-results/json/shard-2-plan.txt', '--workers=1'], shard: 'shard-2' })
    // Longest first, each to the shard with less time so far; the unrecorded test counts as the median (12 s).
    expect(first.plan).toBe('browser-shell.e2e.ts › opens a tab\n')
    expect(second.plan).toBe('browser-shell.e2e.ts › closes a tab\nbrowser-shell.e2e.ts › restores a window\nbrowser-shell.e2e.ts › keeps the theme\n')
    expect(first.stdout).toContain('Shard 1/2 runs 1 of 4 tests, about 1 min by recorded durations; 1 of the 4 have none and count as the median one.')
  })

  it.each<[string, Record<string, string>]>([
    ['a title cannot be named in a test list', { TEST_LIST_REPORT: listReport(['opens › closes']) }],
    ['a title has a line break', { TEST_LIST_REPORT: listReport(['opens\nand closes']) }],
    ['one title selects another test', { TEST_LIST_REPORT: JSON.stringify({ suites: [{ title: 'browser-shell.e2e.ts', specs: [{ title: 'tabs', file: 'browser-shell.e2e.ts' }], suites: [{ title: 'tabs', specs: [{ title: 'close', file: 'browser-shell.e2e.ts' }] }] }] }) }]
  ])('keeps Playwright\'s split, as every shard does, when %s', async (_case, listed) => {
    const { status, calls, stdout } = await runSuite({ ...listed, HRONAUT_INTEGRATION_SHARD: '1/2' })
    expect(status).toBe(0)
    expect(calls[2]?.args).toEqual(['run', 'test:integration:run', '--', '--shard=1/2', '--workers=1'])
    expect(stdout).toContain('::warning title=Electron shard plan::Splitting shards by test count:')
  })

  // A shard that split the tests by itself while the others split them by durations would skip or repeat tests.
  it.each<[string, Record<string, string>, string]>([
    ['listing fails', { TEST_LIST_REPORT: listReport(['opens a tab']), TEST_LIST_STATUS: '1' }, 'listing exited with 1'],
    ['listing leaves no report', { TEST_LIST_REPORT: 'none' }, 'planning with 1'],
    ['listing reports an error', { TEST_LIST_REPORT: JSON.stringify({ errors: [{ message: 'SyntaxError: Unexpected token\n  at tabs.e2e.ts:3' }], suites: [] }) },
      'cannot take its part of the split: listing the tests reported 1 error(s): SyntaxError: Unexpected token.'],
    ['nothing is listed', { TEST_LIST_REPORT: listReport([]) }, 'no test was listed']
  ])('fails a hosted shard without running a test when %s', async (_case, listed, reason) => {
    const { status, calls, stdout } = await runSuite({ ...listed, HRONAUT_INTEGRATION_SHARD: '1/2' })
    expect(status).toBe(1)
    expect(calls.map(call => call.args)).toEqual([['run', 'build'], listing])
    expect(stdout).toContain('::error title=Electron shard plan::')
    expect(stdout).toContain(reason)
  })

  it('records how long each test of a hosted shard took, without its output', async () => {
    const report = {
      errors: [],
      suites: [{
        title: 'browser-shell.e2e.ts',
        specs: [{
          title: 'opens a tab',
          file: 'browser-shell.e2e.ts',
          tests: [{ status: 'flaky', expectedStatus: 'passed', results: [{ status: 'failed', duration: 45_000, stdout: ['secret'] }, { status: 'passed', duration: 2_340 }] }]
        }]
      }]
    }
    const { durations } = await runSuite({ HRONAUT_INTEGRATION_SHARD: '4/5', TEST_SHARD_REPORT: JSON.stringify(report) })
    expect(durations).toBe('{\n  "browser-shell.e2e.ts › opens a tab": 2.3\n}\n')
  })
})
