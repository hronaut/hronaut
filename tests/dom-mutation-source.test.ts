import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { DomMutationSourceCaptures, mutationSourceFrames } from '../src/main/browser/dom-mutation-source/dom-mutation-source.js'

const ORIGIN = 'https://app.test'

function fixture(options: { nodeIds?: readonly number[]; localName?: string; url?: string; keepDomEnabled?: boolean } = {}) {
  const debuggerEvents = new EventEmitter()
  let devToolsOpened = false
  let devToolsOpening = false
  let removed = false
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelectorAll') return { nodeIds: options.nodeIds ?? [7] }
    if (method === 'DOM.describeNode') {
      if (removed) throw new Error('Could not find node with given id')
      return { node: { nodeType: 1, localName: options.localName ?? 'button' } }
    }
    return params ? {} : {}
  })
  const page = Object.assign(new EventEmitter(), {
    id: 3,
    debugger: Object.assign(debuggerEvents, { sendCommand, isAttached: () => true }),
    isDestroyed: () => false,
    isDevToolsOpened: () => devToolsOpened,
    getURL: () => options.url ?? `${ORIGIN}/orders?token=private-token`
  }) as unknown as WebContents & EventEmitter
  const tab = { id: 'tab-1', url: `${ORIGIN}/orders?token=private-token`, navigationGeneration: 0, observationGeneration: 0, webContents: page }
  const conflict = vi.fn((): string | undefined => undefined)
  const captures = new DomMutationSourceCaptures<typeof tab>({
    isCurrent: () => true,
    withDebugger: (_tab, operation) => operation(),
    inDebuggerQueue: (_tab, operation) => operation(),
    conflict,
    keepDomEnabled: () => options.keepDomEnabled ?? false,
    isDevToolsOpening: () => devToolsOpening
  })
  const authority = { assertCurrent: vi.fn() }
  const methods = () => sendCommand.mock.calls.map(([method]) => method)
  const emit = (method: string, params: unknown) => debuggerEvents.emit('message', {}, method, params)
  const pause = (reason: string, extra: Record<string, unknown> = {}) => emit('Debugger.paused', {
    reason,
    callFrames: [{ functionName: 'disableSave', location: { scriptId: '11', lineNumber: 4, columnNumber: 2 } }],
    ...extra
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return {
    captures, tab, page, authority, conflict, sendCommand, methods, emit, pause, settle,
    openDevTools: () => { devToolsOpened = true },
    startOpeningDevTools: () => { devToolsOpening = true },
    removeTarget: () => { removed = true },
    arm: (kind: 'attribute-modified' | 'subtree-modified' | 'node-removed' = 'attribute-modified', selector = '#save', durationMs?: number) =>
      captures.manage(tab, 'arm', { selector, kind, durationMs, authority }),
    listeners: () => (page.debugger as unknown as EventEmitter).listenerCount('message') + page.listenerCount('did-start-navigation')
  }
}

afterEach(() => { vi.useRealTimers() })

it('arms a DOM breakpoint on exactly one element, checking the arming authority for the page origin', async () => {
  const f = fixture()
  const report = await f.arm('subtree-modified', '#panel', 5_000)
  expect(report).toMatchObject({ status: 'armed', url: `${ORIGIN}/orders?token=%5BREDACTED%5D`, armed: { selector: '#panel', kind: 'subtree-modified', remainingMs: expect.any(Number) } })
  expect(f.methods()).toEqual([
    'DOM.enable', 'DOM.getDocument', 'DOM.querySelectorAll', 'DOM.describeNode',
    'Debugger.enable', 'Runtime.setAsyncCallStackDepth', 'Debugger.setPauseOnExceptions', 'Debugger.setSkipAllPauses', 'Debugger.setBreakpointsActive', 'DOMDebugger.setDOMBreakpoint'
  ])
  expect(f.sendCommand).toHaveBeenCalledWith('DOMDebugger.setDOMBreakpoint', { nodeId: 7, type: 'subtree-modified' })
  expect(f.authority.assertCurrent).toHaveBeenCalledWith(ORIGIN)
  expect(f.captures.active(f.tab)).toBe(true)
})

it('refuses an ambiguous, missing or root element, a page that is not HTTP(S) and a conflicting debugger use, leaving nothing behind', async () => {
  for (const [options, message] of [
    [{ nodeIds: [7, 8] }, 'more than one element'],
    [{ nodeIds: [] }, 'No element'],
    [{ localName: 'body' }, 'not the html, head or body'],
    [{ url: 'file:///tmp/page.html' }, 'HTTP(S) page']
  ] as const) {
    const f = fixture(options)
    await expect(f.arm()).rejects.toThrow(message)
    expect(f.captures.active(f.tab)).toBe(false)
    expect(f.methods()).not.toContain('DOMDebugger.setDOMBreakpoint')
    expect(f.listeners()).toBe(0)
  }
  const f = fixture()
  f.conflict.mockReturnValue('Stop code coverage before capturing a DOM mutation source')
  await expect(f.arm()).rejects.toThrow('Stop code coverage')
  expect(f.sendCommand).not.toHaveBeenCalled()
  const refused = fixture()
  refused.authority.assertCurrent.mockImplementation(() => { throw new Error('Workspace ownership changed') })
  await expect(refused.arm()).rejects.toThrow('Workspace ownership changed')
  expect(refused.listeners()).toBe(0)
})

it('cleans up when the breakpoint cannot be set', async () => {
  const f = fixture()
  f.sendCommand.mockImplementation(async (method: string) => {
    if (method === 'DOMDebugger.setDOMBreakpoint') throw new Error('Not supported')
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelectorAll') return { nodeIds: [7] }
    if (method === 'DOM.describeNode') return { node: { nodeType: 1, localName: 'button' } }
    return {}
  })
  await expect(f.arm()).rejects.toThrow('Not supported')
  expect(f.methods().slice(-4)).toEqual(['DOMDebugger.removeDOMBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth', 'DOM.disable'])
  expect(f.listeners()).toBe(0)
  expect(f.captures.active(f.tab)).toBe(false)
})

it('resumes the page before anything else, keeps the first matching change and removes the breakpoint', async () => {
  const f = fixture()
  await f.arm()
  f.emit('Debugger.scriptParsed', { scriptId: '11', url: `${ORIGIN}/app.js?token=private-token#frag` })
  f.emit('Debugger.scriptParsed', { scriptId: '12', url: 'data:text/javascript,private-inline' })
  f.sendCommand.mockClear()
  f.pause('DOM', {
    data: { type: 'attribute-modified', nodeId: 7 },
    callFrames: [
      { functionName: 'disableSave', location: { scriptId: '11', lineNumber: 4, columnNumber: 2 } },
      { functionName: '', location: { scriptId: '12', lineNumber: 0, columnNumber: 0 } }
    ],
    asyncStackTrace: { description: 'setTimeout', callFrames: [{ functionName: 'later', scriptId: '11', lineNumber: 9, columnNumber: 1 }] }
  })
  expect(f.methods()[0]).toBe('Debugger.resume')
  await f.settle()
  const report = await f.captures.manage(f.tab, 'get')
  expect(report).toMatchObject({
    status: 'captured',
    ended: { reason: 'captured', selector: '#save', kind: 'attribute-modified' },
    capture: {
      kind: 'attribute-modified', change: 'attribute', framesTruncated: false,
      frames: [
        { functionName: 'disableSave', url: `${ORIGIN}/app.js?token=%5BREDACTED%5D`, lineNumber: 5, columnNumber: 3 },
        { functionName: '(anonymous)', lineNumber: 1, columnNumber: 1 },
        { functionName: 'later', url: `${ORIGIN}/app.js?token=%5BREDACTED%5D`, lineNumber: 10, columnNumber: 2, asyncBoundary: 'setTimeout' }
      ]
    }
  })
  expect(report.capture!.frames[1]).not.toHaveProperty('url')
  expect(JSON.stringify(report)).not.toMatch(/private-token|private-inline|frag/)
  expect(f.methods()).toEqual(['Debugger.resume', 'DOMDebugger.removeDOMBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth', 'DOM.disable'])
  expect(f.sendCommand).toHaveBeenCalledWith('Runtime.setAsyncCallStackDepth', { maxDepth: 8 })
  expect(f.listeners()).toBe(0)
  expect(f.captures.active(f.tab)).toBe(false)
})

it('resumes other pauses while armed without capturing them, and ignores changes after the first', async () => {
  const f = fixture()
  await f.arm('subtree-modified', '#panel')
  f.sendCommand.mockClear()
  f.pause('other')
  expect(f.methods()).toEqual(['Debugger.resume'])
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'armed' })
  f.pause('DOM', { data: { type: 'subtree-modified', insertion: true } })
  // A second change before the cleanup ran is resumed and dropped.
  f.pause('DOM', { data: { type: 'subtree-modified', insertion: false }, callFrames: [{ functionName: 'second', location: {} }] })
  await f.settle()
  const report = await f.captures.manage(f.tab, 'get')
  expect(report.capture).toMatchObject({ change: 'child-inserted', frames: [{ functionName: 'disableSave' }] })
  expect(f.methods().filter(method => method === 'Debugger.resume')).toHaveLength(3)
})

