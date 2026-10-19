import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { LogpointReport, LogpointScriptsReport } from '../src/shared/logpoint.js'
import { LogpointSets } from '../src/main/browser/logpoints/logpoints.js'

const ORIGIN = 'https://shop.test'
// esbuild's map of src/cart.ts bundled with two format.ts helpers; cart.ts line 10 runs on bundle line 17.
const MAP = {
  version: 3 as const,
  sources: ['../src/a/format.ts', '../src/b/format.ts', '../src/cart.ts'],
  mappings: ';;AAAO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACFO,WAAS,QAAQ,OAAuB;AAC7C,WAAO,IAAI,KAAK;AAAA,EAClB;;;ACEA,MAAM,QAAQ,EAAE,QAAQ,GAAG,MAAM,IAAI;AAE9B,WAAS,MAAM,OAAuB;AAC3C,QAAI,MAAM;AACV,eAAW,QAAQ,OAAO;AACxB,aAAO,KAAK,QAAQ,KAAK;AAAA,IAC3B;AACA,UAAM,WAAW,MAAM,MAAM,KAAK;AAClC,UAAM,UAAU;AAChB,WAAO,MAAM;AAAA,EACf;AAEA,WAAS,KAAK,GAAmB;AAC/B,QAAI,MAAM;AACV,aAAS,IAAI,GAAG,IAAI,GAAG,KAAK;AAC1B,aAAO,MAAM,KAAK;AAAA,IACpB;AACA,WAAO;AAAA,EACT;AAEA,MAAM,IAAI;AACV,IAAE,QAAQ;AACV,IAAE,WAAW,CAAC,UAAkB,MAAM,KAAK;AAC3C,IAAE,OAAO,CAAC,MAAc,KAAK,CAAC;AAC9B,IAAE,SAAS,CAAC,UAAkB,CAAC,QAAQ,KAAK,GAAG,QAAQ,KAAK,CAAC;AAC7D,IAAE,cAAc,MAAM;AAAE;AAAU,MAAE,gBAAgB;AAAA,EAAE;AACtD,IAAE,QAAQ;AACV,cAAY,MAAM;AAAE,MAAE,QAAS,EAAE,QAAmB;AAAA,EAAE,GAAG,EAAE;',
  names: [],
  sourcesContent: ['// SOURCE-CONTENT-CANARY a', '// SOURCE-CONTENT-CANARY b', '// SOURCE-CONTENT-CANARY cart']
}
const INLINE_MAP = `data:application/json;base64,${Buffer.from(JSON.stringify(MAP)).toString('base64')}`

function parsed(scriptId: string, url: string, hash: string, frameId: string, extra: Record<string, unknown> = {}) {
  return { scriptId, url, hash, executionContextId: frameId === 'main' ? 1 : 2, startLine: 0, endLine: 40, executionContextAuxData: { frameId, isDefault: true }, ...extra }
}

