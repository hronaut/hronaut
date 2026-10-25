import { readFile, writeFile } from 'node:fs/promises'
import { isMainModule } from './is-main-module.ts'

interface ReportResult {
  status: string
  duration: number
}

interface ReportSpec {
  title: string
  file: string
  tests: Array<{ results: ReportResult[] }>
}

interface ReportSuite {
  title: string
  specs?: ReportSpec[]
  suites?: ReportSuite[]
}

/** The parts of a Playwright JSON report the durations come from. */
export interface RunReport {
  suites?: ReportSuite[]
}

/** Seconds each test took, by its test-list line. */
export type TestDurations = Record<string, number>

/**
 * The seconds each test in a run's reports took, by the `--test-list` line that names it (file › describes › title; an
 * untitled describe adds no title). A test's last passing attempt counts, or its last attempt when none passed.
 */
export function reportedDurations(reports: RunReport[]): TestDurations {
  const durations: TestDurations = {}
  const walk = (suite: ReportSuite, describes: string[]) => {
    for (const spec of suite.specs ?? []) {
      const results = spec.tests.flatMap((test) => test.results).filter((result) => result.status !== 'skipped')
      const counted = results.filter((result) => result.status === 'passed').at(-1) ?? results.at(-1)
      if (counted) durations[[spec.file, ...describes, spec.title].join(' › ')] = Math.round(counted.duration / 100) / 10
    }
    for (const child of suite.suites ?? []) walk(child, child.title ? [...describes, child.title] : describes)
  }
  for (const report of reports) for (const fileSuite of report.suites ?? []) walk(fileSuite, [])
  return durations
}

/** The recorded durations with a run's new ones; with `replace`, only the run's, for a run of the whole suite. */
export function mergedDurations(recorded: TestDurations, run: TestDurations, replace: boolean): TestDurations {
  const merged = replace ? { ...run } : { ...recorded, ...run }
  return Object.fromEntries(Object.entries(merged).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}

/** One test per line, so a refresh reads as a small diff. */
export function serializeDurations(durations: TestDurations): string {
  const entries = Object.entries(durations).map(([line, seconds]) => `  ${JSON.stringify(line)}: ${seconds}`)
  return entries.length ? `{\n${entries.join(',\n')}\n}\n` : '{}\n'
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const replace = args[0] === '--replace'
  const [durationsPath, ...reportPaths] = replace ? args.slice(1) : args
  if (!durationsPath || reportPaths.length === 0) {
    throw new Error('Usage: node scripts/update-integration-durations.ts [--replace] tests/integration/durations.json <report or durations.json>...')
  }
  // Each input is a shard's Playwright JSON report, or the durations a CI shard recorded from one.
  const inputs = await Promise.all(reportPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8')) as RunReport | TestDurations))
  const isReport = (input: RunReport | TestDurations): input is RunReport => Array.isArray((input as RunReport).suites)
  let recorded: TestDurations = {}
  try {
    recorded = JSON.parse(await readFile(durationsPath, 'utf8')) as TestDurations
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const run: TestDurations = Object.assign(
    reportedDurations(inputs.filter(isReport)),
    ...inputs.filter((input): input is TestDurations => !isReport(input))
  )
  await writeFile(durationsPath, serializeDurations(mergedDurations(recorded, run, replace)))
  console.log(`Recorded ${Object.keys(run).length} test durations from ${reportPaths.length} file(s) in ${durationsPath}.`)
}