it('drops a change whose arming authority no longer holds', async () => {
  const f = fixture()
  await f.arm()
  f.authority.assertCurrent.mockImplementation(() => { throw new Error('Human input changed the target page') })
  f.pause('DOM', { data: { type: 'attribute-modified' } })
  await f.settle()
  const report = await f.captures.manage(f.tab, 'get')
  expect(report).toMatchObject({ status: 'invalidated', ended: { reason: 'authority-changed' } })
  expect(report).not.toHaveProperty('capture')
  expect(f.methods()).toContain('Debugger.disable')
})

it('notices a lost authority while armed, and on get', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.arm()
  f.authority.assertCurrent.mockImplementation(() => { throw new Error('Workspace ownership changed') })
  await vi.advanceTimersByTimeAsync(600)
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'authority-changed' } })
  const g = fixture()
  await g.arm()
  g.tab.observationGeneration += 1
  expect(await g.captures.manage(g.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'authority-changed' } })
})

it('ends on a cross-document navigation, Developer Tools, a detached debugger, expiry and cancel', async () => {
  const navigation = fixture()
  await navigation.arm()
  navigation.page.emit('did-start-navigation', {}, `${ORIGIN}/orders#next`, true, true)
  expect(navigation.captures.active(navigation.tab)).toBe(true)
  navigation.page.emit('did-start-navigation', {}, `${ORIGIN}/other`, false, true)
  await navigation.settle()
  expect(await navigation.captures.manage(navigation.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'navigation' } })
  expect(navigation.methods()).toContain('Debugger.disable')

  const devTools = fixture()
  await devTools.arm()
  devTools.page.emit('devtools-opened')
  await devTools.settle()
  expect(await devTools.captures.manage(devTools.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'devtools-opened' } })

  const detached = fixture()
  await detached.arm()
  detached.sendCommand.mockClear()
  ;(detached.page.debugger as unknown as EventEmitter).emit('detach', {}, 'target closed')
  expect(await detached.captures.manage(detached.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'debugger-detached' } })
  expect(detached.sendCommand).not.toHaveBeenCalled()
  expect(detached.listeners()).toBe(0)

  const handedOver = fixture()
  await handedOver.arm()
  handedOver.startOpeningDevTools()
  ;(handedOver.page.debugger as unknown as EventEmitter).emit('detach', {}, 'target closed')
  expect(await handedOver.captures.manage(handedOver.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'devtools-opened' } })

  const cancelled = fixture()
  await cancelled.arm()
  expect(await cancelled.captures.manage(cancelled.tab, 'cancel')).toMatchObject({ status: 'cancelled', ended: { reason: 'cancelled' } })
  expect(await cancelled.captures.manage(cancelled.tab, 'cancel')).toMatchObject({ status: 'cancelled' })

  vi.useFakeTimers()
  const expiring = fixture()
  await expiring.arm('node-removed', '#dialog', 1_000)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await expiring.captures.manage(expiring.tab, 'get')).toMatchObject({ status: 'expired', ended: { reason: 'expired', kind: 'node-removed' } })
  expect(expiring.listeners()).toBe(0)
})

