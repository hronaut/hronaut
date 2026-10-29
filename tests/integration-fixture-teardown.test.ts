import { EventEmitter } from 'node:events'
import { createServer, get } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { closeFixtureServer, closeHronaut, collectRendererDiagnostics, launchHronaut } from './integration/fixtures.js'

describe('integration fixture teardown', () => {
  it.each(['monitor', 'window', 'renderer'] as const)('closes a launched app when %s initialization fails', async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-failed-launch-'))
    const failure = new Error(`simulated ${stage} startup failure`)
    const evaluate = vi.fn(async () => undefined)
    const firstWindow = vi.fn(async () => ({
      on: vi.fn(),
      waitForLoadState: vi.fn(async () => { throw failure })
    }))
    if (stage === 'monitor') evaluate.mockRejectedValueOnce(failure)
    if (stage === 'window') firstWindow.mockRejectedValueOnce(failure)
    const close = vi.fn(async () => undefined)
    const child = Object.assign(new EventEmitter(), { exitCode: 0, stderr: null, stdout: null })
    const app = { evaluate, firstWindow, close, process: () => child } as unknown as ElectronApplication
    const launch = vi.spyOn(electron, 'launch').mockResolvedValue(app)
    try {
      await expect(launchHronaut(directory)).rejects.toBe(failure)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      launch.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['prints its native stack first', '1', ['SIGTERM', 'SIGABRT']],
    ['is killed', undefined, ['SIGTERM', 'SIGKILL']]
  ] as const)('a main process stuck past SIGTERM %s', async (_case, stackDumping, signals) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-stuck-main-'))
    try {
      const failure = new Error('simulated monitor startup failure')
      const kills: string[] = []
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null as string | null,
        stderr: null,
        kill(signal: string) {
          kills.push(signal)
          // A stuck main process ignores SIGTERM; a fatal signal ends it.
          if (signal === 'SIGTERM') return true
          child.signalCode = signal
          child.emit('exit', null, signal)
          return true
        }
      })
      const evaluate = vi.fn().mockRejectedValueOnce(failure).mockReturnValue(new Promise<never>(() => undefined))
      const app = { evaluate, close: vi.fn(async () => undefined), process: () => child } as unknown as ElectronApplication
      const launch = vi.spyOn(electron, 'launch').mockResolvedValue(app)
      try {
        const outcome = launchHronaut(directory, undefined, 1, [], [], { ELECTRON_ENABLE_STACK_DUMPING: stackDumping }).catch(error => error)
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2))
        await vi.runAllTimersAsync()
        expect(await outcome).toBe(failure)
        expect(kills).toEqual(signals)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        launch.mockRestore()
      }
    } finally {
      vi.useRealTimers()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('routes every HTTP fixture shutdown through the connection-draining helper', async () => {
    const integrationDirectory = 'tests/integration'
    const files = (await readdir(integrationDirectory))
      .filter((file) => file.endsWith('.e2e.ts'))
    const directCloseSites = (await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(`${integrationDirectory}/${file}`, 'utf8')
    }))))
      .flatMap(({ file, source }) => [...source.matchAll(/\.close\(\s*\(/gu)]
        .map((match) => `${file}:${source.slice(0, match.index).split('\n').length}`))
    const fixtureSource = await readFile(`${integrationDirectory}/fixtures.ts`, 'utf8')

    expect(directCloseSites).toEqual([])
    expect(fixtureSource).toContain('export async function closeFixtureServer')
    expect(fixtureSource).toContain('server.closeAllConnections?.()')
  })

  it('allows recovery cleanup to close an already stopped fixture server', async () => {
    const server = createServer((_request, response) => response.end('ok'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    await closeFixtureServer(server)

    await expect(closeFixtureServer(server)).resolves.toBeUndefined()
  })

  it('drains an active HTTP connection instead of waiting for the global test timeout', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200)
      response.write('still connected')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate a fixture port')
    const client = get(`http://127.0.0.1:${address.port}`)
    await new Promise<void>((resolve, reject) => {
      client.once('response', () => resolve())
      client.once('error', reject)
    })

    await closeFixtureServer(server)

    expect(server.listening).toBe(false)
    client.destroy()
  })

  it('bounds failed-test diagnostics so an unresponsive main process cannot prevent teardown', async () => {
    vi.useFakeTimers()
    try {
      const app = { evaluate: () => new Promise<never>(() => undefined) } as unknown as ElectronApplication
      const diagnostics = collectRendererDiagnostics(app)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(diagnostics).resolves.toEqual({
        unavailable: 'Main process did not respond to diagnostics within 2000ms'
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // A main process that ended mid-test left only "Main process closed before diagnostics could be collected".
  it('says how a launch\'s main process ended and what it last logged when it closed before diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-ended-main-'))
    const stderr = new EventEmitter()
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, stderr, stdout: null })
    const closed = new Error('Target page, context or browser has been closed')
    const app = {
      evaluate: vi.fn(async () => undefined),
      firstWindow: vi.fn(async () => ({ on: vi.fn(), waitForLoadState: vi.fn(async () => undefined) })),
      close: vi.fn(async () => undefined),
      process: () => child
    } as unknown as ElectronApplication
    const launch = vi.spyOn(electron, 'launch').mockResolvedValue(app)
    try {
      await launchHronaut(directory)
      stderr.emit('data', '[startup] Could not open the workspace recovery window; showing the system dialog instead.\n')
      child.exitCode = 0
      child.emit('exit', 0, null)
      vi.mocked(app.evaluate).mockRejectedValueOnce(closed)
      await expect(collectRendererDiagnostics(app)).resolves.toEqual({
        unavailable: 'Main process closed before diagnostics could be collected',
        mainProcess: {
          exitCode: 0,
          signal: null,
          ranForMs: expect.any(Number),
          lastLogLines: ['[startup] Could not open the workspace recovery window; showing the system dialog instead.']
        }
      })
    } finally {
      launch.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('retains successful renderer diagnostics and clears the fallback timer', async () => {
    vi.useFakeTimers()
    try {
      const result = { rendererExits: [], nativeContents: [] }
      const app = { evaluate: async () => result } as unknown as ElectronApplication
      await expect(collectRendererDiagnostics(app)).resolves.toEqual(result)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let an unresponsive Electron evaluation block forced shutdown', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(async () => undefined)
      const app = {
        process: () => ({ exitCode: 0 }),
        evaluate: () => new Promise<never>(() => undefined),
        close
      } as unknown as Parameters<typeof closeHronaut>[0]

      const closing = closeHronaut(app)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(close).toHaveBeenCalledOnce()
      await vi.runAllTimersAsync()
      await expect(closing).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
