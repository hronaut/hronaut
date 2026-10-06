import { EventEmitter } from 'node:events'
import type { BrowserContext, ElectronApplication, Request, Response, TestInfo } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { ActivityFailureDiagnostics, activityDiagnostics, enableActivityDiagnostics } from './integration/activity-failure-diagnostics.js'
import { useHronautFixture } from './integration/fixtures.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fakeApp(evaluate = vi.fn(async () => ({ rendererExits: [], nativeContents: [] }))) {
  return { evaluate, close: vi.fn(async () => undefined), process: () => ({ exitCode: 0 }) } as unknown as ElectronApplication
}
function info(status: TestInfo['status'] = 'failed') {
  return { status, expectedStatus: 'passed' as const, attach: vi.fn(async (_name: string, _options: { body?: string | Buffer; contentType?: string }) => undefined) }
}
function navigation() {
  const context = new EventEmitter()
  const page = new EventEmitter() as EventEmitter & { mainFrame(): unknown; url(): string }
  const frame = { parentFrame: () => null, page: () => page, url: () => 'http://127.0.0.1:1234/synthetic' }
  page.mainFrame = () => frame
  page.url = frame.url
  const request = { isNavigationRequest: () => true, url: frame.url, frame: () => frame } as unknown as Request
  return { context, page, frame, request }
}