function fixture(options: {
  url?: string
  /** Holds one command until the promise settles. */
  heldCommand?: { method: string; until: Promise<void> }
} = {}) {
  const debuggerEvents = new EventEmitter()
  let url = options.url ?? `${ORIGIN}/app?token=private-token`
  let crashed = false
  let devToolsOpened = false
  let topWindow = true
  let breakpoints = 0
  let evaluation: unknown = { result: { type: 'number', value: 20 } }
  let frameCheckFails = false
  /** A pause the page reaches while the next breakpoint is being set. */
  let pauseWhileSetting: string | undefined
  const scripts = [
    parsed('6', `${ORIGIN}/bundle.js`, 'h1', 'main', { sourceMapURL: INLINE_MAP }),
    parsed('7', `${ORIGIN}/plain.js`, 'h7', 'main'),
    // Shared with the page, and reported for its same-origin frame.
    parsed('8', `${ORIGIN}/shared.js`, 'h8', 'frame'),
    parsed('9', 'https://ads.test/ad.js', 'h9', 'ads'),
    parsed('10', '', 'h10', 'main'),
    // Two inline scripts of the document, at its address on their own lines.
    parsed('11', `${ORIGIN}/app`, 'i1', 'main', { startLine: 2, endLine: 4 }),
    parsed('12', `${ORIGIN}/app`, 'i2', 'main', { startLine: 9, endLine: 20 }),
    parsed('13', `${ORIGIN}/isolated.js`, 'h13', 'main', { executionContextAuxData: { frameId: 'main', isDefault: false } })
  ]
  const emit = (method: string, params: unknown) => debuggerEvents.emit('message', {}, method, params)
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (crashed) throw new Error('The renderer exited; the command was not sent')
    if (options.heldCommand?.method === method) await options.heldCommand.until
    if (method === 'Debugger.enable') for (const script of scripts) emit('Debugger.scriptParsed', script)
    if (method === 'Page.getFrameTree') {
      return {
        frameTree: {
          frame: { id: 'main', url, securityOrigin: new URL(url).origin },
          childFrames: [{ frame: { id: 'frame', url: `${ORIGIN}/frame`, securityOrigin: ORIGIN } }, { frame: { id: 'ads', url: 'https://ads.test/', securityOrigin: 'https://ads.test' } }]
        }
      }
    }
    if (method === 'Debugger.setBreakpointByUrl') {
      if (pauseWhileSetting && breakpoints >= 1) {
        pause([pauseWhileSetting])
        pauseWhileSetting = undefined
      }
      breakpoints += 1
      return { breakpointId: `bp${breakpoints}`, locations: [{ lineNumber: params!.lineNumber, columnNumber: 6 }] }
    }
    if (method === 'Runtime.callFunctionOn') {
      if (frameCheckFails) throw new Error('Could not find object with given id')
      return { result: { type: 'boolean', value: topWindow } }
    }
    if (method === 'Debugger.evaluateOnCallFrame') return evaluation
    return {}
  })
  const page = Object.assign(new EventEmitter(), {
    debugger: Object.assign(debuggerEvents, { sendCommand, isAttached: () => true }),
    isDestroyed: () => false,
    isCrashed: () => crashed,
    isDevToolsOpened: () => devToolsOpened,
    getURL: () => url
  }) as unknown as WebContents & EventEmitter
  const tab = { id: 'tab-1', url: `${ORIGIN}/app?token=private-token`, observationGeneration: 0, webContents: page }
  const conflict = vi.fn((): string | undefined => undefined)
  const changed = vi.fn()
  const sets = new LogpointSets<typeof tab>({
    isCurrent: () => true,
    withDebugger: (_tab, operation) => operation(),
    inDebuggerQueue: (_tab, operation) => operation(),
    conflict,
    keepDebuggerEnabled: () => false,
    isDevToolsOpening: () => false,
    changed
  })
  const authority = { assertCurrent: vi.fn() }
  const methods = () => sendCommand.mock.calls.map(([method]) => method)
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
  const pause = (hitBreakpoints: string[] = ['bp1'], scriptId = '6') => emit('Debugger.paused', {
    reason: 'other',
    hitBreakpoints,
    callFrames: [{ callFrameId: 'frame-0', location: { scriptId }, scopeChain: [{ type: 'local', object: { objectId: 'local-1' } }, { type: 'global', object: { objectId: 'global-1' } }] }]
  })
  return {
    sets, tab, page, authority, conflict, changed, sendCommand, methods, emit, pause, settle,
    add: (probes: Array<Record<string, unknown>>, extra: { maxHits?: number; durationMs?: number } = {}) =>
      sets.manage(tab, 'add', { probes: probes as never, authority, ...extra }) as Promise<LogpointReport>,
    get: (callAuthority = authority) => sets.manage(tab, 'get', { authority: callAuthority }) as Promise<LogpointReport>,
    setUrl: (value: string) => { url = value },
    setCrashed: (value: boolean) => { crashed = value },
    openDevTools: () => { devToolsOpened = true },
    inOtherFrame: () => { topWindow = false },
    failFrameCheck: () => { frameCheckFails = true },
    pauseWhileSetting: (breakpointId: string) => { pauseWhileSetting = breakpointId },
    evaluates: (value: unknown) => { evaluation = value },
    listeners: () => ['message', 'detach'].reduce((count, event) => count + (page.debugger as unknown as EventEmitter).listenerCount(event), 0)
      + ['did-start-navigation', 'did-redirect-navigation', 'dom-ready', 'devtools-opened', 'render-process-gone', 'destroyed'].reduce((count, event) => count + page.listenerCount(event), 0)
  }
}

const CART = { source: 'src/cart.ts', line: 10, expression: 'sum' }

afterEach(() => { vi.useRealTimers() })

