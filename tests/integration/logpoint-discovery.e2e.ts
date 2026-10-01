import { createServer } from 'node:http'
import type { Debugger } from 'electron'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type ProbeState = {
  debugger: Debugger
  listener: Parameters<Debugger['on']>[1]
  breakpointId?: string
  count: number
  values: number[]
  pauses: number
}

// Discovery only. This uses the privileged test harness, not a product probe API.
// The known fixture location was resolved from the TypeScript map in the
// standalone experiment; this case does not implement a source-map resolver.
test('discovers Electron logpoint side effects and coverage domain ownership', async ({ appWindow, electronApp }, testInfo) => {
  const script = '"use strict";\nfunction compute(value) {\n    const doubled = value * 2;\n    return doubled + 1;\n}\nwindow.probeSideEffects = 0;\n//# sourceMappingURL=fixture.js.map'
  const sourceMap = { version: 3, file: 'fixture.js', sources: ['fixture.ts'], names: [], mappings: ';AAAA,SAAS,OAAO,CAAC,KAAa;IAC5B,MAAM,OAAO,GAAG,KAAK,GAAG,CAAC,CAAC;IAC1B,OAAO,OAAO,GAAG,CAAC,CAAC;AACrB,CAAC', sourcesContent: ['function compute(value: number): number {\n  const doubled = value * 2;\n  return doubled + 1;\n}\n'] }
  const server = createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'application/javascript' : request.url === '/fixture.js.map' ? 'application/json' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : request.url === '/fixture.js.map' ? JSON.stringify(sourceMap) : '<!doctype html><title>Probe discovery</title><script src="/fixture.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const stats = () => electronApp.evaluate(() => {
    const state = (globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery
    return { count: state.count, values: state.values, pauses: state.pauses }
  })
  const install = () => electronApp.evaluate(async url => {
    const state = (globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery
    await state.debugger.sendCommand('Debugger.enable')
    const result = await state.debugger.sendCommand('Debugger.setBreakpointByUrl', {
      url: `${url}fixture.js`, lineNumber: 3, columnNumber: 4,
      condition: 'globalThis.probeSideEffects++, console.debug("synthetic-probe", doubled), false'
    })
    state.breakpointId = result.breakpointId
    return result.locations.length
  }, url)
  try {
    const initial = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = initial.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect.poll(() => page.evaluate('typeof compute')).toBe('function')
    const coverage = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageCodeCoverage({ tabId, action: 'start', reload: false }), tabId)
    expect(coverage.status).toBe('recording')
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      if (!contents.debugger.isAttached()) throw new Error('Expected existing Hronaut debugger attachment')
      const state: ProbeState = { debugger: contents.debugger, listener: () => undefined, count: 0, values: [], pauses: 0 }
      state.listener = (_event, method, params) => {
        if (method === 'Debugger.paused') { state.pauses++; void contents.debugger.sendCommand('Debugger.resume') }
        if (method === 'Runtime.consoleAPICalled' && params.args?.[0]?.value === 'synthetic-probe') {
          state.count++
          if (state.values.length < 8) state.values.push(params.args[1]?.value)
        }
      }
      contents.debugger.on('message', state.listener)
      ;(globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery = state
    }, url)
    expect(await install()).toBe(1)
    expect(await page.evaluate('compute(5)')).toBe(11)
    await expect.poll(async () => (await stats()).count).toBe(1)
    expect(await page.evaluate('probeSideEffects')).toBe(1)
    expect(await stats()).toMatchObject({ values: [10], pauses: 0 })
    const elapsedMs = await page.evaluate('(() => { const start = performance.now(); for (let i = 0; i < 100; i++) compute(i); return performance.now() - start })()') as number
    await expect.poll(async () => (await stats()).count).toBe(101)
    expect((await stats()).values).toHaveLength(8)
    expect(await page.evaluate('probeSideEffects')).toBe(101)
    const stopped = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageCodeCoverage({ tabId, action: 'stop' }), tabId)
    expect(stopped.status).toBe('complete')
    expect(stopped.report?.totalBytes).toBeGreaterThan(0)
    expect(await page.evaluate('compute(6)')).toBe(13)
    // A CDP round-trip drains earlier event messages. Stopping coverage disables
    // Debugger and removes the independent probe: coexistence is not solved.
    await electronApp.evaluate(async () => { await (globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery.debugger.sendCommand('Runtime.evaluate', { expression: '0' }) })
    expect((await stats()).count).toBe(101)
    expect(await install()).toBe(1)
    await page.reload()
    expect(await page.evaluate('compute(7)')).toBe(15)
    await expect.poll(async () => (await stats()).count).toBe(102)
    // URL breakpoints survive navigation: future product ownership must revoke
    // them explicitly rather than treating old approval as a fresh grant.
    await electronApp.evaluate(async () => {
      const state = (globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery
      await state.debugger.sendCommand('Debugger.removeBreakpoint', { breakpointId: state.breakpointId })
      state.breakpointId = undefined
    })
    expect(await page.evaluate('compute(8)')).toBe(17)
    await electronApp.evaluate(async () => { await (globalThis as unknown as { __logpointDiscovery: ProbeState }).__logpointDiscovery.debugger.sendCommand('Runtime.evaluate', { expression: '0' }) })
    expect(await stats()).toMatchObject({ count: 102, pauses: 0 })
    const receipt = { kind: 'hronaut-electron-logpoint-discovery', syntheticLocalOnly: true, zeroPauses: true, expressionsHaveSideEffects: true, displayBufferCap: 8, observedEvents: 102, loopCalls: 100, loopElapsedMs: elapsedMs, coverageCompleted: true, coverageStopRemovedProbe: true, urlProbeSurvivedNavigation: true, explicitRemovalStoppedOutput: true, productGoDecision: false }
    console.log('LOGPOINT_DISCOVERY_RECEIPT', JSON.stringify(receipt))
    await testInfo.attach('logpoint-discovery.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
  } finally {
    await electronApp.evaluate(async () => {
      const root = globalThis as unknown as { __logpointDiscovery?: ProbeState }
      const state = root.__logpointDiscovery
      if (state) {
        if (state.breakpointId) await state.debugger.sendCommand('Debugger.removeBreakpoint', { breakpointId: state.breakpointId }).catch(() => undefined)
        state.debugger.removeListener('message', state.listener)
        delete root.__logpointDiscovery
      }
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
