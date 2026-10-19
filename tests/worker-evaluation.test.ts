import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { WorkerEvaluations, WorkerEvaluationStoppedError } from '../src/main/browser/worker-evaluation/worker-evaluation.js'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'
import { WORKER_EVALUATION_LIMITS } from '../src/shared/worker-evaluation.js'

const ORIGIN = 'http://localhost:3000'

interface FakeWorker { targetId: string; url: string; title?: string; parentFrameId?: string }
interface Deferred { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** A page whose debugger attaches the given workers while auto-attach is on; commands are recorded with their session. */
function page(workers: FakeWorker[]) {
  const contents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const debuggerEvents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }> = []
  const frame = { id: 'main', loaderId: 'loader-1', url: `${ORIGIN}/app` }
  const sessions = new Map<string, FakeWorker>()
  let nextSession = 0
  let attached = true
  let evaluation: ((params: Record<string, unknown>, sessionId: string) => unknown) | undefined
  let held: Deferred | undefined
  const root = (method: string, params: unknown): void => { debuggerEvents.emit('message', {}, method, params) }
  debuggerEvents.isAttached = () => attached
  debuggerEvents.sendCommand = (method: string, params?: Record<string, unknown>, sessionId?: string) => {
    sent.push({ method, params, sessionId })
    if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { ...frame } } })
    if (method === 'Target.setAutoAttach') {
      if (params?.autoAttach) {
        for (const worker of workers) {
          const id = `session-${++nextSession}`
          sessions.set(id, worker)
          root('Target.attachedToTarget', { sessionId: id, waitingForDebugger: false, targetInfo: { type: 'worker', title: worker.title ?? worker.url, parentFrameId: 'main', ...worker } })
        }
      } else {
        for (const id of [...sessions.keys()]) { sessions.delete(id); root('Target.detachedFromTarget', { sessionId: id }) }
      }
      return Promise.resolve({})
    }
    if (method === 'Runtime.evaluate') {
      if (!sessionId || !sessions.has(sessionId)) return Promise.reject(new Error('Session with given id not found.'))
      if (held) return new Promise((resolve, reject) => { held = { resolve, reject } })
      return Promise.resolve(evaluation ? evaluation(params!, sessionId) : { result: { value: { kind: 'json', text: JSON.stringify({ target: sessions.get(sessionId)!.targetId }) } } })
    }
    return Promise.resolve({})
  }
  Object.assign(contents, {
    debugger: debuggerEvents,
    isDestroyed: () => false,
    isCrashed: () => false,
    getURL: () => frame.url
  })
  return {
    webContents: contents as unknown as WebContents,
    frame,
    workers,
    sent,
    evaluations: () => sent.filter(command => command.method === 'Runtime.evaluate'),
    sessionOf: (targetId: string) => [...sessions].find(([, worker]) => worker.targetId === targetId)?.[0],
    answerWith: (answer: (params: Record<string, unknown>, sessionId: string) => unknown) => { evaluation = answer },
    hold: () => { held = { resolve: () => undefined, reject: () => undefined } },
    rejectHeld: (error: Error) => held!.reject(error),
    exitRenderer: () => contents.emit('render-process-gone', {}, { reason: 'crashed' }),
    endWorker: (targetId: string) => {
      const id = [...sessions].find(([, worker]) => worker.targetId === targetId)?.[0]
      if (id) { sessions.delete(id); root('Target.detachedFromTarget', { sessionId: id }) }
    },
    detach: () => { attached = false; debuggerEvents.emit('detach') },
    listeners: () => contents.eventNames().reduce((total, name) => total + contents.listenerCount(name), 0)
      + debuggerEvents.eventNames().reduce((total, name) => total + debuggerEvents.listenerCount(name), 0)
  }
}

const classic = { targetId: 'classic', url: `${ORIGIN}/workers/classic.js?token=secret` }
const module = { targetId: 'module', url: `${ORIGIN}/workers/module.js`, title: 'module-worker' }

function fixture(workers: FakeWorker[] = [classic, module]) {
  const fake = page(workers)
  const tab = { id: 'tab-1', url: `${ORIGIN}/app`, navigationGeneration: 1, observationGeneration: 1, webContents: fake.webContents }
  let current = true
  const controller = new WorkerEvaluations<typeof tab>({
    isCurrent: () => current,
    withDebugger: (_tab, operation) => operation()
  })
  const authority = { assertCurrent: vi.fn() }
  const list = () => controller.list(tab, authority)
  const evaluate = (handle: string, script = 'self.marker', timeoutMs = 1_000, signal?: AbortSignal) =>
    controller.evaluate(tab, handle, script, { timeoutMs, signal }, authority)
  return { ...fake, tab, controller, authority, list, evaluate, leave: () => { current = false } }
}

