import { createServer } from 'node:http'
import { collectPartial, diagnosticArm, diagnosticEnabled, fixtureObserver, saveDiagnostic } from './oopif-diagnostic.js'
import type { HronautApi } from '../../src/shared/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type Probe = { stats: Record<string, number>; commands: unknown[]; events: unknown[]; restore(): void; timeline?: unknown[]; commandTimes?: unknown[]; frameSamples?: unknown[] }
type Scope = typeof globalThis & { __coordinateReview?: Probe }
for (const scenario of ['desktop', 'mobile-no-meta', 'cross-origin-frame'] as const) {
  test(`keyboard admission preserves native click ${scenario}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId } = capabilities
    const diagnostic = diagnosticEnabled && scenario === 'cross-origin-frame'
    const evidence: Record<string, unknown> = { arm: diagnosticArm, retry: testInfo.retry, assertion: 'not-reached' }
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      if (request.url === '/child') response.end('<!doctype html>' + (diagnostic ? fixtureObserver('child') : '') + '<body style="margin:0"><button style="position:fixed;left:20px;top:20px;width:100px;height:80px" onclick="'+(diagnostic ? 'window.__oopifSend?.();' : '')+'parent.postMessage(\'child-click\',\'*\')">Child target</button>')
      else if (scenario === 'cross-origin-frame') response.end(`<!doctype html>${diagnostic ? fixtureObserver('root') : ''}<body style="margin:0"><iframe style="position:absolute;left:250px;top:160px;width:300px;height:220px;border:0" src="http://localhost:${(server.address() as {port:number}).port}/child"></iframe><script>window.hits=0;onmessage=e=>{if(e.data==='child-click')window.hits++}</script>`)
      else response.end('<!doctype html><body style="margin:0"><button id="target" style="position:absolute;left:100px;top:100px;width:100px;height:80px">Target</button><script>window.hits=0;document.querySelector("#target").onclick=()=>window.hits++</script>')
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      const url = `http://127.0.0.1:${address.port}/`
      if (scenario === 'mobile-no-meta') expect((await client.callTool({ name: 'browser_emulate', arguments: { tabId, viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: false, orientation: 'portrait' } } })).isError).not.toBe(true)
      expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url } })).isError).not.toBe(true)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return page.executeJavaScript('document.readyState')
      }, url)).toBe('complete')
      const before = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionGeneration, tabId)
      const context = await electronApp.evaluate(async ({ webContents }, { url, diagnostic }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        const probe: Probe = { stats: { nativeDropped: 0, commandDropped: 0, frameDropped: 0, observerErrors: 0 }, commands: [], events: [], timeline: [], commandTimes: [], frameSamples: [], restore: () => {
          page.removeListener('before-mouse-event', listener)
          if (!page.isDestroyed()) page.debugger.sendCommand = send
        } }
        const listener = (event: Electron.Event, mouse: Electron.MouseInputEvent): void => {
          try { if (diagnostic && probe.timeline!.length >= 32) probe.stats.nativeDropped = Math.min(1000000, probe.stats.nativeDropped! + 1); else if (diagnostic) probe.timeline!.push({ kind: mouse.type, at: Date.now(), x: mouse.x, y: mouse.y, prevented: event.defaultPrevented }) } catch { probe.stats.observerErrors = Math.min(1000000, probe.stats.observerErrors! + 1) }
          if (probe.events.length < 12) probe.events.push({ mouse, eventKeys: Object.keys(event), prevented: event.defaultPrevented })
        }
        page.on('before-mouse-event', listener)
        const send = page.debugger.sendCommand
        page.debugger.sendCommand = async (method, ...args) => {
          try { if (diagnostic && method === 'Input.dispatchMouseEvent' && probe.commandTimes!.length >= 12) { probe.stats.commandDropped = Math.min(1000000, probe.stats.commandDropped! + 1); probe.stats.frameDropped = Math.min(1000000, probe.stats.frameDropped! + 1) } else if (diagnostic && method === 'Input.dispatchMouseEvent') { const input = args[0] as { type?: string; x?: number; y?: number } | undefined; probe.commandTimes!.push({ kind: input?.type, at: Date.now(), x: input?.x, y: input?.y }); probe.stats.frameDropped = Math.min(1000000, probe.stats.frameDropped! + Math.max(0, page.mainFrame.frames.length + 1 - 4)); probe.frameSamples!.push({ at: Date.now(), frames: [page.mainFrame, ...page.mainFrame.frames].slice(0, 4).map(frame => ({ role: frame.url === url ? 'root' : frame.url === url.replace('127.0.0.1', 'localhost') + 'child' ? 'child' : 'unknown', processId: frame.processId, routingId: frame.routingId })) }) } } catch { probe.stats.observerErrors = Math.min(1000000, probe.stats.observerErrors! + 1) }
          if (method === 'Input.dispatchMouseEvent' && probe.commands.length < 12) probe.commands.push(args[0])
          return send.call(page.debugger, method, ...args)
        }
        ;(globalThis as Scope).__coordinateReview = probe
        return { zoom: page.getZoomFactor(), chromium: process.versions.chrome, page: await page.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualScale:visualViewport.scale,visualOffsetX:visualViewport.offsetLeft,visualOffsetY:visualViewport.offsetTop,hasMeta:!!document.querySelector("meta[name=viewport]")})'), frames: [page.mainFrame,...page.mainFrame.frames].map(frame => ({ url: frame.url, processId: frame.processId, routingId: frame.routingId })) }
      }, { url, diagnostic })
      if (diagnostic) {
        evidence.framesBefore = context.frames.map((frame, index) => ({ role: index === 0 ? 'root' : 'child', processId: frame.processId, routingId: frame.routingId }))
        if (diagnosticArm === 'native-route-ready') {
          evidence.barrierObserved = await electronApp.evaluate(async ({ webContents }, url) => {
            const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
            return new Promise<boolean>(resolve => {
              const finish = (observed: boolean): void => { clearTimeout(timer); page.removeListener('before-mouse-event', listener); resolve(observed) }
              const listener = (_event: Electron.Event, mouse: Electron.MouseInputEvent): void => { if (mouse.type === 'mouseMove' && mouse.x === 70 && mouse.y === 60) finish(true) }
              const timer = setTimeout(() => finish(false), 500)
              page.on('before-mouse-event', listener)
              page.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 320, y: 220 }).catch(() => finish(false))
            })
          }, url).catch(() => false)
        }
        evidence.clickStart = Date.now()
      }
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, ...(scenario === 'cross-origin-frame' ? { x: 320, y: 220 } : { selector: '#target', native: true }) } }) as CallToolResult
      if (diagnostic) evidence.clickReturn = Date.now()
      const observed = await electronApp.evaluate(async ({ webContents }, url) => ({ hits: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.hits'), commands: (globalThis as Scope).__coordinateReview!.commands, events: (globalThis as Scope).__coordinateReview!.events }), url)
      if (diagnostic) { evidence.immediateRead = Date.now(); evidence.immediateHits = observed.hits }
      const after = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionGeneration, tabId)
      const report = { scenario, context, observed, generationDelta: (after ?? 0) - (before ?? 0), result }
      await testInfo.attach('coordinate-review', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
      if (scenario === 'mobile-no-meta') {
        expect(context.page.hasMeta).toBe(false)
        expect(context.page.visualScale).not.toBe(1)
      }
      if (scenario === 'cross-origin-frame') {
        expect(context.frames).toHaveLength(2)
        expect(context.frames[1]!.processId).not.toBe(context.frames[0]!.processId)
      }
      if (diagnostic) { evidence.generationDelta = report.generationDelta; evidence.toolError = result.isError === true; evidence.assertion = 'failed' }
      expect({ hits: observed.hits, error: result.isError === true, generationDelta: report.generationDelta }, text(result)).toEqual({ hits: 1, error: false, generationDelta: 0 })
      if (diagnostic) evidence.assertion = 'passed'
    } finally {
      if (diagnostic) {
        try {
          const port = (server.address() as { port: number } | null)?.port
          const partial = await collectPartial({
            native: () => electronApp.evaluate(() => {
              const probe = (globalThis as Scope).__coordinateReview
              if (!probe) throw new Error('unavailable')
              return { nativeEvents: probe.timeline, commands: probe.commandTimes, frameSamples: probe.frameSamples, ...probe.stats }
            }),
            frames: () => electronApp.evaluate(({ webContents }, port) => {
              const url = `http://127.0.0.1:${port}/`
              const page = webContents.getAllWebContents().find(page => page.getURL() === url)
              if (!page) throw new Error('unavailable')
              return { framesAfter: [page.mainFrame, ...page.mainFrame.frames].map(frame => ({ role: frame.url === url ? 'root' : frame.url === `http://localhost:${port}/child` ? 'child' : 'unknown', processId: frame.processId, routingId: frame.routingId })) }
            }, port),
            root: () => electronApp.evaluate(async ({ webContents }, port) => {
              const page = webContents.getAllWebContents().find(page => page.getURL() === `http://127.0.0.1:${port}/`)
              if (!page) throw new Error('unavailable')
              // Post-assertion only. Independent settlement preserves other observations.
              const root = await page.executeJavaScript(`new Promise(resolve=>{const snapshot=()=>({hits:window.hits,state:window.__oopif});if(window.hits>0){resolve(snapshot());return}let timer;const finish=()=>{clearTimeout(timer);removeEventListener('message',listener);resolve(snapshot())};const listener=e=>{if(e.data==='child-click')queueMicrotask(finish)};addEventListener('message',listener);timer=setTimeout(finish,500)})`)
              if (!root.state) throw new Error('unavailable')
              return { settledHits: root.hits, rootEvents: root.state.events, rootObserverAvailable: root.state.available, rootDropped: root.state.dropped, rootErrors: root.state.errors }
            }, port),
            child: () => electronApp.evaluate(async ({ webContents }, port) => {
              const page = webContents.getAllWebContents().find(page => page.getURL() === `http://127.0.0.1:${port}/`)
              const child = page?.mainFrame.frames.find(frame => frame.url === `http://localhost:${port}/child`)
              if (!child) throw new Error('unavailable')
              const state = await child.executeJavaScript('window.__oopif') as { clicks: number; events: unknown[]; dropped: number; errors: number; available: boolean } | undefined
              if (!state) throw new Error('unavailable')
              return { childHits: state.clicks, childEvents: state.events, childObserverAvailable: state.available, childDropped: state.dropped, childErrors: state.errors }
            }, port)
          })
          Object.assign(evidence, partial.data, { availability: partial.availability, available: Object.values(partial.availability).every(status => status === 'fulfilled') })
        } catch { evidence.available = false }
        await saveDiagnostic(evidence, testInfo.retry)
      }
      await electronApp.evaluate(() => { (globalThis as Scope).__coordinateReview?.restore(); delete (globalThis as Scope).__coordinateReview }).catch(() => undefined)
      await closeFixtureServer(server)
    }
  })
}
