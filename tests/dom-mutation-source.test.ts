import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { DomMutationSourceCaptures, mutationSourceFrames } from '../src/main/browser/dom-mutation-source/dom-mutation-source.js'

const ORIGIN = 'https://app.test'

function fixture(options: {
  nodeIds?: readonly number[]; localName?: string; url?: string; keepDomEnabled?: boolean; heldQuery?: Promise<void>
  /** Holds one command until the promise settles. */
  heldCommand?: { method: string; until: Promise<void> }
} = {}) {
  const debuggerEvents = new EventEmitter()
  let devToolsOpened = false
  let devToolsOpening = false
  let removed = false
  let crashed = false
  // Operations queued behind the debugger queue while it is held, run in order on release.
  let held: Array<() => void> | undefined
  // Like Hronaut's renderer exit guard, commands to an exited renderer fail unsent.
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (crashed) throw new Error('The renderer exited; the command was not sent')
    if (options.heldCommand?.method === method) {
      await options.heldCommand.until
      if (crashed) throw new Error('The renderer exited; the command was not sent')
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelectorAll') {
      await options.heldQuery
      return { nodeIds: options.nodeIds ?? [7] }
    }
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
    isCrashed: () => crashed,
    isDevToolsOpened: () => devToolsOpened,
    getURL: () => options.url ?? `${ORIGIN}/orders?token=private-token`
  }) as unknown as WebContents & EventEmitter
  const tab = { id: 'tab-1', url: `${ORIGIN}/orders?token=private-token`, navigationGeneration: 0, observationGeneration: 0, webContents: page }
  const conflict = vi.fn((): string | undefined => undefined)
  const captures = new DomMutationSourceCaptures<typeof tab>({
    isCurrent: () => true,
    withDebugger: (_tab, operation) => operation(),
    inDebuggerQueue: (_tab, operation) => held
      ? new Promise((resolve, reject) => { held!.push(() => { operation().then(resolve, reject) }) })
      : operation(),
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
    setCrashed: (value: boolean) => { crashed = value },
    holdQueue: () => { held = [] },
    releaseQueue: () => { const pending = held ?? []; held = undefined; for (const run of pending) run() },
    arm: (kind: 'attribute-modified' | 'subtree-modified' | 'node-removed' = 'attribute-modified', selector = '#save', durationMs?: number) =>
      captures.manage(tab, 'arm', { selector, kind, durationMs, authority }),
    listeners: () => ['message', 'detach'].reduce((count, event) => count + (page.debugger as unknown as EventEmitter).listenerCount(event), 0)
      + ['did-start-navigation', 'dom-ready', 'devtools-opened', 'render-process-gone', 'destroyed'].reduce((count, event) => count + page.listenerCount(event), 0)
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
  expect(f.listeners()).toBe(7)
  await f.captures.manage(f.tab, 'cancel')
  expect(f.listeners()).toBe(0)
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
    ended: { reason: 'captured', selector: '#save', kind: 'attribute-modified', url: `${ORIGIN}/orders?token=%5BREDACTED%5D` },
    capture: {
      kind: 'attribute-modified', change: 'attribute', framesTruncated: false,
      frames: [
        { functionName: 'disableSave', url: `${ORIGIN}/app.js`, lineNumber: 5, columnNumber: 3 },
        { functionName: '(anonymous)', lineNumber: 1, columnNumber: 1 },
        { functionName: 'later', url: `${ORIGIN}/app.js`, lineNumber: 10, columnNumber: 2, asyncBoundary: 'setTimeout' }
      ]
    }
  })
  expect(report.capture!.frames[1]).not.toHaveProperty('url')
  expect(JSON.stringify(report)).not.toMatch(/private-token|private-inline|frag/)
  expect(JSON.stringify(report.capture)).not.toContain('token')
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
  // The new controller of the workspace reads nothing of the earlier capture.
  const report = await g.captures.manage(g.tab, 'get')
  expect(report).toMatchObject({ status: 'idle' })
  expect(report).not.toHaveProperty('ended')
  expect(g.captures.active(g.tab)).toBe(false)
  expect(g.methods()).toContain('Debugger.disable')
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

it('ignores changes made from an isolated world, such as Hronaut\'s snapshot references, and stays armed', async () => {
  const f = fixture()
  await f.arm()
  f.emit('Debugger.scriptParsed', { scriptId: '30', url: '', executionContextAuxData: { isDefault: false, type: 'isolated', frameId: 'main' } })
  f.emit('Debugger.scriptParsed', { scriptId: '11', url: `${ORIGIN}/app.js`, executionContextAuxData: { isDefault: true, type: 'default', frameId: 'main' } })
  f.sendCommand.mockClear()
  f.pause('DOM', { data: { type: 'attribute-modified' }, callFrames: [{ functionName: 'markRefs', location: { scriptId: '30', lineNumber: 190, columnNumber: 14 } }] })
  await f.settle()
  expect(f.methods()).toEqual(['Debugger.resume'])
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'armed' })
  // The page's own change after it is still captured.
  f.pause('DOM', { data: { type: 'attribute-modified' } })
  await f.settle()
  const report = await f.captures.manage(f.tab, 'get')
  expect(report).toMatchObject({ status: 'captured', capture: { frames: [{ functionName: 'disableSave', url: `${ORIGIN}/app.js` }] } })
})

