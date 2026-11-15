import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MAX_RECHECKED_TESTS, RECHECK_REPEATS, flakyWarning, recheckProblems, testListLine, testsToRecheck,
  type ListedTest, type PlaywrightReport
} from '../scripts/recheck-flaky-tests.ts'

type Status = 'expected' | 'unexpected' | 'flaky' | 'skipped'

/** A report of one file whose specs sit in a `shell` describe block, each with one test per status given. */
function report(specs: Record<string, Status[]>, errors: unknown[] = []): PlaywrightReport {
  return {
    errors,
    suites: [{
      title: 'browser-shell.e2e.ts',
      suites: [{
        title: 'shell',
        specs: Object.entries(specs).map(([title, statuses]) => ({
          title,
          file: 'browser-shell.e2e.ts',
          // An intended skip expects to be skipped; a test another failure kept from running expects to pass.
          tests: statuses.map((status) => ({ status, expectedStatus: status === 'skipped' ? 'skipped' as const : 'passed' as const }))
        }))
      }]
    }]
  }
}

const listed = (title: string): ListedTest => ({ file: 'browser-shell.e2e.ts', titlePath: ['shell', title] })

describe('testsToRecheck', () => {
  it('reruns the tests that failed or passed only on a retry', () => {
    expect(testsToRecheck(report({ passes: ['expected'], flaky: ['flaky'], fails: ['unexpected'], skipped: ['skipped'] })))
      .toEqual({ tests: [listed('flaky'), listed('fails')] })
  })

  it('names a test as Playwright\'s test list does, leaving out untitled describe blocks', () => {
    const nested: PlaywrightReport = {
      suites: [{
        title: 'themes.e2e.ts',
        suites: [{ title: '', suites: [{ title: 'restart', specs: [{ title: 'keeps > theme', file: 'themes.e2e.ts', tests: [{ status: 'flaky' }] }] }] }]
      }]
    }
    const selection = testsToRecheck(nested)
    expect(selection).toEqual({ tests: [{ file: 'themes.e2e.ts', titlePath: ['restart', 'keeps > theme'] }] })
    expect(testListLine((selection as { tests: ListedTest[] }).tests[0]!)).toBe('themes.e2e.ts › restart › keeps > theme')
  })

  it.each<[string, PlaywrightReport, RegExp]>([
    ['an error outside any test', report({ flaky: ['flaky'] }, [{ message: 'Timed out waiting 3600s for the test suite to run' }]), /1 error\(s\) outside any test/],
    ['no failed test', report({ passes: ['expected'] }), /no test failed/],
    ['more failures than a recheck takes', report(Object.fromEntries(Array.from({ length: MAX_RECHECKED_TESTS + 1 }, (_, index) => [`fails ${index}`, ['unexpected']]))), /4 tests failed, more than the 3/],
    ['a title with the list separator', report({ 'opens › closes': ['flaky'] }), /cannot be named in a test list/],
    ['a title with surrounding spaces', report({ ' padded': ['flaky'] }), /cannot be named in a test list/],
    ['a test the failure kept from running', {
      suites: [{ title: 'browser-shell.e2e.ts', specs: [
        { title: 'fails', file: 'browser-shell.e2e.ts', tests: [{ status: 'unexpected', expectedStatus: 'passed' }] },
        { title: 'next in the serial group', file: 'browser-shell.e2e.ts', tests: [{ status: 'skipped', expectedStatus: 'passed' }] }
      ] }]
    }, /1 test\(s\) did not run, such as "browser-shell.e2e.ts › next in the serial group"/]
  ])('keeps the shard red after %s', (_case, failed, reason) => {
    const selection = testsToRecheck(failed)
    expect(selection).toEqual({ reason: expect.stringMatching(reason) })
  })
})

