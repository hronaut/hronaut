import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPwaLifecycle } from '../src/main/browser/pwa-lifecycle.js'
import { PWA_LIFECYCLE_LIMITS, pwaLifecyclePageScript, type PwaLifecyclePageSnapshot } from '../src/shared/pwa-lifecycle.js'

const managers: Array<{ dispose(): void }> = []
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); vi.useRealTimers() })
const raw = (): PwaLifecyclePageSnapshot => ({ active: true, reason: null, startedAt: 1, stoppedAt: null, events: [], truncated: false, missingHistory: true })
function fixture() {
  vi.useFakeTimers()
  const emitter = new EventEmitter()
  const debuggerEmitter = new EventEmitter()
  const execute = vi.fn(async () => raw())
  const tab = { id: 'tab', sleeping: false, pageLifecycleState: 'active', mcpGroupId: 'workspace', url: 'https://example.test/', navigationGeneration: 0, observationGeneration: 0,
    webContents: Object.assign(emitter, { debugger: debuggerEmitter, executeJavaScriptInIsolatedWorld: execute, isDestroyed: () => false }) as unknown as WebContents }
  const changed = vi.fn()
  const recorder = new BrowserPwaLifecycle<typeof tab>({ isCurrent: () => true, changed })
  managers.push(recorder)
  return { tab, recorder, execute, emitter, debuggerEmitter, changed }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('retained service-worker captures', () => {
  it.each(['navigation', 'destroyed', 'render-process-gone', 'detach'] as const)('retains bounded evidence after %s and removes native listeners', async reason => {
    const f = fixture()
    f.execute.mockResolvedValue({ ...raw(), events: [{ kind: 'initial', observedAt: 2, worker: { id: 1, state: 'activated', scriptUrl: 'https://user:password@example.test/sw.js?token=secret' }, controller: null }] })
    const initial = await f.recorder.manage(f.tab, { action: 'start' })
    if (reason === 'navigation') f.emitter.emit('did-start-navigation', {}, 'https://example.test/next', false, true)
    else if (reason === 'detach') f.debuggerEmitter.emit('detach')
    else f.emitter.emit(reason)
    const retained = await f.recorder.manage({ ...f.tab, id: 'another-live-tab' }, { action: 'get', captureId: initial!.captureId })
    expect(retained).toMatchObject({ active: false, interrupted: true, missingHistory: true })
    expect(retained!.events).toHaveLength(1)
    expect(JSON.stringify(retained)).not.toMatch(/password|secret/)
    expect(f.emitter.listenerCount('destroyed')).toBe(0)
    expect(f.debuggerEmitter.listenerCount('detach')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects cross-workspace retained reads and does not clear the original capture', async () => {
    const f = fixture()
    const initial = await f.recorder.manage(f.tab, { action: 'start' })
    await expect(f.recorder.manage({ ...f.tab, mcpGroupId: 'other' }, { action: 'clear', captureId: initial!.captureId })).rejects.toThrow('different workspace')
    expect((await f.recorder.manage(f.tab, { action: 'get' }))?.active).toBe(true)
  })

  it.each(['get', 'stop', 'clear'] as const)('authorizes stored origin before retained %s', async action => {
    const f = fixture()
    const initial = await f.recorder.manage(f.tab, { action: 'start' })
    const reader = { ...f.tab, id: 'reader', url: 'https://reader.test/' }
    const denied = vi.fn((origin: string) => {
      if (origin !== 'https://reader.test') throw Error('origin denied')
    })
    await expect(f.recorder.manage(reader, { action, captureId: initial!.captureId }, denied)).rejects.toThrow('origin denied')
    expect(denied).toHaveBeenCalledWith('https://example.test')
    expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ active: true })
    const allowed = vi.fn()
    const result = await f.recorder.manage(reader, { action, captureId: initial!.captureId }, allowed)
    expect(allowed).toHaveBeenCalledWith('https://example.test')
    if (action === 'clear') expect(result).toBeNull()
    else expect(result).toMatchObject({ captureId: initial!.captureId, active: action === 'get' })
  })

  it('rejects the initial result if navigation interrupts the pending read', async () => {
    const f = fixture()
    const held = deferred<PwaLifecyclePageSnapshot>()
    f.execute.mockReturnValueOnce(held.promise)
    const starting = f.recorder.manage(f.tab, { action: 'start' })
    f.tab.navigationGeneration++
    f.emitter.emit('did-start-navigation', {}, 'https://reader.test/', false, true)
    held.resolve(raw())
    await expect(starting).rejects.toThrow('Capture context changed')
    expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ active: false, events: [] })
  })

  it('cancels a pending initial read on authority loss and rejects its late evidence', async () => {
    const f = fixture()
    const held = deferred<PwaLifecyclePageSnapshot>()
    f.execute.mockReturnValueOnce(held.promise)
    let authorized = true
    const starting = f.recorder.manage(f.tab, { action: 'start' }, () => { if (!authorized) throw Error('revoked') })
    authorized = false
    await vi.advanceTimersByTimeAsync(250)
    expect(f.recorder.active(f.tab.id)).toBe(false)
    held.resolve({ ...raw(), events: [{ kind: 'late', observedAt: 4, worker: null, controller: null }] })
    await expect(starting).rejects.toThrow('revoked')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let a stopped start overwrite a newer capture', async () => {
    const f = fixture()
    const held = deferred<PwaLifecyclePageSnapshot>()
    f.execute.mockReturnValueOnce(held.promise)
    const first = f.recorder.manage(f.tab, { action: 'start' })
    await f.recorder.manage(f.tab, { action: 'stop' })
    const next = await f.recorder.manage(f.tab, { action: 'start' })
    held.resolve(raw())
    expect(await first).toMatchObject({ active: false })
    expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ captureId: next!.captureId, active: true })
  })

  it('does not overlap page reads and still checks authority while a read hangs', async () => {
    const f = fixture()
    let authorized = true
    await f.recorder.manage(f.tab, { action: 'start' }, () => { if (!authorized) throw Error('revoked') })
    const held = deferred<PwaLifecyclePageSnapshot>()
    f.execute.mockReturnValueOnce(held.promise)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.execute).toHaveBeenCalledTimes(2)
    authorized = false
    await vi.advanceTimersByTimeAsync(250)
    expect(f.recorder.active(f.tab.id)).toBe(false)
    held.resolve(raw())
    await Promise.resolve()
    expect((await f.recorder.manage(f.tab, { action: 'get' }))?.events).toEqual([])
  })

  it('bounds initial waits and ends capture even when renderer timers cannot run', async () => {
    const f = fixture()
    const held = deferred<PwaLifecyclePageSnapshot>()
    f.execute.mockReturnValueOnce(held.promise)
    const pending = f.recorder.manage(f.tab, { action: 'start' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toMatchObject({ active: false, reason: 'initial-read-unavailable' })
    held.resolve(raw())
    await f.recorder.manage(f.tab, { action: 'start' })
    await vi.advanceTimersByTimeAsync(PWA_LIFECYCLE_LIMITS.durationMs)
    expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ active: false, reason: 'duration-limit' })
  })

  it('bounds retained captures without silently interrupting other active tabs', async () => {
    const f = fixture()
    for (let id = 0; id < PWA_LIFECYCLE_LIMITS.captures; id++) await f.recorder.manage({ ...f.tab, id: String(id) }, { action: 'start' })
    await expect(f.recorder.manage(f.tab, { action: 'start' })).rejects.toThrow('Stop a service-worker capture')
    await f.recorder.manage({ ...f.tab, id: '0' }, { action: 'stop' })
    expect(await f.recorder.manage(f.tab, { action: 'start' })).toMatchObject({ active: true })
  })
})