it('arms logpoints at a source line, pinned to the exact script, under the call\'s authority', async () => {
  const f = fixture()
  const report = await f.add([CART])
  expect(report).toMatchObject({
    status: 'armed', origin: ORIGIN, url: `${ORIGIN}/app?token=%5BREDACTED%5D`,
    probes: [{ id: 'p1', expression: 'sum', requested: { source: 'src/cart.ts', line: 10 }, state: 'armed', records: [], otherFrameHits: 0,
      resolved: { url: `${ORIGIN}/bundle.js`, line: 17, column: 7, original: { source: '../src/cart.ts', line: 10, column: 5 }, generatedMatches: 1 } }]
  })
  expect(f.methods()).toEqual(['Debugger.enable', 'Debugger.setPauseOnExceptions', 'Debugger.setSkipAllPauses', 'Debugger.setBreakpointsActive', 'Page.getFrameTree', 'Debugger.setBreakpointByUrl'])
  expect(f.sendCommand).toHaveBeenCalledWith('Debugger.setBreakpointByUrl', { scriptHash: 'h1', lineNumber: 16, columnNumber: 0 })
  expect(f.authority.assertCurrent).toHaveBeenCalledWith(ORIGIN)
  expect(f.sets.summary(f.tab)).toEqual({ origin: ORIGIN, probes: 1, expiresAt: report.expiresAt })
  expect(f.changed).toHaveBeenCalledTimes(1)
  expect(f.listeners()).toBe(8)
})

it('records a hit in the top-level page, then resumes it and releases what it read', async () => {
  const f = fixture()
  await f.add([CART])
  f.sendCommand.mockClear()
  f.pause()
  await f.settle()
  expect(f.methods()).toEqual(['Page.getFrameTree', 'Runtime.callFunctionOn', 'Debugger.evaluateOnCallFrame', 'Debugger.resume', 'Runtime.releaseObjectGroup'])
  expect(f.sendCommand).toHaveBeenCalledWith('Runtime.callFunctionOn', expect.objectContaining({ objectId: 'global-1', returnByValue: true, throwOnSideEffect: true }))
  const evaluated = f.sendCommand.mock.calls.find(([method]) => method === 'Debugger.evaluateOnCallFrame')![1]!
  expect(evaluated).toMatchObject({ callFrameId: 'frame-0', throwOnSideEffect: true, timeout: 50, silent: true, includeCommandLineAPI: false, returnByValue: false, generatePreview: true })
  expect(evaluated.expression).toContain('\nsum\n')
  expect((await f.get()).probes[0]!.records).toEqual([{ at: expect.any(String), value: { type: 'number', value: 20 } }])
})

it('counts a hit in another frame running the same script without reading it, and resumes any other pause at once', async () => {
  const f = fixture()
  await f.add([CART])
  f.inOtherFrame()
  f.sendCommand.mockClear()
  f.pause()
  await f.settle()
  expect(f.methods()).toEqual(['Page.getFrameTree', 'Runtime.callFunctionOn', 'Debugger.resume', 'Runtime.releaseObjectGroup'])
  expect((await f.get()).probes[0]).toMatchObject({ records: [], otherFrameHits: 1 })

  // A debugger statement in the page.
  f.sendCommand.mockClear()
  f.pause([])
  await f.settle()
  expect(f.methods()).toEqual(['Debugger.resume'])
})

