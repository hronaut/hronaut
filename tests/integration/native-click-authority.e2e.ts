import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

type ClickGate = { ready: boolean; presses: number; releases: number; ignores: boolean[]; documentListeners: number; release(): void; restore(): void }
type ClickGlobal = typeof globalThis & { __clickAuthorityGate?: ClickGate }

const cases = [
  ['move', 'unchanged', 'selector', false], ['move', 'unchanged', 'ref', true],
  ['move', 'unchanged', 'coordinates', false], ['move', 'pause', 'selector', false],
  ['move', 'pause ABA', 'ref', false], ['move', 'global pause ABA', 'coordinates', false],
  ['move', 'workspace access ABA', 'selector', false], ['move', 'navigation', 'selector', false],
  ['prepare', 'pending navigation', 'selector', false], ['move', 'cancel', 'coordinates', false],
  ['unlock', 'pause', 'selector', false], ['unlock', 'unchanged', 'selector', false],
  ['press', 'pause', 'selector', true]
] as const
for (const [phase, change, target, doubleClick] of cases) {
  test(`native click ${phase} boundary: ${change}, ${target}, double ${doubleClick}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId } = capabilities
    let fixtureUrl = capabilities.fixtureUrl
    let holdResponse = false
    let releaseResponse: (() => void) | undefined
    let notifyRequest!: () => void
    const requestReceived = new Promise<void>(resolve => { notifyRequest = resolve })
    const server = change === 'pending navigation' ? createServer((_request, response) => {
      const reply = (): void => {
        if (response.writableEnded) return
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
        response.end('<button id="target" style="position:fixed;left:100px;top:100px;width:150px;height:80px">New target</button><script>window.nativeClicks=0;window.newDocument=true;document.querySelector("#target").onclick=()=>window.nativeClicks++</script>')
      }
      if (holdResponse) { releaseResponse = reply; notifyRequest() } else reply()
    }) : undefined
    try {
      if (server) {
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing native click fixture address')
        fixtureUrl = `http://127.0.0.1:${address.port}/`
        expect((await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })).isError).not.toBe(true)
      }
      const abort = new AbortController()
      const transport = client.transport!
      const sendRequest = transport.send.bind(transport)
      let requestId: string | number | undefined
      transport.send = async (message, options) => {
        if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_click') requestId = message.id
        return sendRequest(message, options)
      }
      let pending: Promise<CallToolResult> | undefined
      try {
        if (phase === 'unlock') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
        await electronApp.evaluate(async ({ webContents }, { url, phase }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript(`document.body.innerHTML='<button id="target" style="position:fixed;left:100px;top:100px;width:150px;height:80px">Click target</button>';window.nativeClicks=0;window.newDocument=false;document.querySelector('#target').addEventListener('click',()=>window.nativeClicks++);`)
          const execute = page.executeJavaScript
          const api = page.debugger
          const send = api.sendCommand
          let release!: () => void
          const barrier = new Promise<void>(resolve => { release = resolve })
          const gate: ClickGate = { ready: false, presses: 0, releases: 0, ignores: [], documentListeners: page.listenerCount('did-navigate'), release, restore: () => { if (!page.isDestroyed()) { api.sendCommand = send; page.executeJavaScript = execute } } }
          ;(globalThis as ClickGlobal).__clickAuthorityGate = gate
          if (phase === 'prepare') page.executeJavaScript = async (script, ...args) => {
            if (script.includes('element.scrollIntoView')) gate.ready = true
            return execute.call(page, script, ...args)
          }
          api.sendCommand = async (method, ...args) => {
            const params = args[0] as Record<string, unknown> | undefined
            if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') gate.presses++
            if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased') gate.releases++
            if (method === 'Input.setIgnoreInputEvents') gate.ignores.push(params?.ignore === true)
            const result = await send.call(api, method, ...args)
            if (!gate.ready && (
              (phase === 'move' && method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved')
              || (phase === 'press' && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed')
              || (phase === 'unlock' && method === 'Input.setIgnoreInputEvents' && params?.ignore === false && gate.ignores.filter(value => !value).length === 2)
            )) {
              gate.ready = true
              await barrier
            }
            return result
          }
        }, { url: fixtureUrl, phase })
        let ref: string | undefined
        if (target === 'ref') {
          expect((await client.callTool({ name: 'browser_snapshot', arguments: { tabId } })).isError).not.toBe(true)
          ref = await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.querySelector('#target').getAttribute('data-hronaut-ref')"), fixtureUrl)
          expect(ref).toBeTruthy()
        }
        if (change === 'pending navigation') {
          holdResponse = true
          await electronApp.evaluate(({ webContents }, url) => {
            const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
            void page.loadURL(url).catch(() => undefined)
          }, fixtureUrl)
          await requestReceived
          expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.isLoadingMainFrame(), fixtureUrl)).toBe(true)
        }
        pending = client.callTool({ name: 'browser_click', arguments: {
          tabId, doubleClick, ...(target === 'coordinates' ? { x: 150, y: 140 } : target === 'ref' ? { ref, native: true } : { selector: '#target', native: true })
        } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
        if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
        await expect.poll(() => electronApp.evaluate(() => (globalThis as ClickGlobal).__clickAuthorityGate?.ready)).toBe(true)
        if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
        if (change === 'pause ABA') await appWindow.evaluate(async id => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          await api.setTabAgentPaused(id, true)
          await api.setTabAgentPaused(id, false)
        }, tabId)
        if (change === 'global pause ABA') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
        if (change === 'workspace access ABA') await appWindow.evaluate(async id => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const workspaceId = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
          await api.updateTabGroup(workspaceId, { agentAccess: false })
          await api.updateTabGroup(workspaceId, { agentAccess: true })
        }, tabId)
        if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript("location.hash='new-document-state'")
        }, fixtureUrl)
        if (change === 'pending navigation') {
          releaseResponse!()
          await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.newDocument === true'), fixtureUrl)).toBe(true)
        }
        if (change === 'cancel') {
          if (requestId === undefined) throw new Error('Missing synthetic click request id')
          await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Synthetic cancellation' } })
          abort.abort()
        }
        await electronApp.evaluate(() => (globalThis as ClickGlobal).__clickAuthorityGate!.release())
        const result = await pending
        await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
          return home.executeJavaScript("fetch('/api/status').then(r=>r.json()).then(s=>s.recentActivity.find(a=>a.toolName==='browser_click')?.result).catch(()=>null)")
        })).toMatchObject({ dispatch: 'dispatched', effects: 'possible', outcome: change === 'unchanged' ? 'succeeded' : change === 'cancel' ? 'cancelled' : 'outcome-unknown' })
        const observation = await electronApp.evaluate(async ({ webContents }, url) => ({
          presses: (globalThis as ClickGlobal).__clickAuthorityGate!.presses,
          releases: (globalThis as ClickGlobal).__clickAuthorityGate!.releases,
          clicks: await webContents.getAllWebContents().find(page => page.getURL().split('#')[0] === url)!.executeJavaScript('window.nativeClicks')
        }), fixtureUrl)
        const count = change === 'unchanged' ? (doubleClick ? 2 : 1) : phase === 'press' ? 1 : 0
        expect(observation).toEqual({ presses: count, releases: count, clicks: count })
        expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
        if (change !== 'unchanged' && change !== 'cancel') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
        expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL().split('#')[0] === url)!.listenerCount('did-navigate') === (globalThis as ClickGlobal).__clickAuthorityGate!.documentListeners, fixtureUrl)).toBe(true)
        if (phase === 'unlock') expect(await electronApp.evaluate(() => (globalThis as ClickGlobal).__clickAuthorityGate!.ignores.at(-1))).toBe(true)
      } finally {
        transport.send = sendRequest
        await electronApp.evaluate(() => {
          const scope = globalThis as ClickGlobal
          scope.__clickAuthorityGate?.release()
          scope.__clickAuthorityGate?.restore()
          delete scope.__clickAuthorityGate
        }).catch(() => undefined)
        releaseResponse?.()
        await pending?.catch(() => undefined)
      }
    } finally {
      releaseResponse?.()
      if (server) await closeFixtureServer(server)
    }
  })
}