describe('bounded activity failure diagnostics', () => {
  it('returns the exact original promise, result and rejection without new operations or timers', async () => {
    let now = 10
    const recorder = new ActivityFailureDiagnostics(() => now)
    const operation = deferred<{ isError: boolean }>()
    const call = vi.fn(() => operation.promise)
    expect(recorder.mcp('wait', call)).toBe(operation.promise)
    now = 35
    const value = { isError: true }
    operation.resolve(value)
    expect(await operation.promise).toBe(value)
    const rejection = new Error('secret-error-canary')
    const rejected = deferred<never>()
    expect(recorder.main(() => rejected.promise)).toBe(rejected.promise)
    rejected.reject(rejection)
    await expect(rejected.promise).rejects.toBe(rejection)
    expect(call).toHaveBeenCalledOnce()
    const output = recorder.finish()
    expect(output).not.toContain('canary')
    expect(JSON.parse(output).records).toMatchObject([{ kind: 'mcp', elapsed: 25, outcome: 'returned-error' }, { kind: 'main', outcome: 'rejected' }])
  })

  it('preserves synchronous throws and observes an otherwise unawaited rejection safely', async () => {
    const recorder = new ActivityFailureDiagnostics()
    const error = new Error('original')
    expect(() => recorder.main(() => { throw error })).toThrow(error)
    recorder.mcp('wait', () => Promise.reject(error))
    await new Promise(resolve => setImmediate(resolve))
    expect(JSON.parse(recorder.finish()).records.map((row: { outcome: string }) => row.outcome)).toEqual(['rejected', 'rejected'])
  })

  it('categorizes health outcomes without reading bodies, headers or error text', async () => {
    const recorder = new ActivityFailureDiagnostics()
    for (const status of [200, 401, 403, 429, 503, 302]) {
      await recorder.health(async () => ({ status, get headers() { throw Error('headers read') }, get body() { throw Error('body read') } }))
    }
    await expect(recorder.health(() => Promise.reject(new Error('credential-canary')))).rejects.toThrow('credential-canary')
    const output = recorder.finish()
    expect(JSON.parse(output).records.map((row: { outcome: string }) => row.outcome)).toEqual(['ok', 'unauthorized', 'forbidden', 'rate-limited', 'server-error', 'other-http', 'network-error'])
    expect(output).not.toContain('canary')
  })

  it('freezes pending durations, caps records and UTF-8 bytes, and ignores late completion', async () => {
    let now = 0
    const recorder = new ActivityFailureDiagnostics(() => now)
    const operation = deferred<unknown>()
    recorder.main(() => operation.promise)
    for (let i = 0; i < 100; i++) await recorder.mcp('open', async () => ({ isError: false, content: 'private-canary' }))
    now = 123
    const snapshot = recorder.finish()
    expect(JSON.parse(snapshot).records).toHaveLength(64)
    expect(JSON.parse(snapshot)).toMatchObject({ dropped: 37, records: [{ outcome: 'pending', elapsed: 123 }, ...Array.from({ length: 63 }, () => ({}))] })
    expect(Buffer.byteLength(snapshot)).toBeLessThanOrEqual(8192)
    expect(snapshot).not.toContain('canary')
    now = 999
    operation.resolve('late-canary')
    await operation.promise
    expect(recorder.finish()).toBe(snapshot)
  })

  it('records only synthetic navigation metadata and removes all listeners', () => {
    const recorder = new ActivityFailureDiagnostics()
    const { context, page, frame, request } = navigation()
    recorder.watchNavigation(context as unknown as BrowserContext, frame.url())
    context.emit('request', { ...request, url: () => 'https://private.invalid/credential-canary' })
    context.emit('request', request)
    context.emit('response', { request: () => request, status: () => 200 } as unknown as Response)
    page.emit('framenavigated', frame)
    page.emit('domcontentloaded')
    page.emit('load')
    context.emit('requestfinished', request)
    context.emit('requestfailed', request)
    page.emit('crash')
    page.emit('close')
    const output = recorder.finish()
    expect(JSON.parse(output).records.map((row: { outcome: string }) => row.outcome)).toEqual(['request', 'http-ok', 'commit', 'dom-ready', 'load', 'finished', 'failed', 'crash', 'close'])
    expect(output).not.toMatch(/http:|https:|canary|synthetic/)
    expect(context.eventNames()).toEqual([])
    expect(page.eventNames()).toEqual([])
    page.emit('load')
    expect(recorder.finish()).toBe(output)
  })

  it.each(['failed', 'timedOut'] as const)('uses actual fixture failure attachment before client connection: %s', async status => {
    const app = fakeApp()
    const details = info(status)
    const original = new Error('connection-not-started')
    const context = navigation()
    await expect(useHronautFixture(app, async () => {
      const recorder = enableActivityDiagnostics(app)
      recorder.watchNavigation(context.context as unknown as BrowserContext, context.frame.url())
      recorder.mcp('wait', () => new Promise<never>(() => undefined))
      throw original
    }, details)).rejects.toBe(original)
    const attachments = details.attach.mock.calls.filter(([name]) => name === 'activity-failure-diagnostics')
    expect(attachments).toHaveLength(1)
    expect(JSON.parse(String(attachments[0]![1].body)).records).toMatchObject([{ kind: 'mcp', outcome: 'pending' }, { kind: 'main', label: 'failure-probe', outcome: 'completed' }])
    expect(app.evaluate).toHaveBeenCalledTimes(2) // Existing diagnostics and renderer-listener cleanup.
    expect(app.close).toHaveBeenCalledOnce()
    expect(context.context.eventNames()).toEqual([])
    expect(activityDiagnostics(app)).toBeUndefined()
  })

  it('uses only the existing 1000ms failure probe deadline for an unresponsive main process', async () => {
    vi.useFakeTimers()
    try {
      const app = fakeApp(vi.fn(async () => ({ rendererExits: [], nativeContents: [] })).mockImplementationOnce(() => new Promise<never>(() => undefined)))
      const details = info()
      const task = useHronautFixture(app, async () => { enableActivityDiagnostics(app) }, details)
      await vi.advanceTimersByTimeAsync(1000)
      await task
      const attachment = details.attach.mock.calls.find(([name]) => name === 'activity-failure-diagnostics')!
      expect(JSON.parse(String(attachment[1].body)).records).toMatchObject([{ label: 'failure-probe', elapsed: 1000, outcome: 'deadline-exceeded' }])
      expect(app.evaluate).toHaveBeenCalledTimes(2) // Existing diagnostics and renderer-listener cleanup.
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('does not attach, probe or retain listeners on success', async () => {
    const app = fakeApp()
    const details = info('passed')
    const context = navigation()
    await useHronautFixture(app, async () => { enableActivityDiagnostics(app).watchNavigation(context.context as unknown as BrowserContext, context.frame.url()) }, details)
    expect(details.attach).not.toHaveBeenCalled()
    expect(app.evaluate).toHaveBeenCalledOnce() // Existing renderer-listener cleanup only.
    expect(context.context.eventNames()).toEqual([])
    expect(activityDiagnostics(app)).toBeUndefined()
  })

  it('cleans up after attachment failures and preserves the original error even if app cleanup fails', async () => {
    const app = fakeApp()
    const details = info()
    details.attach.mockRejectedValue(new Error('attachment-canary'))
    vi.mocked(app.close).mockRejectedValue(new Error('close-canary'))
    app.process = () => ({ get exitCode() { throw Error('process-cleanup-canary') } }) as unknown as ReturnType<ElectronApplication['process']>
    const original = new Error('original assertion')
    const context = navigation()
    await expect(useHronautFixture(app, async () => {
      enableActivityDiagnostics(app).watchNavigation(context.context as unknown as BrowserContext, context.frame.url())
      throw original
    }, details)).rejects.toBe(original)
    expect(details.attach.mock.calls.some(([name]) => name === 'activity-failure-diagnostics')).toBe(true)
    expect(context.context.eventNames()).toEqual([])
    expect(activityDiagnostics(app)).toBeUndefined()
  })

  it('continues listener cleanup after a removal failure and serializes only a counter', () => {
    const recorder = new ActivityFailureDiagnostics()
    const { context, page, frame, request } = navigation()
    recorder.watchNavigation(context as unknown as BrowserContext, frame.url())
    context.emit('request', request)
    const off = page.off.bind(page)
    vi.spyOn(page, 'off').mockImplementation((event, listener) => { off(event, listener); throw Error('cleanup-canary') })
    const output = recorder.finish()
    expect(JSON.parse(output).cleanupFailures).toBe(5)
    expect(output).not.toContain('canary')
    expect(context.eventNames()).toEqual([])
    expect(page.eventNames()).toEqual([])
  })
  it('removes partially registered navigation listeners if installation fails', () => {
    const recorder = new ActivityFailureDiagnostics()
    const { context, frame } = navigation()
    const on = context.on.bind(context)
    vi.spyOn(context, 'on').mockImplementation((event, listener) => {
      if (event === 'response') throw Error('installation-canary')
      return on(event, listener)
    })
    recorder.watchNavigation(context as unknown as BrowserContext, frame.url())
    expect(context.listenerCount('request')).toBe(1)
    const output = recorder.finish()
    expect(JSON.parse(output).cleanupFailures).toBe(1)
    expect(context.eventNames()).toEqual([])
    expect(output).not.toContain('canary')
  })

})
