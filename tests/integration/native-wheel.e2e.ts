import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'
import { waitForSettledPageBounds } from './settled-page-bounds.js'

type WheelProbe = { commands: Array<{ method: string; params: Record<string, unknown> }>; restore: () => void }
type WheelGlobal = typeof globalThis & { wheelProbe?: WheelProbe }

// A wheel refuses when main moves its page while the call waits; let the
// toolbar settle after the fixture selects its tab.
test.beforeEach(async ({ capabilities, electronApp }) => {
  await waitForSettledPageBounds(electronApp, capabilities.fixtureUrl)
})

async function observeCommands(app: ElectronApplication, url: string, loseAck = false): Promise<void> {
  await app.evaluate(({ webContents }, { url, loseAck }) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const original = page.debugger.sendCommand
    const probe: WheelProbe = { commands: [], restore: () => { if (!page.isDestroyed()) page.debugger.sendCommand = original } }
    ;(globalThis as WheelGlobal).wheelProbe = probe
    page.debugger.sendCommand = async (method, ...args) => {
      const params = args[0] as Record<string, unknown> | undefined
      if (method.startsWith('Input.')) probe.commands.push({ method, params: params ?? {} })
      const result = await original.call(page.debugger, method, ...args)
      if (loseAck && method === 'Input.dispatchMouseEvent' && params?.type === 'mouseWheel') throw new Error('Controlled lost wheel acknowledgement')
      return result
    }
  }, { url, loseAck })
}

async function commands(app: ElectronApplication): Promise<WheelProbe['commands']> {
  return app.evaluate(() => (globalThis as WheelGlobal).wheelProbe!.commands)
}

test.afterEach(async ({ electronApp }) => {
  await electronApp.evaluate(() => { (globalThis as WheelGlobal).wheelProbe?.restore(); delete (globalThis as WheelGlobal).wheelProbe }).catch(() => undefined)
})

for (const loseAck of [false, true]) {
  test(`one wheel reaches a nonzero canvas point without CSSOM scrolling (${loseAck ? 'lost' : 'confirmed'} acknowledgement)`, async ({ capabilities, electronApp }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript(`document.body.innerHTML='<header style="height:70px">Header</header><div id="canvas" style="position:fixed;left:80px;top:80px;width:400px;height:300px">Canvas</div><div style="height:3000px"></div>';window.wheelEffects={events:[],header:0,zoom:1};document.querySelector('header').addEventListener('wheel',()=>window.wheelEffects.header++);document.querySelector('#canvas').addEventListener('wheel',e=>{window.wheelEffects.events.push({x:e.clientX,y:e.clientY,dx:e.deltaX,dy:e.deltaY,mode:e.deltaMode,trusted:e.isTrusted});window.wheelEffects.zoom+=e.deltaY;e.preventDefault()},{passive:false});void 0`)
    }, fixtureUrl)
    await observeCommands(electronApp, fixtureUrl, loseAck)
    const result = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150.5, y: 150.25, deltaX: -17.5, deltaY: 23.25 } }) as CallToolResult
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('window.wheelEffects.events.length'), fixtureUrl)).toBe(1)
    const observed = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript('({...window.wheelEffects,scrollX,scrollY})'), fixtureUrl)
    const raw = await commands(electronApp)
    await testInfo.attach('wheel-acceptance', { body: JSON.stringify({ result, observed, raw }), contentType: 'application/json' })
    expect(observed).toEqual({ events: [{ x: 150, y: 150, dx: -17.5, dy: 23.25, mode: 0, trusted: true }], header: 0, zoom: 24.25, scrollX: 0, scrollY: 0 })
    expect(raw).toEqual([{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 150.5, y: 150.25, deltaX: -17.5, deltaY: 23.25, buttons: 0, modifiers: 0 } }])
    expect(result.isError === true, text(result)).toBe(loseAck)
    if (loseAck) expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'WHEEL_COMMAND_UNCERTAIN', retrySafe: false, effects: 'possible' })
    else expect(JSON.parse(text(result))).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED' })
  })
}