it('removes a logpoint at its hit limit before the page resumes, and ends once every logpoint is complete', async () => {
  const f = fixture()
  await f.add([CART, { url: `${ORIGIN}/plain.js`, line: 1, expression: 'window.plain' }], { maxHits: 1 })
  f.sendCommand.mockClear()
  f.pause(['bp1'])
  await f.settle()
  expect(f.methods()).toEqual(['Page.getFrameTree', 'Runtime.callFunctionOn', 'Debugger.evaluateOnCallFrame', 'Debugger.removeBreakpoint', 'Debugger.resume', 'Runtime.releaseObjectGroup'])
  expect((await f.get()).probes.map(probe => probe.state)).toEqual(['complete', 'armed'])
  expect(f.sets.summary(f.tab)).toMatchObject({ probes: 1 })

  f.sendCommand.mockClear()
  f.pause(['bp2'], '7')
  await f.settle()
  const report = await f.get()
  expect(report).toMatchObject({ status: 'ended', ended: { reason: 'complete' } })
  expect(report.probes.map(probe => [probe.state, probe.records.length])).toEqual([['complete', 1], ['complete', 1]])
  // Completed breakpoints are already gone; the Debugger domain is turned off and async stacks restored.
  expect(f.methods().slice(-2)).toEqual(['Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(f.methods().filter(method => method === 'Debugger.removeBreakpoint')).toHaveLength(1)
  expect(f.listeners()).toBe(0)
  expect(f.sets.summary(f.tab)).toBeUndefined()
})

it('keeps no record once the call\'s authority is gone, and withholds records from a call that may not act on the origin', async () => {
  const f = fixture()
  await f.add([CART])
  f.pause()
  await f.settle()
  const elsewhere = { assertCurrent: vi.fn(() => { throw new Error('Not allowed on this origin') }) }
  expect(await f.get(elsewhere)).toMatchObject({ status: 'armed', recordsWithheld: true, probes: [{ records: [] }] })

  f.authority.assertCurrent.mockImplementation(() => { throw new Error('The workspace control changed') })
  f.sendCommand.mockClear()
  f.pause()
  await f.settle()
  expect(f.methods()).not.toContain('Debugger.evaluateOnCallFrame')
  expect(f.methods()).toContain('Debugger.resume')
  const report = await f.get(elsewhere)
  expect(report).toMatchObject({ status: 'ended', ended: { reason: 'authority-changed' }, recordsWithheld: true, probes: [{ state: 'ended', records: [] }] })
  expect(f.listeners()).toBe(0)
})

it('marks a logpoint stale while the top-level page runs another build at its address and line, and armed again when it hits', async () => {
  const f = fixture()
  await f.add([CART])
  // Another build loaded beside the logpoint's script does not replace it.
  f.emit('Debugger.scriptParsed', parsed('20', `${ORIGIN}/bundle.js`, 'h2', 'main'))
  expect((await f.get()).probes[0]!.state).toBe('armed')
  // A reload runs the other build only.
  f.emit('Runtime.executionContextsCleared', {})
  f.emit('Debugger.scriptParsed', parsed('21', `${ORIGIN}/bundle.js`, 'h2', 'main'))
  expect((await f.get()).probes[0]!.state).toBe('stale')
  f.emit('Runtime.executionContextsCleared', {})
  f.emit('Debugger.scriptParsed', parsed('22', `${ORIGIN}/bundle.js`, 'h1', 'main'))
  expect((await f.get()).probes[0]!.state).toBe('armed')
  f.emit('Runtime.executionContextsCleared', {})
  f.emit('Debugger.scriptParsed', parsed('23', `${ORIGIN}/bundle.js`, 'h2', 'main'))
  expect((await f.get()).probes[0]!.state).toBe('stale')
  // A hit shows the page runs the logpoint's script after all, as when Chromium reused it without reporting it.
  f.pause(['bp1'], '23')
  await f.settle()
  expect((await f.get()).probes[0]).toMatchObject({ state: 'armed', records: [{ value: { type: 'number', value: 20 } }] })
})

it('keeps a logpoint on an inline script armed when the document\'s other inline scripts parse again', async () => {
  const f = fixture()
  const report = await f.add([{ url: `${ORIGIN}/app`, line: 4, expression: 'x' }])
  expect(f.sendCommand).toHaveBeenCalledWith('Debugger.setBreakpointByUrl', { scriptHash: 'i1', lineNumber: 3, columnNumber: 0 })
  expect(report.probes[0]!.resolved).toEqual({ url: `${ORIGIN}/app`, line: 4, column: 7 })
  f.emit('Runtime.executionContextsCleared', {})
  f.emit('Debugger.scriptParsed', parsed('30', `${ORIGIN}/app`, 'i1', 'main', { startLine: 2, endLine: 4 }))
  f.emit('Debugger.scriptParsed', parsed('31', `${ORIGIN}/app`, 'i2', 'main', { startLine: 9, endLine: 20 }))
  expect((await f.get()).probes[0]!.state).toBe('armed')
  // An edited document whose inline script on that line changed.
  f.emit('Runtime.executionContextsCleared', {})
  f.emit('Debugger.scriptParsed', parsed('32', `${ORIGIN}/app`, 'i3', 'main', { startLine: 2, endLine: 5 }))
  expect((await f.get()).probes[0]!.state).toBe('stale')
})

it('counts hits in other frames, in an isolated world and those it cannot check toward maxHits, and removes the logpoint at its limit', async () => {
  const f = fixture()
  await f.add([CART], { maxHits: 4 })
  f.inOtherFrame()
  f.pause()
  await f.settle()
  // A script of an isolated world, such as an extension's.
  f.pause(['bp1'], '13')
  await f.settle()
  // A script Hronaut never saw parsed.
  f.pause(['bp1'], '99')
  await f.settle()
  expect((await f.get()).probes[0]).toMatchObject({ state: 'armed', records: [], otherFrameHits: 2, missedHits: 1 })
  f.failFrameCheck()
  f.sendCommand.mockClear()
  f.pause()
  await f.settle()
  expect(f.methods()).toEqual(['Page.getFrameTree', 'Runtime.callFunctionOn', 'Debugger.removeBreakpoint', 'Debugger.resume', 'Runtime.releaseObjectGroup', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(await f.get()).toMatchObject({ status: 'ended', ended: { reason: 'complete' }, probes: [{ state: 'complete', records: [], otherFrameHits: 2, missedHits: 2 }] })
})

it('counts a hit reached while the other logpoints are still being set, and completes a logpoint whose hits it used up', async () => {
  const f = fixture()
  f.pauseWhileSetting('bp1')
  const report = await f.add([CART, { url: `${ORIGIN}/plain.js`, line: 1, expression: 'window.plain' }], { maxHits: 1 })
  expect(report.probes.map(probe => [probe.state, probe.missedHits])).toEqual([['complete', 1], ['armed', 0]])
  expect(f.methods().filter(method => method === 'Debugger.resume')).toHaveLength(1)
  expect(f.methods().slice(-1)).toEqual(['Debugger.removeBreakpoint'])
  expect(f.methods()).not.toContain('Debugger.evaluateOnCallFrame')
})

it('waits for an add in flight when the logpoints are removed, so nothing is left armed', async () => {
  let release!: () => void
  const f = fixture({ heldCommand: { method: 'Debugger.setBreakpointByUrl', until: new Promise<void>(resolve => { release = resolve }) } })
  const adding = f.add([CART])
  await f.settle()
  let removed = false
  const removing = f.sets.manage(f.tab, 'remove', { authority: f.authority }).then(report => { removed = true; return report as LogpointReport })
  await f.settle()
  expect(removed).toBe(false)
  release()
  await expect(adding).rejects.toThrow('The logpoints were removed while they were being added. Nothing is armed.')
  expect(await removing).toMatchObject({ status: 'idle' })
  expect(f.methods().slice(-3)).toEqual(['Debugger.removeBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(f.listeners()).toBe(0)
})

it('replaces the tab\'s logpoints, removing the earlier ones first, and lists the armed page\'s scripts without enabling the debugger again', async () => {
  const f = fixture()
  await f.add([CART])
  f.sendCommand.mockClear()
  const replaced = await f.add([{ url: `${ORIGIN}/plain.js`, line: 1, expression: 'window.plain' }])
  expect(f.methods().slice(0, 4)).toEqual(['Debugger.removeBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth', 'Debugger.enable'])
  expect(replaced).toMatchObject({ status: 'armed', probes: [{ id: 'p1', resolved: { url: `${ORIGIN}/plain.js` } }] })
  expect(f.listeners()).toBe(8)

  f.sendCommand.mockClear()
  const listing = await f.sets.manage(f.tab, 'scripts', { authority: f.authority }) as LogpointScriptsReport
  expect(listing.scripts.map(script => script.url)).toContain(`${ORIGIN}/bundle.js`)
  expect(f.methods()).not.toContain('Debugger.enable')
  expect(f.methods()).not.toContain('Debugger.disable')
  expect((await f.get()).status).toBe('armed')
})

it('forgets the logpoints of a closed tab without sending anything', async () => {
  const f = fixture()
  await f.add([CART])
  f.sendCommand.mockClear()
  f.sets.forget(f.tab)
  expect(f.sendCommand).not.toHaveBeenCalled()
  expect(f.listeners()).toBe(0)
  expect(await f.get()).toMatchObject({ status: 'idle', probes: [] })
})

it('keeps the logpoints through a navigation within the origin and ends them when the page leaves it', async () => {
  const f = fixture()
  await f.add([CART])
  f.page.emit('did-start-navigation', {}, `${ORIGIN}/checkout`, false, true)
  f.page.emit('did-start-navigation', {}, 'https://ads.test/', false, false)
  expect((await f.get()).status).toBe('armed')
  f.page.emit('did-redirect-navigation', {}, 'https://other.test/', false, true)
  await f.settle()
  expect(await f.get()).toMatchObject({ status: 'ended', ended: { reason: 'origin-left' } })
  expect(f.methods()).toContain('Debugger.removeBreakpoint')
  expect(f.listeners()).toBe(0)
})

it('ends when the logpoints expire or a person stops them', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.add([CART], { durationMs: 5_000 })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await f.get()).toMatchObject({ status: 'ended', ended: { reason: 'expired' } })
  await f.add([CART])
  f.sets.stop(f.tab, 'person-stopped')
  await vi.advanceTimersByTimeAsync(0)
  expect(await f.get()).toMatchObject({ status: 'ended', ended: { reason: 'person-stopped' } })
  expect(f.listeners()).toBe(0)
})

it('refuses a conflicting debugger use, a page that is not HTTP(S) and open Developer Tools, leaving nothing behind', async () => {
  const conflicted = fixture()
  conflicted.conflict.mockReturnValue('Stop code coverage before using logpoints')
  await expect(conflicted.add([CART])).rejects.toThrow('Stop code coverage before using logpoints')
  expect(conflicted.sendCommand).not.toHaveBeenCalled()

  const local = fixture({ url: 'file:///tmp/cart.html' })
  await expect(local.add([CART])).rejects.toThrow('Open an HTTP(S) page in this tab before using logpoints')

  const inspected = fixture()
  inspected.openDevTools()
  await expect(inspected.add([CART])).rejects.toThrow('Close Developer Tools for this tab before using logpoints')

  // Every location resolves before any breakpoint is set.
  const missing = fixture()
  await expect(missing.add([CART, { source: 'nothing.ts', line: 1, expression: 'x' }])).rejects.toThrow('Logpoint 2: no source map')
  expect(missing.methods()).not.toContain('Debugger.setBreakpointByUrl')
  expect(missing.methods().slice(-2)).toEqual(['Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(missing.listeners()).toBe(0)
  expect((await missing.get()).status).toBe('idle')

  const invalid = fixture()
  await expect(invalid.add([CART], { maxHits: 51 })).rejects.toThrow('maxHits must be an integer from 1 to 50')
  await expect(invalid.add([CART], { durationMs: 1_000 })).rejects.toThrow('durationMs must be an integer from 5000 to 300000')
  await expect(invalid.add([])).rejects.toThrow('Give 1 to 5 logpoints')
  await expect(invalid.sets.manage(invalid.tab, 'get')).rejects.toThrow('Logpoints need the call\'s authority')
})

it('ends at a renderer exit and removes the instrumentation once the page runs in a new renderer', async () => {
  const f = fixture()
  await f.add([CART])
  f.setCrashed(true)
  f.page.emit('render-process-gone', {}, { reason: 'crashed' })
  f.sendCommand.mockClear()
  expect(await f.get()).toMatchObject({ status: 'ended', ended: { reason: 'renderer-gone' } })
  expect(f.sendCommand).not.toHaveBeenCalled()
  // The restored Debugger domain could pause the new page, so a pause is still resumed.
  expect(f.listeners()).toBe(8)
  f.setCrashed(false)
  f.page.emit('dom-ready')
  await f.settle()
  expect(f.methods()).toEqual(['Debugger.removeBreakpoint', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(f.listeners()).toBe(0)
})

it('lists the scripts of the page and its same-origin frames, with source names but not contents, and leaves the Debugger domain off', async () => {
  const f = fixture()
  const report = await f.sets.manage(f.tab, 'scripts', { authority: f.authority }) as LogpointScriptsReport
  expect(report.scripts).toEqual([
    { url: `${ORIGIN}/app`, sourceMap: 'none' },
    { url: `${ORIGIN}/app`, sourceMap: 'none' },
    { url: `${ORIGIN}/bundle.js`, sourceMap: 'loaded', sources: MAP.sources },
    { url: `${ORIGIN}/plain.js`, sourceMap: 'none' },
    { url: `${ORIGIN}/shared.js`, sourceMap: 'none' }
  ])
  expect(report.omittedScripts).toBe(1)
  expect(JSON.stringify(report)).not.toContain('SOURCE-CONTENT-CANARY')
  expect(JSON.stringify(report)).not.toContain('private-token')
  expect(f.methods()).toEqual(['Debugger.enable', 'Page.getFrameTree', 'Debugger.disable', 'Runtime.setAsyncCallStackDepth'])
  expect(f.listeners()).toBe(0)
  expect(f.authority.assertCurrent).toHaveBeenCalledWith(ORIGIN)
})
