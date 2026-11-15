import { readFile, writeFile } from 'node:fs/promises'
import { isMainModule } from './is-main-module.ts'

interface ReportSpec {
  title: string
  file: string
}

interface ReportSuite {
  title: string
  specs?: ReportSpec[]
  suites?: ReportSuite[]
}

/** The parts of a `playwright test --list --reporter=json` report the plan reads. */
export interface ListReport {
  suites?: ReportSuite[]
  errors?: unknown[]
}

export interface ListedTest {
  file: string
  titlePath: string[]
}

/** Seconds each test took in an earlier run, by its test-list line. */
export type TestDurations = Record<string, number>

/**
 * Every test in a list report with its describe titles. The top-level suites are files; nested suites are describe
 * blocks, and an untitled one adds no title, as in Playwright's own title paths.
 */
export function listedTests(report: ListReport): ListedTest[] {
  const found: ListedTest[] = []
  const walk = (suite: ReportSuite, describes: string[]) => {
    for (const spec of suite.specs ?? []) found.push({ file: spec.file, titlePath: [...describes, spec.title] })
    for (const child of suite.suites ?? []) walk(child, child.title ? [...describes, child.title] : describes)
  }
  for (const fileSuite of report.suites ?? []) walk(fileSuite, [])
  return found
}

/** A test as Playwright's `--test-list` names it: its file, describe titles and title. */
export function testListLine(test: ListedTest): string {
  return [test.file, ...test.titlePath].join(' › ')
}

/**
 * Why a test list cannot select exactly these tests, if it cannot. `--test-list` reads one test per line, splits it on
 * › and trims each title, and a line selects every test whose title path starts with it, so such a test would run in
 * no shard or in two.
 */
export function unlistable(tests: ListedTest[]): string | undefined {
  for (const test of tests) {
    if ([test.file, ...test.titlePath].some((part) => part === '' || /[›\r\n]/.test(part) || part !== part.trim())) {
      return `"${testListLine(test)}" cannot be named in a test list`
    }
  }
  const lines = new Set(tests.map(testListLine))
  if (lines.size !== tests.length) return 'two tests have the same title path'
  for (const test of tests) {
    for (let length = 1; length < test.titlePath.length; length++) {
      const prefix = testListLine({ file: test.file, titlePath: test.titlePath.slice(0, length) })
      if (lines.has(prefix)) return `"${prefix}" also selects "${testListLine(test)}"`
    }
  }
  return undefined
}

/** Each test's recorded seconds; a test without one counts as the median of the recorded ones, or 1 s without any. */
export function testSeconds(tests: ListedTest[], durations: TestDurations): number[] {
  const recorded = tests.map((test) => recordedSeconds(durations, test))
  const known = recorded.filter((seconds): seconds is number => seconds !== undefined).sort((left, right) => left - right)
  const median = known.length ? known[Math.floor(known.length / 2)]! : 1
  return recorded.map((seconds) => seconds ?? median)
}

/** A test's recorded duration in seconds, when one was recorded and is usable. */
function recordedSeconds(durations: TestDurations, test: ListedTest): number | undefined {
  const seconds = durations[testListLine(test)]
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** How many tests have no recorded duration, so a summary can say when the recorded durations need a refresh. */
export function unrecordedTests(tests: ListedTest[], durations: TestDurations): number {
  return tests.filter((test) => recordedSeconds(durations, test) === undefined).length
}

/**
 * Splits the tests into `total` shards of about equal duration: longest first, each to the shard with the least time
 * so far (the lowest index on a tie). Every shard computes the same split from the same list and durations.
 */
export function planShards(tests: ListedTest[], durations: TestDurations, total: number): Array<{ tests: ListedTest[], seconds: number }> {
  const seconds = testSeconds(tests, durations)
  const order = tests.map((test, index) => ({ test, line: testListLine(test), seconds: seconds[index]! }))
    .sort((left, right) => right.seconds - left.seconds || (left.line < right.line ? -1 : left.line > right.line ? 1 : 0))
  const shards = Array.from({ length: total }, () => ({ tests: [] as ListedTest[], seconds: 0 }))
  for (const { test, seconds: duration } of order) {
    let lightest = shards[0]!
    for (const shard of shards) if (shard.seconds < lightest.seconds) lightest = shard
    lightest.tests.push(test)
    lightest.seconds += duration
  }
  return shards
}

/** Exit status for a suite every shard lists alike that a test list cannot split: the runner keeps `--shard`. */
export const KEEP_PLAYWRIGHT_SPLIT = 3

/** Why a list report cannot be split at all, which fails the shard: the other shards may have split it by durations. */
export function unsplittable(report: ListReport, tests: ListedTest[]): string | undefined {
  if (report.errors?.length) {
    const messages = report.errors.slice(0, 3).map((error) => {
      const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
      return message.split('\n')[0]!.slice(0, 300)
    })
    return `listing the tests reported ${report.errors.length} error(s): ${messages.join('; ')}`
  }
  return tests.length === 0 ? 'no test was listed' : undefined
}

if (isMainModule(import.meta.url)) {
  const [listPath, durationsPath, shard, outputPath] = process.argv.slice(2)
  const selection = /^(\d+)\/(\d+)$/.exec(shard ?? '')
  if (!listPath || !durationsPath || !selection || !outputPath) {
    throw new Error('Usage: node scripts/plan-integration-shard.ts <list-report.json> <durations.json> <index/total> <test-list.txt>')
  }
  const index = Number(selection[1])
  const total = Number(selection[2])
  if (index < 1 || index > total) throw new Error(`Shard ${shard} is out of range.`)
  const report = JSON.parse(await readFile(listPath, 'utf8')) as ListReport
  const tests = listedTests(report)
  const broken = unsplittable(report, tests)
  const unnamed = broken ? undefined : unlistable(tests)
  if (broken) {
    console.log(`::error title=Electron shard plan::Shard ${shard} cannot take its part of the split: ${broken}.`)
    process.exitCode = 1
  } else if (unnamed) {
    // Every shard lists the same tests, so every one keeps Playwright's split by test count alike.
    console.log(`::warning title=Electron shard plan::Splitting shards by test count: ${unnamed}.`)
    process.exitCode = KEEP_PLAYWRIGHT_SPLIT
  } else {
    let durations: TestDurations = {}
    try {
      durations = JSON.parse(await readFile(durationsPath, 'utf8')) as TestDurations
    } catch (error) {
      console.log(`No recorded test durations (${error instanceof Error ? error.message : String(error)}); every test counts the same.`)
    }
    const planned = planShards(tests, durations, total)[index - 1]!
    await writeFile(outputPath, planned.tests.map((test) => `${testListLine(test)}\n`).join(''))
    const unrecorded = unrecordedTests(tests, durations)
    console.log(`Shard ${index}/${total} runs ${planned.tests.length} of ${tests.length} tests, about ${Math.round(planned.seconds / 60)} min by recorded durations`
      + (unrecorded ? `; ${unrecorded} of the ${tests.length} have none and count as the median one.` : '.'))
  }
}
