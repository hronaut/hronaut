import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { CaptureRing, projectSnapshot } from '../src/main/capture-order-state.js'
const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '..')

// Real locked Playwright CLI + configuration loading; no browser fixtures or Electron.
it.each(['passed', 'failed', 'flaky'] as const)('exports bounded %s outcomes through the real reporter loader', async mode => {
  const directory = await mkdtemp(join(root, '.capture-loader-'))
  const output = mode === 'passed' ? join(directory, 'capture-order-evidence/outcomes.json') : join(directory, 'outcomes.json')
  const installedVersion = JSON.parse(await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8')).version
  const lockedVersion = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/playwright'].version
  expect(installedVersion).toBe(lockedVersion)
  const title = (await readFile(join(root, 'scripts/diagnostics/capture-order.txt'), 'utf8')).trim().split('\n')[62]!.split(' › ').slice(2).join(' › ')
  const state = new CaptureRing()
  state.record({ event: 'installed', ms: 0, preexisting: 0 })
  state.record({ event: 'capture-success', ms: 1, owner: 'foreground', imageWidth: 10, imageHeight: 10, empty: false })
  const payload = JSON.stringify({ processes: [{ data: state.snapshot() }], omittedProcesses: 0 })
  const canary = 'PRIVATE_REPORTER_CANARY_https://private.invalid/profile/value'
  try {
    await mkdir(join(directory, 'scripts/diagnostics'), { recursive: true })
    await copyFile(join(root, 'scripts/diagnostics/capture-order.txt'), join(directory, 'scripts/diagnostics/capture-order.txt'))
    await writeFile(join(directory, 'playwright.config.ts'), `
import original from '../playwright.config.js'
export default { ...original, testDir: ${JSON.stringify(directory)}, testMatch: 'clipboard-async.e2e.ts',
  reporter: [[${JSON.stringify(join(root, 'scripts/diagnostics/capture-order-reporter.ts'))}, ${JSON.stringify(mode === 'passed' ? {} : { outputFile: output })}]],
  outputDir: ${JSON.stringify(join(directory, 'results'))}, use: { trace: 'off' } }
`)
    await writeFile(join(directory, 'clipboard-async.e2e.ts'), `
import { test } from '@playwright/test'
test(${JSON.stringify(title)}, async ({}, info) => {
  console.log(${JSON.stringify(canary)})
  await info.attach('page-source', { body: ${JSON.stringify(canary)}, contentType: 'text/plain' })
  await info.attach('bounded-native-capture-events', { body: ${JSON.stringify(payload)}, contentType: 'application/json' })
  if (${JSON.stringify(mode)} === 'failed' || (${JSON.stringify(mode)} === 'flaky' && info.retry === 0)) {
    throw new Error('UnknownVizError ' + ${JSON.stringify(canary)})
  }
})
`)
    let code = 0
    let stdout = ''
    let stderr = ''
    try {
      const result = await execute(process.execPath, [join(root, 'node_modules/playwright/cli.js'), 'test', '--config', join(directory, 'playwright.config.ts')],
        { cwd: directory, env: { ...process.env, CI: 'true' }, timeout: 30_000, maxBuffer: 1024 * 1024 })
      stdout = result.stdout; stderr = result.stderr
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string }
      code = result.code ?? -1; stdout = result.stdout ?? ''; stderr = result.stderr ?? ''
    }
    expect(code, `${stdout}\n${stderr}`).toBe(mode === 'passed' ? 0 : 1)
    const bytes = await readFile(output)
    const report = JSON.parse(bytes.toString())
    expect(bytes.length).toBeLessThan(12 * 1024 * 1024)
    expect(bytes.toString()).not.toContain(canary)
    expect(bytes.toString()).not.toContain(directory)
    expect(bytes.toString()).not.toContain('page-source')
    expect(report.status).toBe(mode === 'passed' ? 'passed' : 'failed')
    expect(report.planned).toEqual([63])
    expect(report.runnerErrors).toBe(0)
    expect(report.omittedOutcomes).toBe(0)
    expect(report.outcomes.map((row: { status: string; retry: number }) => [row.status, row.retry])).toEqual(
      mode === 'passed' ? [['passed', 0]] : mode === 'failed' ? [['failed', 0], ['failed', 1]] : [['failed', 0], ['passed', 1]])
    for (const row of report.outcomes) {
      expect(row.unknownVizError).toBe(row.status === 'failed')
      expect(projectSnapshot(row.telemetry.processes[0].data)).toEqual(state.snapshot())
      expect(row.telemetryMissing).toBe(false)
      expect(row.telemetryOmitted).toBe(false)
    }
    const evidence = process.env.HRONAUT_REPORTER_CONTRACT_EVIDENCE_DIR
    if (evidence) {
      await mkdir(evidence, { recursive: true })
      await copyFile(output, join(evidence, `${mode}-outcomes.json`))
      await writeFile(join(evidence, `${mode}-receipt.json`), JSON.stringify({ mode, exitCode: code, bytes: bytes.length,
        playwrightVersion: installedVersion, lockedVersion,
        rawCanaryExcluded: true, privatePathExcluded: true, browserFixturesUsed: false, defaultOutputExercised: mode === 'passed' }))
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 40_000)