test('wheel uses viewport coordinates after the document scrolls in both axes', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(`document.body.style.cssText='margin:0;min-width:3000px;min-height:3000px';document.body.innerHTML='<div id="canvas" style="position:absolute;left:380px;top:680px;width:400px;height:300px">Canvas</div>';window.scrolledWheelEvents=[];document.querySelector('#canvas').addEventListener('wheel',e=>{window.scrolledWheelEvents.push({clientX:e.clientX,clientY:e.clientY,pageX:e.pageX,pageY:e.pageY,deltaX:e.deltaX,deltaY:e.deltaY,trusted:e.isTrusted});e.preventDefault()},{passive:false});scrollTo(300,600);void 0`)
  }, fixtureUrl)
  const observe = () => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(`({scroll:[scrollX,scrollY],rect:[document.querySelector('#canvas').getBoundingClientRect().x,document.querySelector('#canvas').getBoundingClientRect().y],events:window.scrolledWheelEvents})`), fixtureUrl)
  await expect.poll(observe).toEqual({ scroll: [300, 600], rect: [80, 80], events: [] })
  await observeCommands(electronApp, fixtureUrl)
  const result = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150.5, y: 150.25, deltaX: -11.5, deltaY: 7.25 } }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  expect(JSON.parse(text(result))).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED' })
  await expect.poll(observe).toEqual({ scroll: [300, 600], rect: [80, 80], events: [{ clientX: 150, clientY: 150, pageX: 450, pageY: 750, deltaX: -11.5, deltaY: 7.25, trusted: true }] })
  const raw = await commands(electronApp)
  expect(raw).toEqual([{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 150.5, y: 150.25, deltaX: -11.5, deltaY: 7.25, buttons: 0, modifiers: 0 } }])
  await testInfo.attach('wheel-scrolled-document', { body: JSON.stringify({ result, observed: await observe(), raw }), contentType: 'application/json' })
})

test('wheel scrolls the hit nested scroller in both axes and directions', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`document.body.innerHTML='<header style="height:70px">Header</header><div id="outer" style="position:fixed;left:80px;top:80px;width:400px;height:300px;overflow:auto"><div style="width:1200px;height:1200px"><div id="inner" style="width:250px;height:200px;overflow:scroll"><div style="width:1000px;height:1000px">Nested</div></div></div></div><div style="height:3000px"></div>';window.wheelEvents=[];document.addEventListener('wheel',e=>window.wheelEvents.push({target:e.target.textContent,dx:e.deltaX,dy:e.deltaY}));void 0`)
  }, fixtureUrl)
  await observeCommands(electronApp, fixtureUrl)
  const positions = () => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`({inner:[document.querySelector('#inner').scrollLeft,document.querySelector('#inner').scrollTop],outer:[document.querySelector('#outer').scrollLeft,document.querySelector('#outer').scrollTop],page:[scrollX,scrollY]})`), fixtureUrl)
  for (const sign of [1, -1]) {
    const result = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: sign * 80, deltaY: sign * 100 } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    await expect.poll(positions).toEqual({ inner: sign === 1 ? [80, 100] : [0, 0], outer: [0, 0], page: [0, 0] })
  }
  const raw = await commands(electronApp)
  expect(raw).toHaveLength(2)
  expect(raw.every(command => command.method === 'Input.dispatchMouseEvent' && command.params.type === 'mouseWheel')).toBe(true)
  await testInfo.attach('nested-wheel-acceptance', { body: JSON.stringify({ positions: await positions(), raw }), contentType: 'application/json' })
})

test('locked wheel refuses before dispatch or unlock; trusted UI unlock permits a fresh call', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
  await observeCommands(electronApp, fixtureUrl)
  const input = { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 }
  const refused = await client.callTool({ name: 'browser_wheel', arguments: input }) as CallToolResult
  expect(refused.isError, text(refused)).toBe(true)
  expect(text(refused)).toContain('unlocked page')
  expect(await commands(electronApp)).toEqual([])
  await electronApp.evaluate(() => (globalThis as WheelGlobal).wheelProbe!.restore())
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, false), tabId)
  await observeCommands(electronApp, fixtureUrl)
  const accepted = await client.callTool({ name: 'browser_wheel', arguments: input }) as CallToolResult
  expect(accepted.isError, text(accepted)).not.toBe(true)
  expect(await commands(electronApp)).toHaveLength(1)
})

