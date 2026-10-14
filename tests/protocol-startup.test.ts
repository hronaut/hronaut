import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recordStartup, readStartup, startupReason, startupSignal } from '../scripts/diagnostics/protocol-capture-startup.js'
import { patchCaptureDisplay } from '../scripts/diagnostics/protocol-capture-loader.js'
import Reporter from '../scripts/diagnostics/protocol-capture-reporter.js'
import { isolatedProcess } from './helpers/protocol-synthetic-process.js'
const roots: string[] = []
const sentinel = 'SYNTHETIC_PRIVATE_ERROR_URL_TOKEN'
function root() {
  const path = mkdtempSync(join(tmpdir(), 'protocol-startup-')); roots.push(path)
  mkdirSync(join(path, 'diagnostic-output'), { mode: 0o700 }); return path
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
describe('bounded startup checkpoints', () => {
  it('classifies known errno/name/signal values only, without invoking payload getters', () => {
    expect(startupReason({ code: 'EACCES', message: sentinel })).toBe(2)
    expect(startupReason({ name: 'TimeoutError', message: sentinel })).toBe(8)
    expect(startupReason({ code: sentinel })).toBe(0)
    expect(startupReason({ get code() { throw new Error(sentinel) } })).toBe(0)
    expect(startupSignal('SIGKILL')).toBe(11); expect(startupSignal(sentinel)).toBe(0)
  })
  it('writes numeric-only 0600 evidence, preserving earliest 32 checkpoints', () => {
    const path = root(); vi.spyOn(process, 'cwd').mockReturnValue(path)
    for (let i = 0; i < 40; i++) recordStartup(6, 4, startupReason({ message: sentinel }), i)
    const result = readStartup(path)
    expect(result.status).toBe(1); expect(result.processes[0]!.capped).toBe(1)
    expect(result.processes[0]!.rows).toHaveLength(32)
    expect(result.processes[0]!.rows[0]![3]).toBe(0)
    expect(JSON.stringify(result)).not.toContain(sentinel)
    expect(statSync(join(path, `diagnostic-output/startup-${process.pid}.json`)).mode & 0o777).toBe(0o600)
  })
  it('fails closed for missing, oversized, excessive-process and nonnumeric checkpoint files', () => {
    const path = root(); expect(readStartup(path).status).toBe(0)
    const file = join(path, 'diagnostic-output/startup-1.json')
    for (const data of [sentinel.repeat(8192), JSON.stringify([[1, 2, 0, 0, 0, sentinel]]), JSON.stringify([[99, 1, 0, -1, -1, 0]])]) {
      writeFileSync(file, data); expect(readStartup(path).status).toBe(0)
    }
    for (let i = 1; i <= 9; i++) writeFileSync(join(path, `diagnostic-output/startup-${i}.json`), '[]')
    expect(readStartup(path).status).toBe(0)
  })
  it('never changes caller errors when the checkpoint destination is unavailable', () => {
    const path = root(); rmSync(join(path, 'diagnostic-output'), { recursive: true })
    vi.spyOn(process, 'cwd').mockReturnValue(path)
    expect(() => recordStartup(9, 3, 2)).not.toThrow()
    expect(() => recordStartup(100, 100, 100)).not.toThrow()
  })
  it('records package/preload-entry/exit checkpoints in a real synthetic Node process', async () => {
    const original = process.cwd(); const path = root()
    const helpers = join(path, 'scripts/diagnostics'); mkdirSync(helpers, { recursive: true })
    for (const name of ['protocol-capture-startup.ts', 'protocol-capture-preload.ts']) copyFileSync(join(original, 'scripts/diagnostics', name), join(helpers, name))
    writeFileSync(join(path, 'package.json'), '{"type":"module"}')
    mkdirSync(join(path, 'node_modules/playwright-core'), { recursive: true })
    writeFileSync(join(path, 'node_modules/playwright-core/package.json'), '{}')
    const outcome = await isolatedProcess(process.execPath, ['--import', join(helpers, 'protocol-capture-preload.ts'), '-e', `console.error('${sentinel}');process.exit(7)`], path, {})
    expect(outcome.exitCode).toBe(7)
    const checkpoints = readStartup(path)
    expect(checkpoints.status).toBe(1)
    expect(checkpoints.processes[0]!.rows.map(row => row.slice(0, 4))).toEqual([[1, 1, 0, -1], [1, 2, 0, -1], [2, 1, 0, -1], [10, 4, 0, 7]])
    expect(JSON.stringify(checkpoints)).not.toContain(sentinel)
  })
  it('bounds opted-in private error tails and never includes them in numeric startup evidence', () => {
    const path = root(); mkdirSync(join(path, 'diagnostic-private'), { mode: 0o700 })
    vi.spyOn(process, 'cwd').mockReturnValue(path); vi.stubEnv('HRONAUT_PRIVATE_SYNTHETIC_ERRORS', '1')
    const reporter = new Reporter()
    reporter.onTestEnd({ outcome: () => 'unexpected' } as Parameters<Reporter['onTestEnd']>[0],
      { retry: 0, status: 'failed', errors: [{ message: sentinel.repeat(5000), code: 'EACCES' }] } as unknown as Parameters<Reporter['onTestEnd']>[1])
    const raw = readFileSync(join(path, 'diagnostic-private/attempt-0.txt'), 'utf8')
    expect(raw.length).toBe(1024); expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(16384)
    expect(statSync(join(path, 'diagnostic-private/attempt-0.txt')).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(readStartup(path))).not.toContain(sentinel)
  })

  it('pins Xvfb source and inserts lifecycle/readiness checkpoints without altering existing flow', () => {
    const source = readFileSync('tests/integration/worker-display.ts', 'utf8')
    const patched = patchCaptureDisplay(source)
    expect(() => patchCaptureDisplay(source + '\n')).toThrow()
    expect(patched).toContain("child.once('exit', (code, signal) => recordStartup(4, 4, startupSignal(signal), code))")
    expect(patched).toContain('recordStartup(5, 2)\n    return { display, close }')
    expect(patched).toContain('recordStartup(5, 3, startupReason(error))\n    await close()')
    expect(patched).toContain("'-displayfd', '1', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-ac'")
  })
})