it('does not resume a pause while Developer Tools are open, and ends instead', async () => {
  const f = fixture()
  await f.arm()
  f.openDevTools()
  f.sendCommand.mockClear()
  f.pause('other')
  await f.settle()
  expect(f.methods()).not.toContain('Debugger.resume')
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'devtools-opened' } })
})

it('never moves to a replacement element', async () => {
  const f = fixture()
  await f.arm()
  f.removeTarget()
  f.emit('DOM.childNodeRemoved', { parentNodeId: 2, nodeId: 7 })
  await f.settle()
  await f.settle()
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'target-removed' } })
})

it('keeps the DOM domain enabled for rendering overlays, and forgets a closed tab', async () => {
  const f = fixture({ keepDomEnabled: true })
  await f.arm()
  await f.captures.manage(f.tab, 'cancel')
  expect(f.methods()).not.toContain('DOM.disable')
  expect(f.methods()).toContain('Debugger.disable')
  await f.arm()
  f.page.emit('destroyed')
  expect(f.captures.active(f.tab)).toBe(false)
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'idle' })
})

it('bounds frames, names and URLs', () => {
  const scripts = new Map<string, string | undefined>([['1', `${ORIGIN}/a.js`]])
  const callFrames = Array.from({ length: 30 }, (_, index) => ({ functionName: index === 0 ? `x‮${'n'.repeat(200)}` : `f${index}`, location: { scriptId: '1', lineNumber: index, columnNumber: 0 } }))
  const { frames, framesTruncated } = mutationSourceFrames({ callFrames }, scripts)
  expect(frames).toHaveLength(20)
  expect(framesTruncated).toBe(true)
  expect(frames[0]!.functionName).toHaveLength(120)
  expect(frames[0]!.functionName).not.toContain('‮')
  expect(frames[19]).toEqual({ functionName: 'f19', url: `${ORIGIN}/a.js`, lineNumber: 20, columnNumber: 1 })
})