it('resumes a pause first while Developer Tools are opening, then ends', async () => {
  const f = fixture()
  await f.arm()
  f.startOpeningDevTools()
  f.sendCommand.mockClear()
  f.pause('DOM', { data: { type: 'attribute-modified' } })
  expect(f.methods()[0]).toBe('Debugger.resume')
  await f.settle()
  const report = await f.captures.manage(f.tab, 'get')
  expect(report).toMatchObject({ status: 'invalidated', ended: { reason: 'devtools-opened' } })
  expect(report).not.toHaveProperty('capture')
})

it('ends when the renderer exits, resumes pauses and removes the instrumentation once the page loads again', async () => {
  const f = fixture()
  await f.arm()
  f.sendCommand.mockClear()
  f.setCrashed(true)
  f.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  expect(await f.captures.manage(f.tab, 'cancel')).toMatchObject({ status: 'invalidated', ended: { reason: 'renderer-gone' } })
  expect(f.captures.active(f.tab)).toBe(false)
  await expect(f.arm()).rejects.toThrow('renderer exited')
  // Chromium restores the Debugger domain in the next renderer, so the listeners stay until the removal ran there.
  expect(f.methods()).toEqual([])
  expect(f.listeners()).toBe(7)
  f.setCrashed(false)
  f.pause('other')
  f.page.emit('did-start-navigation', {}, `${ORIGIN}/orders`, false, true)
  await f.settle()
  expect(f.methods()).toEqual(['Debugger.resume', 'DOMDebugger.removeDOMBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth', 'DOM.disable'])
  expect(f.listeners()).toBe(0)
  expect(await f.captures.manage(f.tab, 'get')).toMatchObject({ status: 'invalidated', ended: { reason: 'renderer-gone' } })
})

it('removes the instrumentation only once the page runs in a new renderer, retrying until it does', async () => {
  const f = fixture()
  await f.arm()
  f.sendCommand.mockClear()
  f.setCrashed(true)
  f.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  // The reload starts before its new renderer is ready: nothing can be removed yet, so the record stays.
  f.page.emit('did-start-navigation', {}, `${ORIGIN}/orders`, false, true)
  await f.settle()
  expect(f.methods()).toEqual([])
  expect(f.listeners()).toBe(7)
  expect(f.captures.active(f.tab)).toBe(false)
  f.setCrashed(false)
  // Until the removal ran in the new renderer, the capture still holds the debugger session.
  expect(f.captures.active(f.tab)).toBe(true)
  f.emit('Debugger.scriptParsed', { scriptId: '40', url: `${ORIGIN}/app.js`, executionContextAuxData: { isDefault: true } })
  await f.settle()
  expect(f.methods()).toEqual(['DOMDebugger.removeDOMBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth', 'DOM.disable'])
  expect(f.listeners()).toBe(0)
  expect(f.captures.active(f.tab)).toBe(false)

  // A ready document, a read or a cancel also run it.
  const ready = fixture()
  await ready.arm()
  ready.setCrashed(true)
  ready.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  ready.setCrashed(false)
  ready.page.emit('dom-ready')
  await ready.settle()
  expect(ready.listeners()).toBe(0)
  for (const action of ['get', 'cancel'] as const) {
    const read = fixture()
    await read.arm()
    read.setCrashed(true)
    read.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    read.setCrashed(false)
    expect(await read.captures.manage(read.tab, action)).toMatchObject({ status: 'invalidated', ended: { reason: 'renderer-gone' } })
    expect(read.listeners()).toBe(0)
    expect(read.methods()).toContain('Debugger.disable')
  }
})