describe('worker evaluation', () => {
  it('lists only same-origin workers of the top-level document, with opaque handles, and detaches them again', async () => {
    const extra = Array.from({ length: WORKER_EVALUATION_LIMITS.maxWorkers }, (_, index) => ({ targetId: `extra-${index}`, url: `${ORIGIN}/workers/extra.js` }))
    const f = fixture([
      classic, module,
      { targetId: 'framed', url: `${ORIGIN}/workers/frame.js`, parentFrameId: 'child-frame' },
      { targetId: 'blob', url: `blob:${ORIGIN}/6a1c` },
      { targetId: 'other', url: 'http://localhost:4000/worker.js' },
      ...extra
    ])
    const baseline = f.listeners()
    const report = await f.list()
    expect(report.origin).toBe(ORIGIN)
    expect(report.workers).toHaveLength(WORKER_EVALUATION_LIMITS.maxWorkers)
    // Paths drop the query; a name is kept only when the page gave one.
    expect(report.workers[0]).toEqual({ handle: expect.any(String), path: '/workers/classic.js' })
    expect(report.workers[1]).toEqual({ handle: expect.any(String), path: '/workers/module.js', name: 'module-worker' })
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(JSON.stringify(report)).not.toContain('classic"')
    expect(report.omitted).toEqual({ frameWorkers: 1, otherScripts: 2, overLimit: 2 })
    expect(new Set(report.workers.map(worker => worker.handle)).size).toBe(report.workers.length)
    const autoAttach = f.sent.filter(command => command.method === 'Target.setAutoAttach').map(command => command.params)
    expect(autoAttach).toEqual([
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'worker' }] },
      { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }
    ])
    expect(f.authority.assertCurrent).toHaveBeenCalledWith(ORIGIN)
    // Only the detach watch that retires handles stays.
    expect(f.listeners()).toBe(baseline + 1)
  })

  it('evaluates in exactly the selected worker and never in a sibling or the page', async () => {
    const f = fixture()
    const { workers } = await f.list()
    const result = await f.evaluate(workers[1]!.handle, 'self.marker + "</script>"')
    expect(result).toEqual({ action: 'evaluate', tabId: 'tab-1', worker: workers[1], resultKind: 'json', result: { target: 'module' } })
    const evaluations = f.evaluations()
    expect(evaluations).toHaveLength(1)
    expect(evaluations[0]!.sessionId).toMatch(/^session-/)
    // The evaluation went to the session attached for the module worker in that call.
    expect(evaluations[0]!.sessionId).toBe('session-4')
    expect(evaluations[0]!.params).toMatchObject({ awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true })
    expect(evaluations[0]!.params!.expression).toContain('\\u003c/script\\u003e')
    expect(f.sent.at(-1)).toMatchObject({ method: 'Target.setAutoAttach', params: { autoAttach: false } })
  })

  it('retires handles on a new listing, navigation, reload, workspace control change and debugger detach', async () => {
    const f = fixture()
    let { workers } = await f.list()
    const old = workers[0]!.handle
    ;({ workers } = await f.list())
    await expect(f.evaluate(old)).rejects.toThrow(/Unknown worker handle/)

    f.tab.navigationGeneration++
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/handle expired/)
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/Unknown worker handle/)
    f.tab.navigationGeneration--

    ;({ workers } = await f.list())
    f.tab.observationGeneration++
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/handle expired/)
    f.tab.observationGeneration--

    ;({ workers } = await f.list())
    f.frame.loaderId = 'loader-2'
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/handle expired/)
    f.frame.loaderId = 'loader-1'

    ;({ workers } = await f.list())
    f.detach()
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/Unknown worker handle/)
    expect(f.evaluations()).toHaveLength(0)
  })

  it('keeps no handles from a listing during which the debugger left the page', async () => {
    const f = fixture()
    const listing = f.controller.list(f.tab, f.authority)
    f.detach()
    await expect(listing).rejects.toThrow(/page changed while its workers were being listed/)
  })

  it('refuses a worker recreated at the same address and handles from another tab', async () => {
    const f = fixture()
    const { workers } = await f.list()
    f.workers[0] = { ...classic, targetId: 'classic-again' }
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/worker behind this handle ended/)
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow(/Unknown worker handle/)
    // Its sibling's handle still works.
    await expect(f.evaluate(workers[1]!.handle)).resolves.toMatchObject({ result: { target: 'module' } })
    expect(f.evaluations()).toHaveLength(1)

    const other = fixture()
    await other.list()
    await expect(other.controller.evaluate({ ...other.tab, id: 'tab-2' }, workers[1]!.handle, 'self.marker', { timeoutMs: 1_000 }, other.authority))
      .rejects.toThrow(/Unknown worker handle/)
    await expect(other.evaluate(workers[1]!.handle)).rejects.toThrow(/Unknown worker handle/)
    expect(other.evaluations()).toHaveLength(0)
  })

  it('bounds results the worker returns, whatever the wrapper reported', async () => {
    const f = fixture()
    const { workers } = await f.list()
    const answers: unknown[] = [
      { kind: 'undefined' },
      { kind: 'unserializable' },
      { kind: 'truncated', text: 'x'.repeat(WORKER_EVALUATION_LIMITS.maxResultChars + 10), totalChars: 500_000 },
      { kind: 'json', text: 'y'.repeat(WORKER_EVALUATION_LIMITS.maxResultChars + 1) },
      { kind: 'json', text: '{not json' },
      'forged'
    ]
    const results = []
    for (const answer of answers) {
      f.answerWith(() => ({ result: { value: answer } }))
      results.push(await f.evaluate(workers[0]!.handle))
    }
    expect(results.map(result => result.resultKind)).toEqual(['undefined', 'unserializable', 'truncated', 'truncated', 'unserializable', 'unserializable'])
    expect(results[2]!.resultPreview).toHaveLength(WORKER_EVALUATION_LIMITS.maxResultChars)
    expect(results[2]!.resultChars).toBe(500_000)
    expect(results[3]!.resultChars).toBe(WORKER_EVALUATION_LIMITS.maxResultChars + 1)
  })

  it('reports a thrown script with bounded text and releases its handle in the worker session', async () => {
    const f = fixture()
    const { workers } = await f.list()
    f.answerWith(() => ({ result: { objectId: 'result-1' }, exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: ' + 'z'.repeat(5_000), objectId: 'error-1' } } }))
    const error = await f.evaluate(workers[0]!.handle).then(() => new Error("resolved"), (reason: Error) => reason)
    expect(error.message).toMatch(/^The worker script threw: Error: z+$/)
    expect(error.message.length).toBeLessThanOrEqual(WORKER_EVALUATION_LIMITS.maxExceptionChars + 40)
    const session = f.evaluations()[0]!.sessionId
    expect(f.sent.filter(command => command.method === 'Runtime.releaseObject')).toEqual([
      { method: 'Runtime.releaseObject', params: { objectId: 'result-1' }, sessionId: session },
      { method: 'Runtime.releaseObject', params: { objectId: 'error-1' }, sessionId: session }
    ])
  })

  it('stops a script at its deadline, terminates what still runs in that worker and detaches', async () => {
    const f = fixture()
    const { workers } = await f.list()
    f.hold()
    const error = await f.evaluate(workers[0]!.handle, 'new Promise(() => {})', 20).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(WorkerEvaluationStoppedError)
    expect(error).toMatchObject({ reason: 'SCRIPT_TIMEOUT', sent: true })
    const session = f.evaluations()[0]!.sessionId
    await vi.waitFor(() => expect(f.sent.at(-1)).toMatchObject({ method: 'Target.setAutoAttach', params: { autoAttach: false } }))
    expect(f.sent.find(command => command.method === 'Runtime.terminateExecution')).toEqual({ method: 'Runtime.terminateExecution', params: {}, sessionId: session })
  })

  it('sends nothing once the call is cancelled, and reports a worker that ends mid-script as unknown', async () => {
    const f = fixture()
    const { workers } = await f.list()
    const controller = new AbortController()
    controller.abort()
    await expect(f.evaluate(workers[0]!.handle, 'self.marker', 1_000, controller.signal)).rejects.toMatchObject({ reason: 'CANCELLED', sent: false })
    expect(f.evaluations()).toHaveLength(0)

    f.hold()
    const pending = f.evaluate(workers[0]!.handle, 'self.marker', 5_000).catch((reason: unknown) => reason)
    await vi.waitFor(() => expect(f.evaluations()).toHaveLength(1))
    f.endWorker('classic')
    expect(await pending).toMatchObject({ reason: 'WORKER_ENDED', sent: true })
    expect(f.sent.some(command => command.method === 'Runtime.terminateExecution')).toBe(false)
  })

  it('reports a renderer exit mid-script as the worker ending, and still turns auto-attach off', async () => {
    for (const exit of ['event', 'guard'] as const) {
      const f = fixture()
      const { workers } = await f.list()
      f.hold()
      const pending = f.evaluate(workers[0]!.handle, 'self.marker', 5_000).catch((reason: unknown) => reason)
      await vi.waitFor(() => expect(f.evaluations()).toHaveLength(1))
      // Either the renderer's exit event or the exit guard's rejection of the pending command comes first.
      if (exit === 'event') f.exitRenderer()
      else f.rejectHeld(new RendererExitedError(true))
      expect(await pending).toMatchObject({ reason: 'WORKER_ENDED', sent: true })
      expect(f.sent.at(-1)).toMatchObject({ method: 'Target.setAutoAttach', params: { autoAttach: false } })
    }
  })

  it('checks authority before dispatch and refuses pages that are not HTTP(S)', async () => {
    const f = fixture()
    const { workers } = await f.list()
    let calls = 0
    f.authority.assertCurrent.mockImplementation(() => { if (++calls === 2) throw new Error('Workspace ownership changed') })
    await expect(f.evaluate(workers[0]!.handle)).rejects.toThrow('Workspace ownership changed')
    expect(f.evaluations()).toHaveLength(0)

    const blank = fixture()
    blank.tab.url = 'about:blank'
    await expect(blank.list()).rejects.toThrow(/only on an HTTP\(S\) page/)
    expect(blank.sent).toHaveLength(0)

    const left = fixture()
    const listed = await left.list()
    left.leave()
    await expect(left.evaluate(listed.workers[0]!.handle)).rejects.toThrow(/handle expired/)
  })
})
