import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from './fixtures.js'

const execFileAsync = promisify(execFile)

interface TraceReport {
  suites: Array<{ suites?: TraceReport['suites']; specs?: Array<{
    title: string
    tests: Array<{ results: Array<{ status: string; attachments: Array<{ name: string; path?: string }> }> }>
  }> }>
}

test('retains Electron page snapshots for failed fixtures and manual restarts only', async ({ electronTraces: _electronTraces }, testInfo) => {
  test.setTimeout(100_000)
  const reportPath = testInfo.outputPath('child-report.json')
  try {
    await execFileAsync(process.execPath, [
      join(process.cwd(), 'node_modules/@playwright/test/cli.js'), 'test',
      '--config', 'tests/fixtures/electron-tracing/playwright.config.ts',
      '--output', testInfo.outputPath('child-results')
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024
    })
    throw new Error('The diagnostic fixture must contain two intentional test failures')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 1) throw error
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as TraceReport
  const results = new Map<string, { status: string; browserTraces: number }>()
  async function inspect(suites: TraceReport['suites']): Promise<void> {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const result = spec.tests[0]?.results[0]
        if (!result) throw new Error(`Missing diagnostic result for ${spec.title}`)
        let browserTraces = 0
        for (const attachment of result.attachments) {
          if (!attachment.path?.endsWith('.zip')) continue
          const { stdout } = await execFileAsync('unzip', ['-p', attachment.path, '*.trace'], { maxBuffer: 16 * 1024 * 1024 })
          const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string })
          if (events.some(event => event.type === 'frame-snapshot')) browserTraces += 1
        }
        results.set(spec.title, { status: result.status, browserTraces })
      }
      await inspect(suite.suites ?? [])
    }
  }
  await inspect(report.suites)
  expect(Object.fromEntries(results)).toEqual({
    'fixture failure': { status: 'failed', browserTraces: 1 },
    'failure after manual restart': { status: 'failed', browserTraces: 2 },
    'passing fixture': { status: 'passed', browserTraces: 0 }
  })
  // Keep child diagnostics only if this verification fails. Successful suite
  // artifacts should not contain the fixture's intentional failures.
  await rm(testInfo.outputPath('child-results'), { recursive: true, force: true })
  await rm(reportPath, { force: true })
})