it('keeps the listeners for the next renderer when the renderer exits during the removal or while arming', async () => {
  let crashDuringDisable!: () => void
  const f = fixture({ heldCommand: { method: 'Debugger.disable', until: new Promise<void>(resolve => { crashDuringDisable = resolve }) } })
  await f.arm()
  const cancel = f.captures.manage(f.tab, 'cancel')
  await f.settle()
  f.setCrashed(true)
  f.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  crashDuringDisable()
  expect(await cancel).toMatchObject({ status: 'cancelled', ended: { reason: 'cancelled' } })
  // Debugger.disable never reached the renderer, so the next one restores the domain: the listeners resume its pauses.
  expect(f.listeners()).toBe(7)
  f.setCrashed(false)
  f.page.emit('dom-ready')
  await f.settle()
  expect(f.listeners()).toBe(0)
  expect(f.methods().filter(method => method === 'Debugger.disable')).toHaveLength(2)

  let crashAfterEnable!: () => void
  const g = fixture({ heldCommand: { method: 'Runtime.setAsyncCallStackDepth', until: new Promise<void>(resolve => { crashAfterEnable = resolve }) } })
  const arming = g.arm()
  await g.settle()
  expect(g.methods()).toContain('Debugger.enable')
  g.setCrashed(true)
  g.page.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  crashAfterEnable()
  await expect(arming).rejects.toThrow('renderer exited')
  expect(g.listeners()).toBe(7)
  expect(g.captures.active(g.tab)).toBe(false)
  g.setCrashed(false)
  expect(await g.captures.manage(g.tab, 'get')).toMatchObject({ status: 'idle' })
  expect(g.listeners()).toBe(0)
  expect(g.methods().filter(method => method === 'Debugger.disable')).toHaveLength(2)
})

it('keeps a finished capture under the same workspace control, also after the page moved to another origin', async () => {
  const navigated = fixture()
  await navigated.arm()
  navigated.pause('DOM', { data: { type: 'attribute-modified' } })
  await navigated.settle()
  navigated.tab.url = `${ORIGIN}/other`
  expect(await navigated.captures.manage(navigated.tab, 'get')).toMatchObject({ status: 'captured', url: `${ORIGIN}/other`, ended: { url: `${ORIGIN}/orders?token=%5BREDACTED%5D` } })
  // A change followed by a redirect elsewhere, such as a payment step, still reports the change that started it.
  navigated.tab.url = 'https://elsewhere.test/'
  expect(await navigated.captures.manage(navigated.tab, 'get')).toMatchObject({
    status: 'captured', url: 'https://elsewhere.test/', capture: { change: 'attribute' }, ended: { reason: 'captured', url: `${ORIGIN}/orders?token=%5BREDACTED%5D` }
  })

  const controlled = fixture()
  await controlled.arm()
  controlled.pause('DOM', { data: { type: 'attribute-modified' } })
  await controlled.settle()
  controlled.tab.observationGeneration += 1
  const report = await controlled.captures.manage(controlled.tab, 'get')
  expect(report).toMatchObject({ status: 'idle' })
  expect(report).not.toHaveProperty('capture')
})

it('a cancel or navigation while arming wins: nothing stays armed and nothing is left behind', async () => {
  let release!: () => void
  const f = fixture({ heldQuery: new Promise<void>(resolve => { release = resolve }) })
  const arming = f.arm()
  await f.settle()
  expect(await f.captures.manage(f.tab, 'cancel')).toMatchObject({ status: 'idle' })
  release()
  await expect(arming).rejects.toThrow('cancelled while it was arming')
  expect(f.methods()).not.toContain('DOMDebugger.setDOMBreakpoint')
  expect(f.methods()).toContain('Debugger.disable')
  expect(f.listeners()).toBe(0)
  expect(f.captures.active(f.tab)).toBe(false)

  let continueQuery!: () => void
  const g = fixture({ heldQuery: new Promise<void>(resolve => { continueQuery = resolve }) })
  const navigating = g.arm()
  await g.settle()
  g.tab.navigationGeneration += 1
  continueQuery()
  await expect(navigating).rejects.toThrow('The page changed while arming')
  expect(g.listeners()).toBe(0)
})

it('arming again replaces the armed capture and moves the breakpoint', async () => {
  const f = fixture()
  await f.arm('attribute-modified', '#save')
  f.sendCommand.mockClear()
  const report = await f.arm('subtree-modified', '#panel')
  expect(report).toMatchObject({ status: 'armed', armed: { selector: '#panel', kind: 'subtree-modified' } })
  expect(f.methods().slice(0, 3)).toEqual(['DOMDebugger.removeDOMBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(f.sendCommand).toHaveBeenCalledWith('DOMDebugger.removeDOMBreakpoint', { nodeId: 7, type: 'attribute-modified' })
  expect(f.sendCommand).toHaveBeenLastCalledWith('DOMDebugger.setDOMBreakpoint', { nodeId: 7, type: 'subtree-modified' })
  expect(f.listeners()).toBe(7)
  await f.captures.manage(f.tab, 'cancel')
})

it('a cancel after a capture waits until the instrumentation is removed', async () => {
  const f = fixture()
  await f.arm()
  f.holdQueue()
  f.pause('DOM', { data: { type: 'attribute-modified' } })
  let cancelled = false
  const cancel = f.captures.manage(f.tab, 'cancel').then(report => { cancelled = true; return report })
  await f.settle()
  expect(cancelled).toBe(false)
  expect(f.captures.active(f.tab)).toBe(true)
  f.releaseQueue()
  expect(await cancel).toMatchObject({ status: 'captured' })
  expect(f.captures.active(f.tab)).toBe(false)
  expect(f.methods()).toContain('DOMDebugger.removeDOMBreakpoint')
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
