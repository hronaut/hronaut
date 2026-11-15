import { readFile, writeFile } from 'node:fs/promises'
import { isMainModule } from './is-main-module.ts'

/** A failed shard reruns at most this many tests; more failures than this are not flakes. */
export const MAX_RECHECKED_TESTS = 3
/** Each rechecked test runs this many times without retries, and every run must pass. */
export const RECHECK_REPEATS = 3

interface ReportTest {
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped'
  expectedStatus?: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
}

interface ReportSpec {
  title: string
  file: string
  tests: ReportTest[]
}

interface ReportSuite {
  title: string
  specs?: ReportSpec[]
  suites?: ReportSuite[]
}

/** The parts of Playwright's JSON report the recheck reads. */
export interface PlaywrightReport {
  suites?: ReportSuite[]
  errors?: unknown[]
}

export interface ListedTest {
  file: string
  titlePath: string[]
}

interface ReportedSpec extends ListedTest {
  tests: ReportTest[]
}

/**
 * Every spec in a report with its describe titles. The top-level suites are files; nested suites are describe blocks,
 * and an untitled one adds no title, as in Playwright's own title paths.
 */
function reportedSpecs(report: PlaywrightReport): ReportedSpec[] {
  const found: ReportedSpec[] = []
  const walk = (suite: ReportSuite, describes: string[]) => {
    for (const spec of suite.specs ?? []) found.push({ file: spec.file, titlePath: [...describes, spec.title], tests: spec.tests })
    for (const child of suite.suites ?? []) walk(child, child.title ? [...describes, child.title] : describes)
  }
  for (const fileSuite of report.suites ?? []) walk(fileSuite, [])
  return found
}

/** A test as Playwright's `--test-list` names it: its file, describe titles and title. */
export function testListLine(test: ListedTest): string {
  return [test.file, ...test.titlePath].join(' › ')
}

const sameTest = (left: ListedTest, right: ListedTest) =>
  left.file === right.file && left.titlePath.length === right.titlePath.length
  && left.titlePath.every((title, index) => title === right.titlePath[index])

/**
 * The tests a failed shard reruns: those that failed, or passed only on a retry, when there are few of them and the run
 * had no error outside a test. Anything else is a real failure and keeps the shard red.
 */
export function testsToRecheck(report: PlaywrightReport): { tests: ListedTest[] } | { reason: string } {
  if (report.errors?.length) return { reason: `the run reported ${report.errors.length} error(s) outside any test` }
  // A failure can keep other tests from running: the rest of a serial group, or a file after its beforeAll failed. A
  // recheck of the failed test alone would never run them.
  const notRun = reportedSpecs(report).filter(({ tests }) => tests.some(({ status, expectedStatus }) => status === 'skipped' && expectedStatus !== 'skipped'))
  if (notRun.length) return { reason: `${notRun.length} test(s) did not run, such as "${testListLine(notRun[0]!)}"` }
  const failed = reportedSpecs(report)
    .filter(({ tests }) => tests.some(({ status }) => status === 'unexpected' || status === 'flaky'))
    .map(({ file, titlePath }) => ({ file, titlePath }))
  if (failed.length === 0) return { reason: 'no test failed, so the run failed for another reason' }
  if (failed.length > MAX_RECHECKED_TESTS) return { reason: `${failed.length} tests failed, more than the ${MAX_RECHECKED_TESTS} a recheck takes` }
  // `--test-list` splits on › and trims each title, so such a title would select other tests or none.
  const unnamed = failed.find((test) => [test.file, ...test.titlePath].some((part) => part === '' || part.includes('›') || part !== part.trim()))
  if (unnamed) return { reason: `"${testListLine(unnamed)}" cannot be named in a test list` }
  return { tests: failed }
}

/** What went wrong in a recheck of `tests`; empty when each one passed every one of its runs. */
export function recheckProblems(tests: ListedTest[], recheck: PlaywrightReport): string[] {
  const problems: string[] = []
  if (recheck.errors?.length) problems.push(`The recheck reported ${recheck.errors.length} error(s) outside any test.`)
  const ran = reportedSpecs(recheck)
  for (const test of tests) {
    const runs = ran.filter((spec) => sameTest(spec, test)).flatMap((spec) => spec.tests)
    const passed = runs.filter(({ status }) => status === 'expected').length
    if (runs.length !== RECHECK_REPEATS || passed !== RECHECK_REPEATS) {
      problems.push(`${testListLine(test)} passed ${passed} of ${runs.length} reruns; it needs ${RECHECK_REPEATS} of ${RECHECK_REPEATS}.`)
    }
  }
  for (const spec of ran) {
    if (!tests.some((test) => sameTest(spec, test)) && spec.tests.some(({ status }) => status !== 'expected')) {
      problems.push(`${testListLine(spec)} also ran in the recheck and did not pass.`)
    }
  }
  return problems
}

/** A GitHub Actions warning that names the flaky tests, escaped as workflow commands require. */
export function flakyWarning(tests: ListedTest[]): string {
  const message = `${tests.length} Electron test(s) failed and then passed ${RECHECK_REPEATS} of ${RECHECK_REPEATS} reruns without retries. `
    + `The shard passes, but each flake is a bug to fix: ${tests.map(testListLine).join('; ')}`
  return `::warning title=Flaky Electron tests::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`
}

async function readReport(path: string): Promise<PlaywrightReport | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PlaywrightReport
  } catch (error) {
    console.log(`Could not read the Playwright report ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

if (isMainModule(import.meta.url)) {
  const [command, reportPath, secondPath] = process.argv.slice(2)
  if ((command !== 'list' && command !== 'verify') || !reportPath || !secondPath) {
    throw new Error('Usage: node scripts/recheck-flaky-tests.ts list <report.json> <test-list.txt> | verify <report.json> <recheck-report.json>')
  }
  process.exitCode = 1
  const report = await readReport(reportPath)
  const selection = report && testsToRecheck(report)
  if (!selection) {
    console.log('Not rechecking: the shard left no Playwright report.')
  } else if ('reason' in selection) {
    console.log(`Not rechecking: ${selection.reason}.`)
  } else if (command === 'list') {
    await writeFile(secondPath, `${selection.tests.map(testListLine).join('\n')}\n`)
    console.log(`Rechecking ${selection.tests.length} failed test(s), ${RECHECK_REPEATS} runs each without retries:\n${selection.tests.map(testListLine).join('\n')}`)
    process.exitCode = 0
  } else {
    const recheck = await readReport(secondPath)
    const problems = recheck ? recheckProblems(selection.tests, recheck) : ['The recheck left no Playwright report.']
    if (problems.length === 0) {
      console.log(flakyWarning(selection.tests))
      process.exitCode = 0
    } else {
      console.log(`The recheck did not pass, so the shard fails:\n${problems.join('\n')}`)
    }
  }
}
