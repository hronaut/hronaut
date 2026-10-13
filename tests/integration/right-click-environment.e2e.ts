import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text } from './capability-fixtures.js'

type RightGate = { held: boolean; commands: string[]; release: () => void; restore: () => void }
type RightScope = typeof globalThis & { rightClickGate?: RightGate }

for (const change of ['unchanged', 'zoom-aba', 'selection-aba', 'bounds-aba', 'pause-aba', 'global-pause-aba', 'access-aba', 'route', 'close', 'cancel', 'frame', 'global-lock-requests', 'cleanup-zoom-aba'] as const) {
  test(`right-click revalidates after viewport await: ${change}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.body.innerHTML='<button id=target>Menu</button>';document.querySelector('button').oncontextmenu=e=>e.preventDefault();void 0") }, fixtureUrl)
    await electronApp.evaluate(({ webContents }, { url, change }) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const original = page.debugger.sendCommand
      let release!: () => void
      const hold = new Promise<void>(resolve => { release = resolve })
      const gate: RightGate = { held: false, commands: [], release, restore: () => { release(); if (!page.isDestroyed()) page.debugger.sendCommand = original } }
      ;(globalThis as RightScope).rightClickGate = gate
      page.debugger.sendCommand = async (method, ...args) => {
        if (method === 'Input.dispatchMouseEvent') gate.commands.push(String((args[0] as Record<string, unknown>)?.type))
        if (method === (change === 'cleanup-zoom-aba' ? 'Runtime.releaseObjectGroup' : 'Page.getLayoutMetrics') && !gate.held) {
          const result = await original.call(page.debugger, method, ...args)
          gate.held = true
          await hold
          return result
        }
        return original.call(page.debugger, method, ...args)
      }
    }, { url: fixtureUrl, change })
    const transport = client.transport!
    const send = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_click') requestId = message.id
      return send(message, options)
    }
    const abort = new AbortController()
    let pending: Promise<CallToolResult> | undefined
    try {
      pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true, button: 'right' } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
      if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.held)).toBe(true)
      if (change === 'zoom-aba' || change === 'cleanup-zoom-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setZoom({ tabId: id, action: 'set', percent: 125 })
        await api.setZoom({ tabId: id, action: 'reset' })
      }, tabId)
      if (change === 'selection-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const other = (await api.getState()).tabs.find(tab => tab.id !== id && !tab.sleeping)!
        await api.selectTab(other.id)
        await api.selectTab(id)
      }, tabId)
      if (change === 'pause-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        await api.setTabAgentPaused(id, true)
        await api.setTabAgentPaused(id, false)
      }, tabId)
      if (change === 'access-aba') await appWindow.evaluate(async id => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const workspace = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
        await api.updateTabGroup(workspace, { agentAccess: false })
        await api.updateTabGroup(workspace, { agentAccess: true })
      }, tabId)
      if (change === 'global-pause-aba') await appWindow.evaluate('window.hronautMcp.setPaused(true).then(()=>window.hronautMcp.setPaused(false))')
      if (change === 'bounds-aba') await electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
        const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
        const owner = BrowserWindow.getAllWindows().find(window => window.contentView.children.some(view => 'webContents' in view && view.webContents === page))!
        const view = owner.contentView.children.find(view => 'webContents' in view && view.webContents === page)!
        const bounds = view.getBounds()
        view.setBounds({ ...bounds, width: bounds.width - 1 })
        view.setBounds(bounds)
      }, fixtureUrl)
      if (change === 'route' || change === 'frame') await electronApp.evaluate(async ({ webContents }, { url, change }) => {
        await webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(change === 'route'
          ? "location.hash='rightClick-route'" : "document.body.appendChild(document.createElement('iframe'));void 0")
      }, { url: fixtureUrl, change })
      if (change === 'close') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), tabId)
      if (change === 'global-lock-requests') {
        const rejected = await appWindow.evaluate(async () => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const results = await Promise.allSettled([api.setAllHumanInteractionLocked(true), api.setAllHumanInteractionLocked(false)])
          return results.map(result => result.status)
        })
        expect(rejected).toEqual(['rejected', 'rejected'])
      }
      if (change === 'cancel') {
        if (requestId === undefined) throw new Error('Missing rightClick request ID')
        await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled rightClick cancellation' } })
        abort.abort()
      }
      await electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.release())
      const result = await pending
      // Cancellation can settle the transport before the server. Observe the
      // terminal activity from the trusted Home endpoint before checking input.
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(p => p.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string }> }
        return state.recentActivity.filter(activity => activity.toolName === 'browser_click' && activity.tabId === id).length
      }, tabId)).toBe(1)
      if (change === 'cancel') await expect.poll(() => electronApp.evaluate(async ({ webContents }, id) => {
        const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
        const state = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result: unknown }> }
        return state.recentActivity.find(row => row.toolName === 'browser_click' && row.tabId === id)?.result
      }, tabId)).toMatchObject({ outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', effects: 'possible' })
      const commands = await electronApp.evaluate(() => (globalThis as RightScope).rightClickGate!.commands)
      await testInfo.attach('rightClick-authority', { body: JSON.stringify({ change, result, commands }), contentType: 'application/json' })
      expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
      expect(commands).toEqual(change === 'unchanged' || change === 'cleanup-zoom-aba' ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['mouseMoved'])
    } finally {
      transport.send = send
      await electronApp.evaluate(() => { (globalThis as RightScope).rightClickGate?.restore(); delete (globalThis as RightScope).rightClickGate }).catch(() => undefined)
      await Promise.allSettled([pending].filter((p): p is Promise<CallToolResult> => p !== undefined))
    }
  })
}