describe('recheckProblems', () => {
  const tests = [listed('flaky'), listed('fails')]
  const passing = Array<Status>(RECHECK_REPEATS).fill('expected')

  it('passes when every rechecked test passed every rerun', () => {
    expect(recheckProblems(tests, report({ flaky: passing, fails: passing }))).toEqual([])
  })

  // `--test-list` that matches nothing runs no test and exits successfully.
  it.each<[string, PlaywrightReport, string]>([
    ['a rerun failed', report({ flaky: passing, fails: ['expected', 'unexpected', 'expected'] }), 'browser-shell.e2e.ts › shell › fails passed 2 of 3 reruns; it needs 3 of 3.'],
    ['a test did not run', report({ flaky: passing }), 'browser-shell.e2e.ts › shell › fails passed 0 of 0 reruns; it needs 3 of 3.'],
    ['a test ran fewer times', report({ flaky: passing, fails: ['expected'] }), 'browser-shell.e2e.ts › shell › fails passed 1 of 1 reruns; it needs 3 of 3.'],
    ['a rerun was skipped', report({ flaky: passing, fails: ['expected', 'skipped', 'expected'] }), 'browser-shell.e2e.ts › shell › fails passed 2 of 3 reruns; it needs 3 of 3.'],
    ['another selected test failed', report({ flaky: passing, fails: passing, other: ['unexpected'] }), 'browser-shell.e2e.ts › shell › other also ran in the recheck and did not pass.'],
    ['the recheck reported an error', report({ flaky: passing, fails: passing }, [{ message: 'worker crashed' }]), 'The recheck reported 1 error(s) outside any test.']
  ])('fails when %s', (_case, recheck, problem) => {
    expect(recheckProblems(tests, recheck)).toEqual([problem])
  })
})

describe('flakyWarning', () => {
  it('names the flaky tests in one escaped workflow warning', () => {
    const warning = flakyWarning([listed('100% loaded'), listed('line\nbreak')])
    expect(warning).toBe('::warning title=Flaky Electron tests::2 Electron test(s) failed and then passed 3 of 3 reruns without retries. '
      + 'The shard passes, but each flake is a bug to fix: browser-shell.e2e.ts › shell › 100%25 loaded; browser-shell.e2e.ts › shell › line%0Abreak')
    expect(warning).not.toContain('\n')
  })
})

// The recheck reads Playwright's own JSON report and writes its own test list, so both formats are checked against
// the installed Playwright rather than against fixtures alone.
describe.skipIf(process.platform === 'win32')('flaky-test recheck with Playwright', () => {
  it('reruns a flaky test from the JSON report through a test list', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-flaky-recheck-'))
    const playwright = pathToFileURL(resolve('node_modules/@playwright/test/index.mjs')).href
    const cli = resolve('node_modules/@playwright/test/cli.js')
    const script = resolve('scripts/recheck-flaky-tests.ts')
    try {
      // As in the real config, the test directory sits below the working directory, so report and list paths are
      // relative to it.
      await mkdir(join(directory, 'e2e'))
      await writeFile(join(directory, 'playwright.config.mjs'), `import { defineConfig } from '${playwright}'
export default defineConfig({
  testDir: './e2e', testMatch: '*.e2e.mjs', retries: 1, failOnFlakyTests: true,
  reporter: [['json', { outputFile: process.env.REPORT }]]
})
`)
      await writeFile(join(directory, 'e2e/sample.e2e.mjs'), `import { expect, test } from '${playwright}'
import { existsSync, writeFileSync } from 'node:fs'
test.describe('restart', () => {
  test.describe(() => {
    test('keeps > theme', () => {
      const marker = new URL('./flaked', import.meta.url)
      if (!existsSync(marker)) { writeFileSync(marker, ''); expect(1).toBe(2) }
    })
  })
  test('passes', () => {})
})
`)
      const run = (report: string, ...args: string[]) => spawnSync(process.execPath, [cli, 'test', '--config', 'playwright.config.mjs', ...args], {
        cwd: directory, encoding: 'utf8', env: { ...process.env, CI: '', REPORT: report }
      })
      const recheck = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' })

      // failOnFlakyTests fails the run that a retry saved.
      expect(run('first.json').status).toBe(1)
      const listed = recheck('list', 'first.json', 'list.txt')
      expect(listed.status).toBe(0)
      await expect(readFile(join(directory, 'list.txt'), 'utf8')).resolves.toBe('sample.e2e.mjs › restart › keeps > theme\n')

      expect(run('recheck.json', '--test-list', 'list.txt', `--repeat-each=${RECHECK_REPEATS}`, '--retries=0').status).toBe(0)
      const verified = recheck('verify', 'first.json', 'recheck.json')
      expect(verified.stdout).toContain('::warning title=Flaky Electron tests::1 Electron test(s) failed')
      expect(verified.status).toBe(0)

      // A list that names no test runs nothing and still exits 0; the verification catches it.
      await writeFile(join(directory, 'none.txt'), 'sample.e2e.mjs › restart › renamed\n')
      expect(run('empty.json', '--test-list', 'none.txt', `--repeat-each=${RECHECK_REPEATS}`, '--retries=0').status).toBe(0)
      const empty = recheck('verify', 'first.json', 'empty.json')
      expect(empty.stdout).toContain('passed 0 of 0 reruns')
      expect(empty.status).toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
