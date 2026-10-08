import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, TestInfo } from '@playwright/test'
import { afterEach, expect, it, vi } from 'vitest'
import { continuityResizeDiagnostics, hasContinuityResizeCapture } from './integration/continuity-resize-diagnostics.js'

const never = () => new Promise<never>(() => {})
const directories: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup(attachmentFailure = false) {
  vi.stubEnv('HRONAUT_CONTINUITY_RESIZE_DIAGNOSTICS', 'true')
  const directory = await mkdtemp(join(tmpdir(), 'continuity-probe-')); directories.push(directory)
  const attachments = new Map<string, string>()
  let evaluations = 0
  const send = vi.fn(never)
  const app = {
    evaluate: () => ++evaluations === 1 ? Promise.resolve(process.pid) : never(),
    process: () => ({ pid: process.pid }), firstWindow: async () => ({}),
    context: () => ({ newCDPSession: async () => ({ send, detach: async () => {} }) })
  } as unknown as ElectronApplication
  const info = {
    outputPath: (name: string) => join(directory, name),
    attach: async (name: string, value: { body?: string }) => {
      if (attachmentFailure) throw new Error('controlled attachment failure')
      if (value.body) attachments.set(name, value.body)
    }
  } as unknown as TestInfo
  return { directory, app, info, attachments, send }
}

it('retains unresolved operation and process evidence with stalled controls and preserves the original failure', async () => {
  const { directory, app, info, attachments, send } = await setup()
  vi.stubEnv('HRONAUT_CONTINUITY_RESIZE_STOP_FILE', join(directory, 'stop'))
  expect(hasContinuityResizeCapture()).toBe(false)
  const probe = (await continuityResizeDiagnostics(app, info))!
  const original = new Error('original width oracle deadline')
  const run = async () => {
    try {
      await Promise.race([probe.measure('innerWidth', never), new Promise((_, reject) => setTimeout(() => reject(original), 2250))])
    } finally { await probe.stop() }
  }
  await expect(run()).rejects.toBe(original)
  expect(hasContinuityResizeCapture()).toBe(true)
  expect(await readFile(join(directory, 'stop'), 'utf8')).toBe('captured\n')
  const evidence = JSON.parse(attachments.get('continuity-process')!)
  expect(evidence.operations).toEqual([expect.objectContaining({ label: 'innerWidth', phase: 'start' })])
  expect(evidence.samples.length).toBeGreaterThan(0)
  expect(evidence.samples[0].main.state).toBeTypeOf('string')
  const records = (await readFile(join(directory, 'continuity-checkpoint.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(records.filter(row => row.kind === 'stallTrigger')).toHaveLength(1)
  expect(records.filter(row => row.kind === 'control' && row.phase === 'deadline').map(row => row.target).sort()).toEqual(['main', 'renderer'])
  const threads = records.filter(row => row.kind === 'threads')
  expect(threads).toHaveLength(3)
  for (const row of threads) {
    expect(row.main.threads.length).toBeLessThanOrEqual(64)
    expect(row.renderer.threads.length).toBeLessThanOrEqual(64)
  }
  expect(send).toHaveBeenCalledExactlyOnceWith('Runtime.evaluate', { expression: '1', returnByValue: true })
}, 6000)

it('does not replace an original failure when attachment export also fails', async () => {
  const { app, info } = await setup(true)
  const probe = (await continuityResizeDiagnostics(app, info))!
  const original = new Error('original assertion')
  await expect((async () => { try { throw original } finally { await probe.stop() } })()).rejects.toBe(original)
})

it('caps streamed checkpoints while continuing the original operations', async () => {
  const { directory, app, info } = await setup()
  const probe = (await continuityResizeDiagnostics(app, info))!
  for (let index = 0; index < 5000; index++) expect(await probe.measure('resize', async () => index)).toBe(index)
  await probe.stop()
  expect((await stat(join(directory, 'continuity-checkpoint.jsonl'))).size).toBeLessThanOrEqual(256 * 1024)
})

it('keeps completed checkpoint writes after abrupt worker termination without finally or attachments', async () => {
  const { directory } = await setup()
  const child = spawn(process.execPath, ['tests/fixtures/continuity-diagnostics/worker.ts', directory], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  let stderr = ''; child.stderr.on('data', data => { stderr += data })
  try {
    await vi.waitFor(async () => {
      const content = await readFile(join(directory, 'continuity-checkpoint.jsonl'), 'utf8')
      expect(content, stderr).toContain('"kind":"sample"')
    }, { timeout: 2500, interval: 50 })
    child.kill('SIGKILL')
    expect(await exited).toEqual({ code: null, signal: 'SIGKILL' })
    const records = (await readFile(join(directory, 'continuity-checkpoint.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records).toContainEqual(expect.objectContaining({ kind: 'operation', phase: 'start', label: 'innerWidth' }))
    expect(records.some(row => row.kind === 'sample')).toBe(true)
    expect(records.some(row => row.kind === 'cleanup')).toBe(false)
  } finally { child.kill('SIGKILL'); await exited }
})


it('records native setSize completion before a separate failing diagnostic content-size read', async () => {
  const { directory, app, info } = await setup()
  const window = {
    setSize: vi.fn((_width: number, _height: number) => 'native-completed'),
    getContentSize: () => { throw new Error('controlled diagnostic read failure') },
    on: vi.fn(), off: vi.fn(), webContents: { getOSProcessId: () => process.pid }
  }
  const nativeApp = {
    ...app,
    evaluate: (evaluateFunction: (electron: unknown, path?: string) => unknown, path?: string) => Promise.resolve().then(() => evaluateFunction({ BrowserWindow: { getAllWindows: () => [window] } }, path))
  } as unknown as ElectronApplication
  const probe = (await continuityResizeDiagnostics(nativeApp, info))!
  try {
    expect(window.setSize(640, 800)).toBe('native-completed')
    const events = (await readFile(join(directory, 'continuity-native.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).event)
    expect(events).toEqual(['installed', 'setSize:start', 'setSize:end', 'getContentSize:start', 'getContentSize:error'])
  } finally { await probe.stop() }
})