describe('isolated service-worker observer', () => {
  it('caps events, removes timers/listeners, and never calls worker mutation APIs', async () => {
    vi.useFakeTimers()
    const container = new EventTarget() as EventTarget & { controller: null; getRegistrations(): Promise<unknown[]> }
    container.controller = null
    container.getRegistrations = async () => []
    const context = { navigator: { serviceWorker: container }, setTimeout, clearTimeout, setInterval, clearInterval }
    await runInNewContext(pwaLifecyclePageScript('start', 'capture'), context)
    for (let i = 0; i < 200; i++) container.dispatchEvent(new Event('controllerchange'))
    const result = runInNewContext(pwaLifecyclePageScript('get', 'capture'), context)
    expect(result).toMatchObject({ active: false, reason: 'event-limit', truncated: true, missingHistory: true, listenerCount: 0 })
    expect(result.events).toHaveLength(PWA_LIFECYCLE_LIMITS.events)
    expect(vi.getTimerCount()).toBe(0)
    expect(runInNewContext(pwaLifecyclePageScript('stop', 'stale-capture'), context)).toBeNull()
  })
})

class SyntheticWorker extends EventTarget {
  state = 'activated'
  scriptURL = 'https://example.test/sw.js'
  postMessage = vi.fn(() => { throw Error('Forbidden worker message') })
}
class SyntheticRegistration extends EventTarget {
  constructor(readonly scope: string) { super() }
  installing = new SyntheticWorker()
  waiting = new SyntheticWorker()
  active = new SyntheticWorker()
  update = vi.fn(() => { throw Error('Forbidden update') })
  unregister = vi.fn(() => { throw Error('Forbidden unregister') })
}
function pageFixture(registrations: SyntheticRegistration[]) {
  vi.useFakeTimers()
  const container = Object.assign(new EventTarget(), { controller: null, getRegistrations: vi.fn(async () => registrations) })
  const context = { navigator: { serviceWorker: container }, setTimeout, clearTimeout, setInterval, clearInterval }
  return { container, context, execute: (action: 'start' | 'get' | 'stop', id = 'capture') => runInNewContext(pwaLifecyclePageScript(action, id), context) }
}
it('reports late discovery and disappearance without inventing missed lifecycle transitions', async () => {
  const f = pageFixture([])
  await f.execute('start')
  const registration = new SyntheticRegistration('https://example.test/later/')
  f.container.getRegistrations.mockResolvedValue([registration])
  await vi.advanceTimersByTimeAsync(PWA_LIFECYCLE_LIMITS.discoveryMs)
  f.container.getRegistrations.mockResolvedValue([])
  await vi.advanceTimersByTimeAsync(PWA_LIFECYCLE_LIMITS.discoveryMs)
  expect(f.execute('get').events.map((event: { kind: string }) => event.kind)).toEqual(['initial', 'registration-discovered', 'registration-removed'])
  expect(registration.update).not.toHaveBeenCalled()
  expect(registration.unregister).not.toHaveBeenCalled()
  expect(registration.active.postMessage).not.toHaveBeenCalled()
  f.execute('stop')
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['registration', 'worker'] as const)('removes observers when the %s limit is reached', async limit => {
  const registrations = Array.from({ length: limit === 'registration' ? 21 : 20 }, (_, id) => new SyntheticRegistration(`https://example.test/${id}/`))
  const f = pageFixture(registrations)
  await f.execute('start')
  if (limit === 'worker') {
    for (let i = 0; i < 45; i++) {
      registrations[0]!.installing = new SyntheticWorker()
      registrations[0]!.dispatchEvent(new Event('updatefound'))
    }
  }
  expect(f.execute('get')).toMatchObject({ active: false, reason: `${limit}-limit`, truncated: true, listenerCount: 0 })
  expect(vi.getTimerCount()).toBe(0)
})
it('stops immediately despite pending discovery and ignores late results and stale stop IDs', async () => {
  const f = pageFixture([])
  const held = deferred<SyntheticRegistration[]>()
  f.container.getRegistrations.mockReturnValueOnce(held.promise)
  const starting = f.execute('start')
  const stopped = f.execute('stop')
  expect(stopped.active).toBe(false)
  expect(f.execute('get')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  held.resolve([new SyntheticRegistration('https://example.test/late/')])
  expect(await starting).toEqual(stopped)
  await f.execute('start', 'new-capture')
  expect(f.execute('stop')).toBeNull()
  expect(f.execute('get', 'new-capture').active).toBe(true)
  f.execute('stop', 'new-capture')
})

it.each(['sleep', 'freeze'] as const)('does not wake or keep a page active through %s', async boundary => {
  const f = fixture()
  if (boundary === 'sleep') f.tab.sleeping = true
  else f.tab.pageLifecycleState = 'frozen'
  await expect(f.recorder.manage(f.tab, { action: 'start' })).rejects.toThrow('awake and unfrozen')
  expect(f.execute).not.toHaveBeenCalled()
  f.tab.sleeping = false; f.tab.pageLifecycleState = 'active'
  await f.recorder.manage(f.tab, { action: 'start' })
  if (boundary === 'sleep') f.tab.sleeping = true
  else f.tab.pageLifecycleState = 'frozen'
  await vi.advanceTimersByTimeAsync(250)
  expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ active: false, interrupted: true })
})

it('omits overlong URLs before redaction rather than cutting through credentials', async () => {
  const registration = new SyntheticRegistration('https://example.test/' + 'a'.repeat(2100))
  registration.active.scriptURL = 'https://' + 'u'.repeat(2100) + ':synthetic-password@example.test/sw.js'
  const f = pageFixture([registration])
  const result = await f.execute('start')
  expect(result.truncated).toBe(true)
  expect(result.events[1].scope).toBe('')
  expect(result.events[1].active.scriptUrl).toBe('')
  expect(JSON.stringify(result)).not.toContain('synthetic-password')
  f.execute('stop')
})

it('retains interruption evidence when native cleanup throws synchronously', async () => {
  const f = fixture()
  await f.recorder.manage(f.tab, { action: 'start' })
  f.execute.mockImplementationOnce(() => { throw Error('Execution context gone') })
  expect(() => f.emitter.emit('render-process-gone')).not.toThrow()
  expect(await f.recorder.manage(f.tab, { action: 'get' })).toMatchObject({ active: false, interrupted: true, reason: 'renderer-unavailable' })
  expect(vi.getTimerCount()).toBe(0)
})