test('strict wheel schema rejects ambiguous and missing inputs before native dispatch', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await observeCommands(electronApp, fixtureUrl)
  const valid = { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 }
  for (const input of [
    { ...valid, modifiers: 0 }, { ...valid, ref: 'ref-1' }, { ...valid, selector: '#canvas' },
    { ...valid, deltaX: 0, deltaY: 0 }, { ...valid, deltaY: 1001 }, { ...valid, x: -1 },
    { tabId, x: 150, y: 150, deltaY: 20 }, { x: 150, y: 150, deltaX: 0, deltaY: 20 }
  ]) {
    const result = await client.callTool({ name: 'browser_wheel', arguments: input }) as CallToolResult
    expect(result.isError, text(result)).toBe(true)
  }
  expect(await commands(electronApp)).toEqual([])
})

for (const context of ['zoom', 'emulation', 'out-of-viewport', 'child-frame', 'cross-origin-frame'] as const) {
  test(`wheel refuses unsupported ${context} without native input`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl, address } = capabilities
    if (context === 'zoom') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setZoom({ tabId: id, action: 'set', percent: 125 }), tabId)
    if (context === 'emulation') {
      const result = await client.callTool({ name: 'browser_emulate', arguments: { tabId, viewport: { width: 800, height: 600, deviceScaleFactor: 2, mobile: false, touch: false, orientation: 'portrait' } } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
    }
    if (context === 'child-frame' || context === 'cross-origin-frame') {
      await electronApp.evaluate(async ({ webContents }, { url, src }) => {
        await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.onload=resolve;frame.src=${JSON.stringify(src)};document.body.appendChild(frame)})`)
      }, { url: fixtureUrl, src: context === 'child-frame' ? 'about:blank' : `http://localhost:${address.port}/` })
      const processes = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.mainFrame.framesInSubtree.map(frame => ({ processId: frame.processId, url: frame.url })), fixtureUrl)
      expect(processes).toHaveLength(2)
      if (context === 'cross-origin-frame') expect(processes[1]!.processId).not.toBe(processes[0]!.processId)
      await testInfo.attach('wheel-frame-rejection-context', { body: JSON.stringify({ context, processes }), contentType: 'application/json' })
    }
    await observeCommands(electronApp, fixtureUrl)
    const result = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: context === 'out-of-viewport' ? 16384 : 150, y: 150, deltaX: 0, deltaY: 20 } }) as CallToolResult
    expect(result.isError, text(result)).toBe(true)
    expect(await commands(electronApp)).toEqual([])
  })
}

test('hidden wheel target refuses without selection, focus or pointer movement; explicit selection permits a fresh call', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: `${fixtureUrl}#other`, active: true } }) as CallToolResult
  expect(opened.isError, text(opened)).not.toBe(true)
  const otherTabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
  expect((await client.callTool({ name: 'browser_wait', arguments: { tabId: otherTabId } }) as CallToolResult).isError).not.toBe(true)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), otherTabId)
  const focus = () => electronApp.evaluate(({ webContents, screen }) => ({ focus: webContents.getFocusedWebContents()?.id ?? null, point: screen.getCursorScreenPoint() }))
  const before = await focus()
  const context = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.map(({ id, navigationGeneration, observationGeneration, humanInteractionGeneration }) => ({ id, navigationGeneration, observationGeneration, humanInteractionGeneration })))
  const beforeContext = await context()
  await observeCommands(electronApp, fixtureUrl)
  const result = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }) as CallToolResult
  await testInfo.attach('wheel-background-diagnosis', { body: JSON.stringify({ result, beforeContext, afterContext: await context(), before, after: await focus(), commands: await commands(electronApp) }), contentType: 'application/json' })
  expect(result.isError, text(result)).toBe(true)
  expect(text(result)).toContain('active visible page')
  expect(await focus()).toEqual(before)
  expect(await appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).activeTabId)).toBe(otherTabId)
  expect(await commands(electronApp)).toEqual([])
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
  const fresh = await client.callTool({ name: 'browser_wheel', arguments: { tabId, x: 150, y: 150, deltaX: 0, deltaY: 20 } }) as CallToolResult
  expect(fresh.isError, text(fresh)).not.toBe(true)
  expect(await commands(electronApp)).toHaveLength(1)
})
