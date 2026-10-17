import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRightClickGate, rightClickSettlement, type RightClickScope } from './integration/right-click-diagnostics.js'

function setup(send = vi.fn(async (_method: string, ..._args: unknown[]): Promise<unknown> => ({ privateResult: 'secret' })), javascript = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve('secret'))) {
  const debuggerApi = Object.assign(new EventEmitter(), { sendCommand: send })
  const page = Object.assign(new EventEmitter(), { getURL: () => 'fixture', isDestroyed: () => false, debugger: debuggerApi,
    executeJavaScript: javascript, executeJavaScriptInIsolatedWorld: javascript, setEmbedder: vi.fn() })
  const embedder = page.setEmbedder
  const bounds = vi.fn((..._args: unknown[]): unknown => undefined)
  const visible = vi.fn((..._args: unknown[]): unknown => undefined)
  const view = Object.assign(new EventEmitter(), { webContents: page, setBounds: bounds, setVisible: visible })
  const owner = Object.assign(new EventEmitter(), { contentView: { children: [view] } })
  const display = new EventEmitter()
  installRightClickGate({ webContents: { getAllWebContents: () => [page] }, BrowserWindow: { getAllWindows: () => [owner] }, screen: display } as unknown as typeof import('electron'), { url: 'fixture', cleanup: false })
  return { page, view, owner, display, embedder, bounds, visible, debuggerApi, send, gate: (globalThis as RightClickScope).rightClickGate! }
}

afterEach(() => {
  (globalThis as RightClickScope).rightClickGate?.restore()
  delete (globalThis as RightClickScope).rightClickGate
})

