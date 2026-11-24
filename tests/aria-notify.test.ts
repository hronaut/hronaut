import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { AriaNotifyRecorder, ariaNotifyAnnouncement, ariaNotifyCallSite, type AriaNotifyTab } from '../src/main/browser/aria-notify/aria-notify-recorder.js'

const URL_ = 'https://app.test/checkout?token=secret'

function fixture() {
  const contents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const debuggerEvents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: Array<[string, Record<string, unknown> | undefined]> = []
  let url = URL_
  let attached = true
  debuggerEvents.isAttached = () => attached
  debuggerEvents.sendCommand = async (method: string, params?: Record<string, unknown>) => {
    sent.push([method, params])
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-1' }
    if (method === 'Runtime.evaluate') return { result: { value: { supported: true, installed: true } } }
    return {}
  }
  Object.assign(contents, { debugger: debuggerEvents, isDestroyed: () => false, isCrashed: () => false, getURL: () => url })
  const tab: AriaNotifyTab = { id: 'tab-1', webContents: contents as unknown as WebContents }
  let current = true
  const recorder = new AriaNotifyRecorder<AriaNotifyTab>({
    isCurrent: () => current,
    isDevToolsOpening: () => false,
    withDebugger: (_tab, operation) => operation()
  })
  const authority = { assertCurrent: vi.fn() }
  const binding = () => (sent.find(([method]) => method === 'Runtime.addBinding')![1]!.name as string)
  return {
    tab, recorder, authority, sent,
    methods: () => sent.map(([method]) => method),
    start: (durationMs?: number) => recorder.manage(tab, 'start', { durationMs }, authority),
    get: () => recorder.manage(tab, 'get', {}, authority),
    announce: (payload: Record<string, unknown>, name = binding()) =>
      debuggerEvents.emit('message', {}, 'Runtime.bindingCalled', { name, payload: JSON.stringify(payload) }),
    navigate: (to: string, isMainFrame = true) => { url = to; contents.emit('did-start-navigation', {}, to, false, isMainFrame) },
    detach: () => { attached = false; debuggerEvents.emit('detach') },
    leave: () => { current = false },
    listeners: () => contents.eventNames().reduce((total, name) => total + contents.listenerCount(name), 0)
      + debuggerEvents.eventNames().reduce((total, name) => total + debuggerEvents.listenerCount(name), 0)
  }
}

afterEach(() => { vi.useRealTimers() })

describe('ariaNotify call sites and announcements', () => {
  it('reads the caller frame without query, fragment or credentials', () => {
    expect(ariaNotifyCallSite('    at announceTotal (https://user:pw@app.test/assets/main.js?v=2#x:10:5)')).toEqual({
      functionName: 'announceTotal', scriptUrl: 'https://app.test/assets/main.js', line: 10, column: 5
    })
    expect(ariaNotifyCallSite('    at https://app.test/main.js:3:7')).toEqual({ functionName: '(anonymous)', scriptUrl: 'https://app.test/main.js', line: 3, column: 7 })
    expect(ariaNotifyCallSite('    at async save (<anonymous>:1:20)')).toEqual({ functionName: 'save', line: 1, column: 20 })
    expect(ariaNotifyCallSite('')).toBeUndefined()
  })

  it('bounds text and keeps only allowlisted fields', () => {
    const long = ariaNotifyAnnouncement(JSON.stringify({ text: 'x'.repeat(1500), priority: 'urgent', localName: 'DIV<', role: 'status', url: URL_ }), 12.4)!
    expect(long).toMatchObject({ atMs: 12, truncated: true, target: { kind: 'document' }, pageUrl: 'https://app.test/checkout' })
    expect(long.text).toHaveLength(1000)
    expect(long).not.toHaveProperty('priority')
    expect(ariaNotifyAnnouncement(JSON.stringify({ text: 'Saved', priority: 'high', localName: 'div', role: 'status', url: URL_ }), 0)).toMatchObject({
      priority: 'high', target: { kind: 'element', localName: 'div', role: 'status' }
    })
    expect(ariaNotifyAnnouncement('not json', 0)).toBeUndefined()
    expect(ariaNotifyAnnouncement(JSON.stringify({ text: 3 }), 0)).toBeUndefined()
  })
})

describe('ariaNotify recorder', () => {
  it('adds a random binding and a new-document script, wraps the current document and records announcements', async () => {
    const f = fixture()
    const started = await f.start(10_000)
    expect(f.methods()).toEqual(['Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate'])
    expect(f.sent[0]![1]!.name).toMatch(/^__hronautAriaNotify[0-9a-f]{24}$/)
    expect(String(f.sent[1]![1]!.source)).toContain(f.sent[0]![1]!.name as string)
    expect(started).toMatchObject({ status: 'recording', supported: true, recording: { origin: 'https://app.test' }, announcements: [] })
    f.announce({ text: 'Cart updated', url: URL_ })
    f.announce({ text: 'forged' }, '__someOtherBinding')
    const report = await f.get()
    expect(report.announcements.map(item => item.text)).toEqual(['Cart updated'])
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('keeps 100 announcements and counts the rest', async () => {
    const f = fixture()
    await f.start()
    for (let index = 0; index < 105; index++) f.announce({ text: `n${index}`, url: URL_ })
    const report = await f.get()
    expect(report.announcements).toHaveLength(100)
    expect(report.dropped).toBe(5)
  })

  it('ends on leaving the origin, removes what it added and keeps what it recorded until clear', async () => {
    const f = fixture()
    await f.start()
    f.announce({ text: 'one', url: URL_ })
    f.navigate('https://app.test/next', false)
    f.navigate('https://app.test/next')
    expect((await f.get()).status).toBe('recording')
    f.navigate('https://other.test/')
    const ended = await f.get()
    expect(ended).toMatchObject({ status: 'stopped', ended: { reason: 'origin-left' }, announcements: [{ text: 'one' }] })
    expect(f.methods().slice(-3)).toEqual(['Runtime.removeBinding', 'Page.removeScriptToEvaluateOnNewDocument', 'Runtime.evaluate'])
    expect(f.listeners()).toBe(0)
    expect(await f.recorder.manage(f.tab, 'clear', {}, f.authority)).toMatchObject({ status: 'idle', announcements: [] })
  })

  it('ends when the authority changes, on expiry, on a detach and on stop, and refuses a second start', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.start()
    await expect(f.start()).rejects.toThrow('already being recorded')
    f.authority.assertCurrent.mockImplementation(() => { throw new Error('paused') })
    vi.advanceTimersByTime(600)
    expect((await f.get()).ended?.reason).toBe('authority-changed')
    f.authority.assertCurrent.mockReset()

    await f.start(5_000)
    vi.advanceTimersByTime(5_000)
    expect((await f.get()).ended?.reason).toBe('expired')

    await f.start()
    f.detach()
    expect((await f.get()).ended?.reason).toBe('debugger-detached')

    await expect(f.recorder.manage(f.tab, 'get', { durationMs: 5_000 }, f.authority)).rejects.toThrow('only for action start')
    await expect(f.start(1)).rejects.toThrow('durationMs must be')
  })

  it('removes everything when the start loses its authority', async () => {
    const f = fixture()
    f.authority.assertCurrent.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('lost') })
    await expect(f.start()).rejects.toThrow('lost')
    expect(f.methods()).toContain('Runtime.removeBinding')
    expect((await f.get()).status).toBe('idle')
    expect(f.listeners()).toBe(0)
  })
})