describe('right-click diagnostics (observation only)', () => {
  it('distinguishes an invoked pending command from acknowledged held viewport work', async () => {
    let complete!: (value: unknown) => void
    const result = { privateResult: 'secret' }
    const native = new Promise(resolve => { complete = resolve })
    const { debuggerApi, send, gate } = setup(vi.fn(() => native))
    const pending = debuggerApi.sendCommand('Page.getLayoutMetrics', { privateParameter: 'secret' })
    expect(send).toHaveBeenCalledExactlyOnceWith('Page.getLayoutMetrics', { privateParameter: 'secret' })
    expect(gate.held).toBe(false)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke'])
    complete(result)
    await Promise.resolve()
    expect(gate.held).toBe(true)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke', 'resolve', 'gate-held'])
    expect(gate.events.map(({ command }) => command)).toEqual([1, 1, 1])
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    gate.release()
    expect(await pending).toBe(result)
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('preserves the exact rejection and records that the viewport was never held', async () => {
    const error = new Error('private error secret')
    const { debuggerApi, gate } = setup(vi.fn(async () => { throw error }))
    await expect(debuggerApi.sendCommand('Page.getLayoutMetrics')).rejects.toBe(error)
    expect(gate.held).toBe(false)
    expect(gate.events.map(({ stage }) => stage)).toEqual(['invoke', 'reject'])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('bounds records and maps unknown methods without retaining their names', async () => {
    const { debuggerApi, gate } = setup()
    for (let index = 0; index < 70; index++) await debuggerApi.sendCommand('private-secret-method')
    expect(gate.events).toHaveLength(128)
    expect(gate.dropped).toBe(12)
    expect(gate.events.every(event => event.method === 'other')).toBe(true)
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('restores the original command method and removes only its own listener', () => {
    const { debuggerApi, send, gate } = setup()
    const other = vi.fn()
    debuggerApi.on('message', other)
    debuggerApi.emit('message', {}, 'Page.frameResized', { secret: 'page data' })
    expect(gate.events).toMatchObject([{ stage: 'notification', method: 'Page.frameResized' }])
    gate.restore()
    expect(debuggerApi.sendCommand).toBe(send)
    expect(debuggerApi.listeners('message')).toEqual([other])
  })

  it('preserves original JS promises and observes withheld settlement without payloads', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise(done => { resolve = done })
    const original = vi.fn(() => pending)
    const { page, gate } = setup(undefined, original)
    expect(page.executeJavaScript('private script secret')).toBe(pending)
    expect(page.executeJavaScriptInIsolatedWorld(1013, [{ code: 'secret' }])).toBe(pending)
    expect(gate.events.map(event => [event.stage, event.method])).toEqual([
      ['invoke', 'executeJavaScript'], ['invoke', 'isolated.agent-pointer']
    ])
    resolve({ secret: 'result' })
    await pending
    expect(gate.events.map(event => event.stage)).toEqual(['invoke', 'invoke', 'resolve', 'resolve'])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
    gate.restore()
    expect(page.executeJavaScript).toBe(original)
    expect(page.executeJavaScriptInIsolatedWorld).toBe(original)
  })

  it('preserves synchronous JS throws and asynchronous rejections', async () => {
    const error = new Error('private secret')
    const original = vi.fn((..._args: unknown[]): Promise<unknown> => { throw error })
    const { page, gate } = setup(undefined, original)
    expect(() => page.executeJavaScript('secret')).toThrow(error)
    original.mockImplementation(() => Promise.reject(error))
    await expect(page.executeJavaScriptInIsolatedWorld(1010, [])).rejects.toBe(error)
    expect(gate.events.map(event => [event.stage, event.method])).toEqual([
      ['invoke', 'executeJavaScript'], ['throw', 'executeJavaScript'],
      ['invoke', 'isolated.visibility-probe'], ['reject', 'isolated.visibility-probe']
    ])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
  })

  it('observes embedder return and native lifecycle without recording parameters', () => {
    const { page, gate } = setup()
    page.setEmbedder({ secret: 'embedder' })
    page.emit('did-stop-loading', { secret: 'payload' })
    expect(gate.events.map(event => [event.stage, event.method])).toEqual([
      ['invoke', 'setEmbedder'], ['return', 'setEmbedder'], ['notification', 'page.did-stop-loading']
    ])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
    gate.restore()
    page.emit('did-stop-loading')
    expect(gate.events).toHaveLength(3)
  })

  it('preserves native layout and embedder throws and restores every observed boundary', () => {
    const { page, view, owner, display, embedder, bounds, visible, gate } = setup()
    const error = new Error('native secret')
    embedder.mockImplementation(() => { throw error })
    bounds.mockReturnValue('return secret')
    visible.mockImplementation(() => { throw error })
    expect(() => page.setEmbedder({ secret: true })).toThrow(error)
    expect(view.setBounds({ secret: true })).toBe('return secret')
    expect(() => view.setVisible(true)).toThrow(error)
    view.emit('bounds-changed', { secret: true })
    owner.emit('move', { secret: true })
    display.emit('display-metrics-changed', { secret: true })
    expect(gate.events.map(event => event.stage)).toEqual(['invoke', 'throw', 'invoke', 'return', 'invoke', 'throw', 'notification', 'notification', 'notification'])
    expect(JSON.stringify(gate.events)).not.toContain('secret')
    gate.restore()
    expect(page.setEmbedder).toBe(embedder)
    expect(view.setBounds).toBe(bounds)
    expect(view.setVisible).toBe(visible)
    expect(view.listenerCount('bounds-changed')).toBe(0)
    expect(owner.listenerCount('move')).toBe(0)
    expect(display.listenerCount('display-metrics-changed')).toBe(0)
  })

  it('rolls back earlier hooks when a later native setter rejects installation', () => {
    const error = new Error('setter failure')
    const javascript = () => Promise.resolve('private')
    const isolated = () => Promise.resolve('private')
    const sendCommand = vi.fn()
    const page = Object.assign(new EventEmitter(), { getURL: () => 'fixture', isDestroyed: () => false,
      executeJavaScript: javascript, executeJavaScriptInIsolatedWorld: isolated,
      debugger: Object.assign(new EventEmitter(), { sendCommand }) })
    Object.defineProperty(page, 'executeJavaScriptInIsolatedWorld', { configurable: true, get: () => isolated, set: () => { throw error } })
    expect(() => installRightClickGate({ webContents: { getAllWebContents: () => [page] }, BrowserWindow: { getAllWindows: () => [] }, screen: new EventEmitter() } as unknown as typeof import('electron'), { url: 'fixture', cleanup: false })).toThrow(error)
    expect(page.executeJavaScript).toBe(javascript)
    expect(page.debugger.sendCommand).toBe(sendCommand)
    expect(page.eventNames()).toEqual([])
    expect((globalThis as RightClickScope).rightClickGate).toBeUndefined()
  })

  it('rolls back already registered listeners when later listener installation throws', () => {
    const error = new Error('listener failure')
    const javascript = () => Promise.resolve('private')
    const sendCommand = vi.fn()
    const page = Object.assign(new EventEmitter(), { getURL: () => 'fixture', isDestroyed: () => false,
      executeJavaScript: javascript, executeJavaScriptInIsolatedWorld: javascript,
      debugger: Object.assign(new EventEmitter(), { sendCommand }) })
    const on = page.on
    page.on = function (name, listener) { const result = on.call(this, name, listener); if (name === 'zoom-changed') throw error; return result }
    expect(() => installRightClickGate({ webContents: { getAllWebContents: () => [page] }, BrowserWindow: { getAllWindows: () => [] }, screen: new EventEmitter() } as unknown as typeof import('electron'), { url: 'fixture', cleanup: false })).toThrow(error)
    expect(page.executeJavaScript).toBe(javascript)
    expect(page.executeJavaScriptInIsolatedWorld).toBe(javascript)
    expect(page.debugger.sendCommand).toBe(sendCommand)
    expect(page.eventNames()).toEqual([])
  })

  it('attempts every restoration after one setter throws and permits a retry', () => {
    const { page, view, bounds, debuggerApi, send, gate } = setup()
    const error = new Error('restoration failure')
    const isolated = page.executeJavaScriptInIsolatedWorld
    Object.defineProperty(page, 'executeJavaScriptInIsolatedWorld', { configurable: true, get: () => isolated, set: () => { throw error } })
    try {
      expect(() => gate.restore()).toThrow(error)
      expect(debuggerApi.sendCommand).toBe(send)
      expect(debuggerApi.listenerCount('message')).toBe(0)
      expect(view.setBounds).toBe(bounds)
      expect(page.eventNames()).toEqual([])
    } finally {
      Object.defineProperty(page, 'executeJavaScriptInIsolatedWorld', { configurable: true, writable: true, value: isolated })
    }
    expect(() => gate.restore()).not.toThrow()
    expect(page.executeJavaScriptInIsolatedWorld).not.toBe(isolated)
  })

  it('classifies only exact allowlisted preflight messages', () => {
    expect(rightClickSettlement({ isError: true, content: [{ type: 'text', text: 'Right-click requires a page locked in the trusted UI' }] }))
      .toMatchObject({ preflight: 'lock-required' })
    expect(rightClickSettlement({ isError: true, content: [{ type: 'text', text: 'Right-click requires a page locked in the trusted UI secret suffix' }] }))
      .not.toHaveProperty('preflight')
  })

  it('retains fixed outcome categories without result text or arbitrary structured data', () => {
    const result = rightClickSettlement({ isError: true, content: [{ type: 'text', text: 'private secret' }],
      structuredContent: { status: 'OUTCOME_UNKNOWN', reason: 'CONTEXT_OR_INPUT_UNCERTAIN', secret: 'private' } })
    expect(result).toMatchObject({ state: 'fulfilled', isError: true, status: 'OUTCOME_UNKNOWN', reason: 'CONTEXT_OR_INPUT_UNCERTAIN' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(rightClickSettlement({ isError: true, content: [], structuredContent: { status: 'NOT_DISPATCHED' } }))
      .toMatchObject({ state: 'fulfilled', isError: true, status: 'NOT_DISPATCHED' })
    expect(rightClickSettlement({ content: [], structuredContent: { status: 'private', reason: 'private' } }))
      .toEqual({ at: expect.any(Number), state: 'fulfilled', isError: false })
  })
})
